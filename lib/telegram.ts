/**
 * lib/telegram.ts
 * Sends the visitor payload straight from the browser to the Telegram Bot API.
 * There is no server in between — which is exactly why the bot token is public.
 * Use a dedicated, throw-away bot and rotate the token if it leaks.
 */

import type { VisitorInfo } from "./visitor";

/* ──────────────────────────────────────────────────────────────────────────
   👇 PASTE YOUR TELEGRAM DETAILS HERE 👇

   TELEGRAM_BOT_TOKEN — from @BotFather, e.g. "123456789:AAAbBcCdD..."
   TELEGRAM_CHAT_ID   — your raw numeric chat id, e.g. "123456789"
                        (negative number like "-1001234567890" for a group)

   How to get the chat id: send any message to your bot, then open
   https://api.telegram.org/bot<TOKEN>/getUpdates and copy
   result[0].message.chat.id.

   These two values are compiled into the browser bundle (there is no server,
   the browser posts directly to api.telegram.org), so use a bot dedicated to
   this project and /revoke the token if it gets abused.
   Optionally override the API host via NEXT_PUBLIC_TELEGRAM_API_BASE.
────────────────────────────────────────────────────────────────────────── */

export const TELEGRAM_BOT_TOKEN = ""; // ← bot token between the quotes
export const TELEGRAM_CHAT_ID = ""; // ← raw numeric chat id between the quotes

export type TelegramConfig = {
  token: string;
  chatId: string;
  apiBase: string;
};

function isUsable(value: string): boolean {
  return value.trim() !== "" && !/paste|your[_-]?token|xxxx/i.test(value);
}

export function getTelegramConfig(): TelegramConfig | null {
  // Inline constants win; NEXT_PUBLIC_* env vars are the fallback.
  const token = isUsable(TELEGRAM_BOT_TOKEN)
    ? TELEGRAM_BOT_TOKEN.trim()
    : (process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = isUsable(TELEGRAM_CHAT_ID)
    ? TELEGRAM_CHAT_ID.trim()
    : (process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID ?? "").trim();
  const apiBase = (process.env.NEXT_PUBLIC_TELEGRAM_API_BASE ?? "").trim();

  if (!token || !chatId) return null;
  return {
    token,
    chatId,
    apiBase: (apiBase || "https://api.telegram.org").replace(/\/+$/, ""),
  };
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return escapeHtml(String(value));
}

function code(value: string | number | null | undefined): string {
  const v = dash(value);
  return v === "—" ? v : "<code>" + v + "</code>";
}

const MAX_LEN = 3900; // Telegram hard limit is 4096 after HTML parsing

/** Builds the Telegram message: one new connection, four fields. */
export function formatVisitorMessage(info: VisitorInfo): string {
  const n = info.network;
  const country = [
    dash(n.country),
    n.countryCode ? "(" + escapeHtml(n.countryCode) + ")" : null,
    n.flag,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");

  const lines: string[] = [
    "<b>\u2b50\ufe0f New Connection Established</b>",
    "",
    "\u2022 Session ID: " + code(info.sessionId),
    "\u2022 IP: " + code(n.ip),
    "\u2022 Country: " + (country || "\u2014"),
    "\u2022 URL: " + code(info.page.url.slice(0, 300)),
  ];

  return lines.join("\n").slice(0, MAX_LEN);
}

export type SendResult = {
  ok: boolean;
  status: number | null;
  description: string;
};

type TelegramResponse = {
  ok?: boolean;
  description?: string;
  parameters?: { retry_after?: number };
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * POSTs to /bot<token>/sendMessage. Retries once on 429 (honouring retry_after)
 * and falls back to a GET request if the POST is blocked by CORS.
 */
export async function sendToTelegram(
  config: TelegramConfig,
  text: string,
  attempts = 2,
): Promise<SendResult> {
  const endpoint = config.apiBase + "/bot" + config.token + "/sendMessage";
  const body = {
    chat_id: config.chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };

  let last: SendResult = { ok: false, status: null, description: "not attempted" };

  for (let i = 0; i < attempts; i += 1) {
    try {
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        // CORS preflight blocked or network error → plain GET (no preflight).
        const qs = new URLSearchParams({
          chat_id: body.chat_id,
          text: body.text,
          parse_mode: "HTML",
          disable_web_page_preview: "true",
        });
        res = await fetch(endpoint + "?" + qs.toString(), { method: "GET" });
      }

      const data = (await res.json().catch(() => ({}))) as TelegramResponse;

      if (res.ok && data.ok !== false) {
        return { ok: true, status: res.status, description: "sent" };
      }

      const retryAfter = data.parameters?.retry_after;
      last = {
        ok: false,
        status: res.status,
        description: data.description ?? "HTTP " + res.status,
      };

      if (res.status === 429 && retryAfter && i < attempts - 1) {
        await sleep(Math.min(retryAfter, 10) * 1000);
        continue;
      }
      return last;
    } catch (err) {
      last = {
        ok: false,
        status: null,
        description: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return last;
}

/** Convenience: format + send in one call. */
export async function reportVisitor(info: VisitorInfo): Promise<SendResult> {
  const config = getTelegramConfig();
  if (!config) {
    return { ok: false, status: null, description: "Telegram bot token / chat id are not configured" };
  }
  return sendToTelegram(config, formatVisitorMessage(info));
}
