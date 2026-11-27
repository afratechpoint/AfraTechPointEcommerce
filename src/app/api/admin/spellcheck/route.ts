import { NextRequest, NextResponse } from "next/server";
import { verifyOrderStaff } from "@/lib/auth-server";
import { checkRateLimit } from "@/lib/security/rate-limit";

// Tech, gadget & Bangladesh e-commerce terms that should never be flagged as typos
const IGNORED_WORDS = new Set([
  "afra", "bkash", "nagad", "upay", "steadfast", "pathao", "redx", "sundarban",
  "daraz", "imagekit", "tws", "anc", "enc", "rgb", "argb", "usb", "typec",
  "hdmi", "vga", "ssd", "nvme", "hdd", "ram", "rom", "mah", "gbps", "mbps",
  "ghz", "mhz", "wifi", "bluetooth", "earbuds", "earbud", "neckband", "powerbank",
  "smartwatch", "keycaps", "hot-swap", "hotswap", "dongle", "adapter", "hoco",
  "lenovo", "xiaomi", "redmi", "baseus", "anker", "jbl", "remax", "joyroom",
  "ugreen", "haylou", "qcy", "oraimo", "awei", "fantech", "havit", "rapoo",
  "logitech", "razer", "corsair", "asus", "msi", "tp-link", "tplink", "dlink",
  "tenda", "mikrotik", "samsung", "iphone", "ipad", "airpods", "macbook",
  "tiktok", "insta", "instagram", "fb", "youtube", "yt", "telegram", "whatsapp",
  "canva", "netflix", "spotify", "chatgpt", "openai", "vpn", "nordvpn",
  "kaspersky", "windows", "office365", "adobe", "bdt", "tk", "taka", "dhaka",
  "bangladesh", "upazila", "zilla", "cod", "sku", "seo", "url", "urls",
]);

// Boosted top suggestions for common tech/e-commerce typos
const BOOSTED_TYPOS: Record<string, string[]> = {
  softwer: ["Software", "Softer"],
  softwear: ["Software", "Softwear"],
  catagory: ["category", "categories"],
  catagories: ["categories", "category"],
  veriant: ["variant", "variants"],
  veriants: ["variants", "variant"],
  folower: ["follower", "followers"],
  folowers: ["followers", "follower"],
  follwers: ["followers", "follower"],
  wirless: ["wireless"],
  wireles: ["wireless"],
  blutooth: ["Bluetooth"],
  bluethooth: ["Bluetooth"],
  acessories: ["accessories"],
  accesories: ["accessories"],
  accessoris: ["accessories"],
  headphon: ["headphone", "headphones"],
  earphon: ["earphone", "earphones"],
  waranty: ["warranty"],
  warenty: ["warranty"],
  orginal: ["original"],
  cherger: ["charger"],
  batery: ["battery"],
  speker: ["speaker"],
  permanuntly: ["permanently"],
  defferent: ["different"],
  resulation: ["resolution"],
};

interface SpellIssue {
  id: string;
  offset: number;
  length: number;
  word: string;
  message: string;
  replacements: string[];
}

// Simple in-memory cache to make repeated checks instantaneous
const cache = new Map<string, { ts: number; issues: SpellIssue[] }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Replaces URLs, emails, Bangla script, and license-like codes with spaces of
 * the EXACT same UTF-16 length so character offsets remain 100% identical.
 */
function maskPreservingOffsets(input: string): string {
  return input
    // URLs & emails
    .replace(/https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/gi, (m) => " ".repeat(m.length))
    // Bangla Unicode block + emojis/symbols outside Latin/punctuation
    .replace(/[\u0980-\u09FF]/g, " ")
    // License keys / SKU-like uppercase+digit tokens (e.g. XXXXX-XXXXX, EQ34, HE05x, 105K)
    .replace(/\b(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{2,}\b/g, (m) => " ".repeat(m.length));
}

export async function POST(req: NextRequest) {
  try {
    const staffCaller = await verifyOrderStaff(req);
    if (!staffCaller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await checkRateLimit({
      bucket: "admin_spellcheck",
      identifier: staffCaller.uid,
      limit: 90,
      windowMs: 60 * 1000,
    });
    if (!rl.allowed) {
      return NextResponse.json({ issues: [] }, { status: 429 });
    }

    const body = await req.json();
    const rawText = typeof body?.text === "string" ? body.text : "";
    const isMultiline = Boolean(body?.isMultiline);

    if (!rawText || rawText.trim().length < 2 || rawText.length > 8000) {
      return NextResponse.json({ issues: [] });
    }

    const cacheKey = `${isMultiline ? "m" : "s"}:${rawText}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json({ issues: cached.issues });
    }

    const maskedText = maskPreservingOffsets(rawText);
    if (!/[a-zA-Z]{2,}/.test(maskedText)) {
      return NextResponse.json({ issues: [] });
    }

    const disabledRules = isMultiline
      ? "WHITESPACE_RULE,EN_QUOTES,DASH_RULE"
      : "UPPERCASE_SENTENCE_START,WHITESPACE_RULE,EN_QUOTES,DASH_RULE,COMMA_PARENTHESIS_WHITESPACE,SENTENCE_WHITESPACE";

    const params = new URLSearchParams({
      text: maskedText,
      language: "en-US",
      disabledRules,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const ltRes = await fetch("https://api.languagetool.org/v2/check", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!ltRes.ok) {
      return NextResponse.json({ issues: [] });
    }

    const data = await ltRes.json();
    const matches = Array.isArray(data?.matches) ? data.matches : [];

    const issues: SpellIssue[] = [];
    for (const m of matches) {
      const offset: number = m.offset;
      const length: number = m.length;
      if (typeof offset !== "number" || typeof length !== "number" || length <= 0) continue;

      const word = rawText.slice(offset, offset + length);
      if (!word.trim()) continue;

      const lower = word.trim().toLowerCase();
      if (IGNORED_WORDS.has(lower)) continue;

      const ltSuggestions: string[] = Array.isArray(m.replacements)
        ? m.replacements
            .map((r: any) => String(r?.value || ""))
            .filter((v: string) => v.length > 0 && v !== word)
        : [];

      // Merge boosted e-commerce typo suggestions at the front (preserving capitalization)
      const boosted = (BOOSTED_TYPOS[lower] || []).map((b) => {
        if (word[0] && word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) {
          return b.charAt(0).toUpperCase() + b.slice(1);
        }
        return b;
      });

      const merged = Array.from(new Set([...boosted, ...ltSuggestions])).slice(0, 5);
      if (merged.length === 0) continue;

      issues.push({
        id: `${offset}_${length}_${word}`,
        offset,
        length,
        word,
        message: m.shortMessage || m.message || "Spelling / grammar suggestion",
        replacements: merged,
      });
    }

    if (cache.size > 300) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
    cache.set(cacheKey, { ts: Date.now(), issues });

    return NextResponse.json({ issues });
  } catch {
    return NextResponse.json({ issues: [] });
  }
}
