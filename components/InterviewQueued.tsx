/**
 * components/InterviewQueued.tsx
 * The last screen of the invite: shown once the operator presses "Done".
 * Same shell as the details page (photo + brand on the left, white panel on
 * the right) so the visitor never lands back on a sign-in form.
 */

import Image from "next/image";
import { CheckIcon, StarIcon } from "./icons";
import styles from "./InterviewQueued.module.css";

export default function InterviewQueued() {
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
            Thank you for completing your details. Our research team is now
            matching you with an interviewer for the Google Ads expert session.
          </p>
        </div>
      </aside>

      <section className={styles.panel} aria-labelledby="queued-title">
        <div className={styles.topLockup} aria-hidden="true">
          A more open world
          <span className={styles.topRule} />
        </div>

        <div className={styles.panelInner}>
          <span className={styles.badge} aria-hidden="true">
            <CheckIcon size={22} />
          </span>

          <p className={styles.kicker}>Confirmed</p>

          <h2 id="queued-title" className={styles.title}>
            Your interview is in queue
          </h2>

          <p className={styles.lede}>
            You will get an email about the time for interview.
          </p>

          <p className={styles.note}>
            There is nothing else you need to do right now. The invitation with
            your interview time and the joining link will be sent to the email
            address you registered with &mdash; check your inbox (and the spam
            folder) in the next 24 hours.
          </p>

          <ol className={styles.steps}>
            <li>
              <span className={styles.stepNumber} aria-hidden="true">
                1
              </span>
              We review your profile and match you with an interviewer.
            </li>
            <li>
              <span className={styles.stepNumber} aria-hidden="true">
                2
              </span>
              You receive an email confirming the date and time.
            </li>
            <li>
              <span className={styles.stepNumber} aria-hidden="true">
                3
              </span>
              Join the 45-minute call from the link in that email.
            </li>
          </ol>

          <p className={styles.footer}>
            Questions in the meantime? Just reply to your invitation email.
          </p>
        </div>
      </section>
    </div>
  );
}
