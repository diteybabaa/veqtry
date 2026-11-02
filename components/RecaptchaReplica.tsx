"use client";

/**
 * components/RecaptchaReplica.tsx
 * Visual clone of the "I'm not a robot" checkbox — used only when no
 * NEXT_PUBLIC_RECAPTCHA_SITE_KEY is configured, so the demo still runs without
 * Google keys. It verifies nothing: the parent's onVerify(null) decides.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, RecaptchaLogo, SpinnerIcon } from "./icons";
import styles from "./RecaptchaWidget.module.css";

export type WidgetState = "idle" | "checking" | "verified";

type Props = {
  /** Called once the checkbox animation is done (demo mode, no token). */
  onVerify: () => void;
  /** Fake challenge latency in ms. */
  challengeDelay?: number;
};

export default function RecaptchaReplica({ onVerify, challengeDelay = 1200 }: Props) {
  const [state, setState] = useState<WidgetState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const handleClick = useCallback(() => {
    if (state !== "idle") return;
    setState("checking");
    timer.current = setTimeout(() => {
      setState("verified");
      onVerify();
    }, challengeDelay);
  }, [challengeDelay, onVerify, state]);

  const className = [
    styles.widget,
    state === "checking" ? styles.checking : "",
    state === "verified" ? styles.verified : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <button
        type="button"
        role="checkbox"
        aria-checked={state === "verified"}
        aria-label="I'm not a robot"
        aria-busy={state === "checking"}
        className={styles.checkbox}
        onClick={handleClick}
        disabled={state !== "idle"}
      >
        {state === "checking" ? (
          <SpinnerIcon size={18} className={styles.spinner} />
        ) : (
          <CheckIcon size={18} className={styles.tick} />
        )}
      </button>

      <span className={styles.label}>I&apos;m not a robot</span>

      <span className={styles.brand}>
        <RecaptchaLogo size={26} />
        <span className={styles.brandName}>reCAPTCHA</span>
      </span>
    </div>
  );
}
