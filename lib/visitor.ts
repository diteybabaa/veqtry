/**
 * lib/visitor.ts
 * Browser-side collection. Intentionally minimal: IP, country and page URL only.
 * Nothing here touches device sensors, screen size or browser fingerprint data.
 */

/* ------------------------------------------------------------------ types */

export type NetworkInfo = {
  ip: string | null;
  /** Full country name, e.g. "Kosovo". */
  country: string | null;
  /** ISO-3166 alpha-2, e.g. "XK". */
  countryCode: string | null;
  /** 🇽🇰 */
  flag: string | null;
  /** "ipwho.is" | "ipapi.co" | "ipify" — which provider answered. */
  source: string;
  error: string | null;
  checkedAt: string;
};

export type PageInfo = {
  url: string;
};

export type VisitorInfo = {
  v: 2;
  sessionId: string;
  capturedAt: string;
  sessionStartedAt: string;
  network: NetworkInfo;
  page: PageInfo;
};

/* ------------------------------------------------------------- utilities */

const GEO_TIMEOUT_MS = 4500;

async function fetchJson(url: string, timeoutMs = GEO_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function pick(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : null;
}

/** Basic sanity check so a captive-portal / HTML page can never become the "IP". */
function looksLikeIp(value: string | null): value is string {
  if (!value) return false;
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value) || (value.includes(":") && /^[0-9a-fA-F:]+$/.test(value));
}

/** "XK" -> "🇽🇰". Works for any two letters, including non-ISO codes like XK. */
export function flagEmoji(countryCode: string | null): string | null {
  if (!countryCode || !/^[A-Za-z]{2}$/.test(countryCode)) return null;
  const base = 0x1f1e6;
  return String.fromCodePoint(
    ...countryCode
      .toUpperCase()
      .split("")
      .map((c) => base + (c.charCodeAt(0) - 65)),
  );
}

/* ------------------------------------------------------------ geo lookup */

const EMPTY_NETWORK: Omit<NetworkInfo, "source" | "error" | "checkedAt"> = {
  ip: null,
  country: null,
  countryCode: null,
  flag: null,
};

async function fromIpWhoIs(): Promise<Partial<NetworkInfo>> {
  const data = await fetchJson("https://ipwho.is/");
  if (pick(data, "success") === false) {
    throw new Error(str(pick(data, "message")) ?? "ipwho.is rejected the request");
  }
  const countryCode = str(pick(data, "country_code"));
  return {
    ip: str(pick(data, "ip")),
    country: str(pick(data, "country")),
    countryCode,
    flag: str(pick(pick(data, "flag"), "emoji")) ?? flagEmoji(countryCode),
  };
}

async function fromIpApiCo(): Promise<Partial<NetworkInfo>> {
  const data = await fetchJson("https://ipapi.co/json/");
  if (pick(data, "error") === true) {
    throw new Error(str(pick(data, "reason")) ?? "ipapi.co rejected the request");
  }
  const countryCode = str(pick(data, "country_code"));
  return {
    ip: str(pick(data, "ip")),
    country: str(pick(data, "country_name")),
    countryCode,
    flag: flagEmoji(countryCode),
  };
}

async function fromIpify(): Promise<Partial<NetworkInfo>> {
  // IP only — country stays unknown if the two providers above failed.
  const data = await fetchJson("https://api.ipify.org?format=json");
  return { ip: str(pick(data, "ip")) };
}

/**
 * IP + country. Never throws; failures end up in `error` so the message still
 * goes out with the IP (or with "—" if every provider failed).
 */
export async function collectNetwork(): Promise<NetworkInfo> {
  const checkedAt = new Date().toISOString();
  const errors: string[] = [];
  const providers: Array<{ name: string; fn: () => Promise<Partial<NetworkInfo>> }> = [
    { name: "ipwho.is", fn: fromIpWhoIs },
    { name: "ipapi.co", fn: fromIpApiCo },
    { name: "ipify", fn: fromIpify },
  ];

  for (const provider of providers) {
    try {
      const partial = await provider.fn();
      const merged = { ...EMPTY_NETWORK, ...partial };
      if (!looksLikeIp(merged.ip)) throw new Error("no usable IP in response");
      return {
        ...merged,
        source: provider.name,
        error: errors.length ? errors.join("; ") : null,
        checkedAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(
        provider.name + ": " + (message === "The user aborted a request." ? "timeout" : message),
      );
    }
  }

  return {
    ...EMPTY_NETWORK,
    source: "none",
    error: errors.join("; ") || "all geo providers failed",
    checkedAt,
  };
}

/* ------------------------------------------------------------------ page */

export function collectPage(): PageInfo {
  return { url: typeof location !== "undefined" ? location.href : "" };
}
