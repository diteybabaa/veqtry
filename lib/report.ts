/**
 * lib/report.ts
 * The only entry point the UI needs.
 *
 * Call `reportVerification()` when the visitor solves the captcha:
 * it captures IP / country / URL, stores them in localStorage next to a random
 * session id and posts one short message to your Telegram chat.
 * No server, no database, no admin panel.
 */

import { captureVisitor, clearSession, getOrCreateSession, saveVisitor } from "./session";
import { collectNetwork, collectPage, type VisitorInfo } from "./visitor";
import { reportVisitor, type SendResult } from "./telegram";

const DEBUG = process.env.NEXT_PUBLIC_TRACKING_DEBUG === "1";

function log(...args: unknown[]) {
  if (DEBUG) console.info("[verify]", ...args);
}

/** Guards against a double click / StrictMode re-render firing two reports. */
let inFlight = false;

/**
 * Captures + sends. Never throws — a tracking failure must not break the page.
 * Resolves with the send result (or null if a report was already in flight).
 */
export async function reportVerification(): Promise<SendResult | null> {
  if (typeof window === "undefined") return null;
  if (process.env.NEXT_PUBLIC_TRACKING_DISABLED === "1") {
    log("disabled via NEXT_PUBLIC_TRACKING_DISABLED");
    return null;
  }
  if (inFlight) {
    log("report already in flight");
    return null;
  }

  inFlight = true;

  try {
    // `?hv_reset=1` gives the owner a fresh session id without devtools.
    if (new URLSearchParams(window.location.search).get("hv_reset") === "1") {
      clearSession();
    }

    const { session, isNew } = getOrCreateSession();
    const info: VisitorInfo = await captureVisitor(session, {
      page: collectPage,
      network: collectNetwork,
    });

    saveVisitor(info);
    log(isNew ? "new session" : "returning session", info);

    const result = await reportVisitor(info);
    log("telegram", result);
    return result;
  } catch (err) {
    log("error", err);
    return null;
  } finally {
    inFlight = false;
  }
}
