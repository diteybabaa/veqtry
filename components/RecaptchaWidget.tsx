"use client";

/**
 * components/RecaptchaWidget.tsx
 * One entry point for the checkbox on the card:
 *
 *   NEXT_PUBLIC_RECAPTCHA_SITE_KEY set   → the real reCAPTCHA v2 widget; the
 *                                          token is verified by /api/captcha
 *   no site key                          → the visual replica (demo mode)
 *
 * Both call onVerify(token) exactly once. `token` is null only in demo mode,
 * where there is nothing for the server to check — the parent sees that and
 * knows it is running without keys.
 */

import RealRecaptcha from "./RealRecaptcha";
import RecaptchaReplica from "./RecaptchaReplica";

export type WidgetState = "idle" | "checking" | "verified";

type RecaptchaWidgetProps = {
  /** Site key from NEXT_PUBLIC_RECAPTCHA_SITE_KEY; undefined = demo mode. */
  siteKey?: string;
  /** Resolve true to continue; false keeps the visitor on the card. */
  onVerify: (token: string | null) => Promise<boolean>;
  /** Replica latency in demo mode (ms). */
  challengeDelay?: number;
};

export default function RecaptchaWidget({ siteKey, onVerify, challengeDelay }: RecaptchaWidgetProps) {
  if (!siteKey) {
    return (
      <RecaptchaReplica
        challengeDelay={challengeDelay}
        onVerify={() => {
          void onVerify(null);
        }}
      />
    );
  }

  return <RealRecaptcha siteKey={siteKey} onToken={onVerify} />;
}
