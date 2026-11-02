/**
 * app/api/captcha/route.ts
 *
 *   GET  /api/captcha   → { mode, siteKey }        config for the card
 *   POST /api/captcha   { token } → { ok, error? }  verify one token
 *
 * The site key is public by design, but it is served from here (not inlined at
 * build time) so a key added to .env.local works after a restart alone. The
 * mode is decided on the server: "real", "demo" (development only) or
 * "unavailable" (production without keys — nobody gets through).
 *
 * The browser never decides whether the challenge was solved: it sends the
 * token here and only continues when Google's siteverify answers success.
 * Tokens are single use, so a captured token cannot be replayed.
 */

import { NextResponse } from "next/server";
import { recaptchaConfigured, recaptchaMode, recaptchaSiteKey, verifyRecaptchaToken } from "@/lib/recaptcha";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store, max-age=0" } as const;

/** First hop of x-forwarded-for on Vercel / most proxies. */
function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip");
}

export async function GET() {
  const mode = recaptchaMode();
  return NextResponse.json(
    {
      ok: true,
      mode,
      // never leak half a configuration: the key only matters with a secret
      siteKey: mode === "real" ? recaptchaSiteKey() : null,
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  let body: { token?: unknown };
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid-json" }, { status: 400, headers: NO_STORE });
  }

  if (!recaptchaConfigured()) {
    // No secret → nothing can be verified. Never answer ok here: a visitor who
    // forges this call must not get a pass.
    return NextResponse.json({ ok: false, error: "not-configured" }, { status: 501, headers: NO_STORE });
  }

  const verdict = await verifyRecaptchaToken(body.token, clientIp(request));

  if (!verdict.ok) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[recaptcha] rejected:", verdict.reason, verdict.detail ?? "");
    }
    return NextResponse.json(
      { ok: false, error: verdict.reason ?? "failed" },
      { status: 403, headers: NO_STORE },
    );
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
