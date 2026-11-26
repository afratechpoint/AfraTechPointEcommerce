import { NextRequest } from "next/server";
import { subscribeServerRealtime } from "@/lib/realtime-bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {}
      };

      // Initial handshake
      send(`event: connected\ndata: {"ok":true}\n\n`);

      const unsub = subscribeServerRealtime((evt) => {
        send(`event: sync\ndata: ${JSON.stringify(evt)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        send(`: ping\n\n`);
      }, 20000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsub();
      };

      request.signal.addEventListener("abort", () => {
        cleanup?.();
        cleanup = null;
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup?.();
      cleanup = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
