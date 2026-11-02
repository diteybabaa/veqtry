/**
 * lib/recaptcha.ts
 * Server-only reCAPTCHA configuration + token verification.
 *
 * Keys are read at REQUEST time (not baked into the bundle), so adding them to
 * .env.local and restarting the dev server is enough — no rebuild, and no
 * NEXT_PUBLIC_* inlining to get wrong.
 *
 *   RECAPTCHA_SITE_KEY / RECAPTCHA_SECRET_KEY   the v2 "I'm not a robot" pair
 *   NEXT_PUBLIC_RECAPTCHA_SITE_KEY              still accepted as a site key
 *   RECAPTCHA_REQUIRED_HOSTNAME                 optional hostname allowlist
 *   RECAPTCHA_VERIFY_URL                        optional (self-hosted / tests)
 *   RECAPTCHA_ALLOW_DEMO=1                      allow the visual replica in prod
 *
 * Google's endpoint: POST https://www.google.com/recaptcha/api/siteverify
 *   secret   RECAPTCHA_SECRET_KEY
 *   response the token returned by grecaptcha in the browser (single use)
 *   remoteip the visitor's IP (optional but recommended)
 */

export type RecaptchaMode =
  /** both keys present → the genuine widget, tokens verified */
  | "real"
  /** no keys, development (or RECAPTCHA_ALLOW_DEMO=1) → visual replica only */
  | "demo"
  /** no keys in production → the gate refuses to let anyone through */
  | "unavailable";

export type RecaptchaVerdict = {
  ok: boolean;
  /** Google error codes or a local reason — safe to return to the browser. */
  reason: string | null;
  hostname: string | null;
  /** only used by the server logs */
  detail: string | null;
};

type SiteverifyResponse = {
  success?: boolean;
  hostname?: string;
  challenge_ts?: string;
  "error-codes"?: string[];
};

const DEFAULT_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

function readSecret(): string {
  return (process.env.RECAPTCHA_SECRET_KEY ?? "").trim();
}

/** Public site key. Server-side value wins; NEXT_PUBLIC_* kept for compatibility. */
export function recaptchaSiteKey(): string | null {
  const key = (process.env.RECAPTCHA_SITE_KEY ?? process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? "").trim();
  return key || null;
}

/** True when both halves of the pair exist, i.e. tokens can actually be checked. */
export function recaptchaConfigured(): boolean {
  return readSecret() !== "" && recaptchaSiteKey() !== null;
}

/** What the card should render. Decided on the server, never in the browser. */
export function recaptchaMode(): RecaptchaMode {
  if (recaptchaConfigured()) return "real";
  const demoAllowed = process.env.NODE_ENV !== "production" || process.env.RECAPTCHA_ALLOW_DEMO === "1";
  return demoAllowed ? "demo" : "unavailable";
}

function verifyTarget(): { secret: string; verifyUrl: string; hosts: string[] } | null {
  const secret = readSecret();
  if (!secret) return null;
  // RECAPTCHA_VERIFY_URL exists for self-hosted gateways and tests; production
  // must leave it unset so tokens are checked by Google.
  const verifyUrl = (process.env.RECAPTCHA_VERIFY_URL ?? DEFAULT_VERIFY_URL).trim() || DEFAULT_VERIFY_URL;
  const hosts = (process.env.RECAPTCHA_REQUIRED_HOSTNAME ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return { secret, verifyUrl, hosts };
}

/** Token shape check before we spend a request on Google. */
function tokenLooksValid(token: unknown): token is string {
  return typeof token === "string" && token.length >= 20 && token.length <= 10000;
}

export async function verifyRecaptchaToken(
  token: unknown,
  remoteIp?: string | null,
): Promise<RecaptchaVerdict> {
  const cfg = verifyTarget();
  if (!cfg) {
    return { ok: false, reason: "not-configured", hostname: null, detail: "RECAPTCHA_SECRET_KEY is empty" };
  }
  if (!tokenLooksValid(token)) {
    return { ok: false, reason: "invalid-input-response", hostname: null, detail: "token missing or malformed" };
  }

  const body = new URLSearchParams();
  body.set("secret", cfg.secret);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);

  let data: SiteverifyResponse;
  try {
    const res = await fetch(cfg.verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { ok: false, reason: "siteverify-http-" + res.status, hostname: null, detail: "HTTP " + res.status };
    }
    data = (await res.json()) as SiteverifyResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "siteverify-unreachable", hostname: null, detail: message };
  }

  const hostname = typeof data.hostname === "string" ? data.hostname.toLowerCase() : null;
  if (data.success !== true) {
    const codes = Array.isArray(data["error-codes"]) ? data["error-codes"] : [];
    return {
      ok: false,
      reason: codes[0] ?? "failed",
      hostname,
      detail: codes.join(",") || "success=false",
    };
  }

  // Optional hardening: only accept tokens minted for our own domain(s).
  if (cfg.hosts.length && (!hostname || !cfg.hosts.includes(hostname))) {
    return {
      ok: false,
      reason: "hostname-mismatch",
      hostname,
      detail: "expected one of " + cfg.hosts.join(",") + ", got " + String(hostname),
    };
  }

  return { ok: true, reason: null, hostname, detail: null };
}
