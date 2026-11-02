"use client";

/**
 * components/RealRecaptcha.tsx
 * The genuine reCAPTCHA v2 "I'm not a robot" checkbox, rendered explicitly
 * into the card. Only used when NEXT_PUBLIC_RECAPTCHA_SITE_KEY is set —
 * otherwise RecaptchaWidget keeps the visual replica as a demo.
 *
 * Google renders a fixed 304×78 iframe. The card is narrower than that, so the
 * iframe is scaled down with a transform (and the wrapper height follows), which
 * keeps the card metrics intact while leaving the widget fully interactive.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SpinnerIcon } from "./icons";
import styles from "./RecaptchaWidget.module.css";

type Props = {
  siteKey: string;
  /** Ask the server to verify the token. Return false to reset the checkbox. */
  onToken: (token: string) => Promise<boolean>;
};

type Grecaptcha = {
  render: (element: HTMLElement, options: Record<string, unknown>) => number;
  reset: (widgetId?: number) => void;
  getResponse: (widgetId?: number) => string;
};

declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
  }
}

const SCRIPT_ID = "recaptcha-api";
const SCRIPT_TIMEOUT_MS = 20000;
const NATIVE_W = 304;
const NATIVE_H = 78;

let scriptPromise: Promise<void> | null = null;

/** Drop the cached loader (used by the retry button after a blocked request). */
function forgetLoader(): void {
  scriptPromise = null;
  document.getElementById(SCRIPT_ID)?.remove();
}

/** Loads api.js once per page; rejects when an ad-blocker or the network eats it. */
function loadRecaptcha(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.grecaptcha?.render) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const fail = () => {
      scriptPromise = null;
      reject(new Error("reCAPTCHA could not be loaded. Check your connection or ad-blocker."));
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.addEventListener("error", fail, { once: true });
      document.head.appendChild(script);
    }

    const startedAt = Date.now();
    const poll = () => {
      if (window.grecaptcha?.render) return resolve();
      if (Date.now() - startedAt > SCRIPT_TIMEOUT_MS) return fail();
      window.setTimeout(poll, 120);
    };
    poll();
  });

  return scriptPromise;
}

export default function RealRecaptcha({ siteKey, onToken }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<number | null>(null);
  const mounted = useRef(true);
  /** keeps the render callback pointed at the latest parent handler */
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "pending" | "failed">("loading");
  const [error, setError] = useState("");
  const [box, setBox] = useState({ scale: 1, height: NATIVE_H });

  /* ------------------------------------------------------- fit the iframe */

  const fit = useCallback(() => {
    const host = hostRef.current;
    const wrapper = boxRef.current;
    if (!host || !wrapper) return;
    const frame = host.querySelector("iframe");
    const naturalWidth = frame?.offsetWidth || NATIVE_W;
    const naturalHeight = host.scrollHeight || frame?.offsetHeight || NATIVE_H;
    const available = wrapper.clientWidth || naturalWidth;
    const scale = Math.min(1, available / naturalWidth);
    setBox({ scale, height: Math.max(naturalHeight * scale, NATIVE_H * scale) });
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /* ------------------------------------------------------------ the render */

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError("");

    const start = async () => {
      try {
        await loadRecaptcha();
      } catch (loadError) {
        if (cancelled) return;
        setStatus("failed");
        setError(loadError instanceof Error ? loadError.message : "reCAPTCHA could not be loaded.");
        return;
      }
      const grecaptcha = window.grecaptcha;
      const host = hostRef.current;
      if (cancelled || !host || !grecaptcha) return;
      if (widgetId.current !== null) {
        setStatus("ready");
        return;
      }

      widgetId.current = grecaptcha.render(host, {
        sitekey: siteKey,
        theme: "light",
        size: "normal",
        callback: (token: string) => {
          setStatus("pending");
          setError("");
          void onTokenRef.current(token).then((accepted) => {
            if (!mounted.current) return;
            setStatus("ready");
            if (accepted) return;
            // Server said no: reset the checkbox so it can be tried again. The
            // page shows the specific reason (serverError), so no message here.
            setError("");
            if (widgetId.current !== null) window.grecaptcha?.reset(widgetId.current);
          });
        },
        "expired-callback": () => {
          if (!mounted.current) return;
          setStatus("ready");
          setError("The check expired. Please tick the box again.");
        },
        "error-callback": () => {
          if (!mounted.current) return;
          setStatus("ready");
          setError("reCAPTCHA reported an error. Please tick the box again.");
        },
      });
      setStatus("ready");
      window.setTimeout(fit, 60);
    };

    void start();
    return () => {
      cancelled = true;
    };
  }, [attempt, fit, siteKey]);

  /* ------------------------------------------- keep the scale in sync */

  useEffect(() => {
    const host = hostRef.current;
    const wrapper = boxRef.current;
    if (!host || !wrapper) return;

    fit();
    const observer = new ResizeObserver(() => fit());
    observer.observe(host);
    observer.observe(wrapper);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [fit, status]);

  const retry = useCallback(() => {
    forgetLoader();
    widgetId.current = null;
    setAttempt((value) => value + 1);
  }, []);

  return (
    <div className={styles.real}>
      <div
        ref={boxRef}
        className={styles.realBox}
        style={{ height: box.height }}
        aria-busy={status === "loading" || status === "pending"}
      >
        <div ref={hostRef} className={styles.realHost} style={{ transform: "scale(" + box.scale + ")" }} />
      </div>

      {status === "loading" && (
        <p className={styles.realHint} aria-live="polite">
          <SpinnerIcon size={14} className={styles.spinner} /> Loading reCAPTCHA&hellip;
        </p>
      )}

      {status === "pending" && (
        <p className={styles.realHint} aria-live="polite">
          <SpinnerIcon size={14} className={styles.spinner} /> Verifying&hellip;
        </p>
      )}

      {status === "failed" && (
        <p className={styles.error} role="alert">
          <span className={styles.errorMark} aria-hidden="true">
            !
          </span>
          {error}{" "}
          <button type="button" className={styles.errorRetry} onClick={retry}>
            Retry
          </button>
        </p>
      )}

      {error && status !== "failed" && (
        <p className={styles.error} role="alert">
          <span className={styles.errorMark} aria-hidden="true">
            !
          </span>
          {error}
        </p>
      )}

      <noscript>
        <p className={styles.error}>Please enable JavaScript to complete the verification.</p>
      </noscript>
    </div>
  );
}
