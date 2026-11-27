import { NextResponse } from "next/server";

const ALLOWED_DIVISIONS = new Set([
  "dhaka",
  "chattogram",
  "chittagong",
  "rajshahi",
  "khulna",
  "barishal",
  "barisal",
  "sylhet",
  "rangpur",
  "mymensingh",
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ division: string }> }
) {
  try {
    const { division } = await params;
    const cleanDivision = String(division || "")
      .trim()
      .toLowerCase();

    // Strict allowlist prevents path traversal / SSRF against upstream API
    if (!ALLOWED_DIVISIONS.has(cleanDivision)) {
      return NextResponse.json({ data: [] }, { status: 400 });
    }

    const res = await fetch(
      `https://bdapis.com/api/v1.2/division/${encodeURIComponent(cleanDivision)}`,
      {
        next: { revalidate: 86400 },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) throw new Error("Upstream API failed");
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ data: [] });
  }
}
