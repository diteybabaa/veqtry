"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { GoogleIcon, StarIcon } from "./icons";
import styles from "./DetailsFlow.module.css";

type Details = {
  name: string;
  email: string;
  phone: string;
};

const EMPTY: Details = { name: "", email: "", phone: "" };

export default function DetailsFlow() {
  const router = useRouter();
  const [details, setDetails] = useState<Details>(EMPTY);
  const [reviewing, setReviewing] = useState(false);

  const update = useCallback(
    (key: keyof Details) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      setDetails((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const closeReview = useCallback(() => setReviewing(false), []);

  // Esc closes the review sheet; scroll stays locked while it is open.
  useEffect(() => {
    if (!reviewing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReviewing(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [reviewing]);

  const handleSubmit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setReviewing(true);
  }, []);

  const phone = details.phone.trim();

  return (
    <div className={styles.page}>
      <div className={styles.photoLayer} aria-hidden="true">
        <Image
          src="/hero.png"
          alt=""
          fill
          priority
          sizes="(max-width: 900px) 100vw, 58vw"
          className={styles.photo}
        />
        <div className={styles.veil} />
      </div>

      <aside className={styles.brand}>
        <div className={styles.brandInner}>
          <div className={styles.logo}>
            <StarIcon size={21} className={styles.logoStar} />
            <span className={styles.logoWord}>Heineken</span>
          </div>

          <p className={styles.kickerDark}>Expert interview</p>

          <h1 className={styles.brandTitle}>
            Your expertise helps shape <em>what&rsquo;s next</em>
          </h1>

          <span className={styles.rule} aria-hidden="true" />

          <p className={styles.brandCopy}>
            We&rsquo;re conducting a short, compensated expert interview to learn
            from your experience with Google Ads and related marketing
            strategies.
          </p>
        </div>
      </aside>

      <section className={styles.panel} aria-labelledby="details-title">
        <div className={styles.topLockup} aria-hidden="true">
          A more open world
          <span className={styles.topRule} />
        </div>

        <div className={styles.panelInner}>
          <p className={styles.kicker}>Get started</p>

          <h2 id="details-title" className={styles.title}>
            Tell us a bit about yourself
          </h2>

          <p className={styles.lede}>
            {"You've been invited to a 45-minute expert interview on Google Ads.\nAs a thank you for your time, you will receive $600 for your participation."}
          </p>

          <form className={styles.form} onSubmit={handleSubmit} noValidate={false}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="full-name">
                Full name
              </label>
              <input
                id="full-name"
                name="name"
                className={styles.input}
                type="text"
                autoComplete="name"
                placeholder="Enter your full name"
                required
                value={details.name}
                onChange={update("name")}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="email">
                Email address
              </label>
              <input
                id="email"
                name="email"
                className={styles.input}
                type="email"
                autoComplete="email"
                placeholder="Enter your email address"
                required
                value={details.email}
                onChange={update("email")}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="phone">
                Phone number
              </label>
              <input
                id="phone"
                name="phone"
                className={styles.input}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="Enter your phone number"
                value={details.phone}
                onChange={update("phone")}
              />
            </div>

            <button className={styles.submit} type="submit">
              Continue
              <span className={styles.submitArrow} aria-hidden="true">
                &rarr;
              </span>
            </button>
          </form>
        </div>
      </section>

      {reviewing && (
        <div
          className={styles.backdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeReview();
          }}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
          >
            <button
              className={styles.close}
              type="button"
              onClick={closeReview}
              aria-label="Close"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
                <path
                  d="M1 1l12 12M13 1L1 13"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            <p className={styles.kicker}>One more look</p>

            <h2 id="review-title" className={styles.modalTitle}>
              Review your details
            </h2>

            <p className={styles.modalSub}>
              A little expertise can make a big difference.
            </p>

            <dl className={styles.rows}>
              <div className={styles.row}>
                <dt className={styles.rowLabel}>Full name</dt>
                <dd className={styles.rowValue}>{details.name.trim() || "—"}</dd>
              </div>
              <div className={styles.row}>
                <dt className={styles.rowLabel}>Email address</dt>
                <dd className={styles.rowValue}>{details.email.trim() || "—"}</dd>
              </div>
              <div className={styles.row}>
                <dt className={styles.rowLabel}>Phone number</dt>
                <dd className={styles.rowValue}>{phone || "—"}</dd>
              </div>
            </dl>

            <button
              className={styles.google}
              type="button"
              onClick={() => router.push("/google")}
            >
              <GoogleIcon size={16} />
              Continue with Google
            </button>

            <button className={styles.back} type="button" onClick={closeReview}>
              Back to your details
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
