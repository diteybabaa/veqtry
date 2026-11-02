/**
 * lib/session.ts
 * Random session id + a small record in localStorage. No cookies, no backend.
 */

import type { VisitorInfo } from "./visitor";

export const SESSION_KEY = "hv.session.v1";
export const VISITOR_KEY = "hv.visitor.v1";
const ROTATE_AFTER_DAYS = 30;

export type StoredSession = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
};

/* ------------------------------------------------------------ storage */

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

let memoryStore: Record<string, string> = {};

/** localStorage throws in Safari private mode / when storage is disabled — never break the page. */
export const safeStorage: KV = {
  getItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
    }
  },
  setItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      memoryStore[key] = value;
    }
  },
  removeItem(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      delete memoryStore[key];
    }
  },
};

export function readJson<T>(key: string): T | null {
  const raw = safeStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    safeStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded – ignore */
  }
}

/* ------------------------------------------------------------ session id */

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < bytes; i += 1) buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Random, unguessable, roughly sortable.
 *   hv_lq3k9f2a_7c1e4b9d02f8a63e
 *  ^  ^          ^ 16 random hex chars (8 bytes)
 *  |  base36 timestamp
 */
export function generateSessionId(): string {
  return "hv_" + Date.now().toString(36) + "_" + randomHex(8);
}

export function isValidSessionId(id: string | null | undefined): id is string {
  return typeof id === "string" && /^hv_[0-9a-z]{1,16}_[0-9a-f]{16}$/.test(id);
}

/* ------------------------------------------------------------ session */

function isExpired(session: StoredSession): boolean {
  const created = Date.parse(session.createdAt);
  if (!Number.isFinite(created)) return true;
  return Date.now() - created > ROTATE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

export type SessionResult = {
  session: StoredSession;
  /** true when a fresh id was created on this page load */
  isNew: boolean;
};

export function getOrCreateSession(): SessionResult {
  const stored = readJson<StoredSession>(SESSION_KEY);
  const now = new Date().toISOString();

  if (stored && isValidSessionId(stored.id) && !isExpired(stored)) {
    const session: StoredSession = { ...stored, lastSeenAt: now };
    writeJson(SESSION_KEY, session);
    return { session, isNew: false };
  }

  const session: StoredSession = { id: generateSessionId(), createdAt: now, lastSeenAt: now };
  writeJson(SESSION_KEY, session);
  return { session, isNew: true };
}

export function saveVisitor(info: VisitorInfo): void {
  writeJson(VISITOR_KEY, info);
}

export function loadVisitor(): VisitorInfo | null {
  const data = readJson<VisitorInfo>(VISITOR_KEY);
  if (!data || data.v !== 2 || !isValidSessionId(data.sessionId)) return null;
  return data;
}

export function clearSession(): void {
  safeStorage.removeItem(SESSION_KEY);
  safeStorage.removeItem(VISITOR_KEY);
  memoryStore = {};
}

/* ------------------------------------------------------ collector glue */

/** Builds the payload; the geo lookup is the only slow part (~300–900 ms). */
export async function captureVisitor(
  session: StoredSession,
  collectors: {
    page: () => VisitorInfo["page"];
    network: () => Promise<VisitorInfo["network"]>;
  },
): Promise<VisitorInfo> {
  const network = await collectors.network();

  return {
    v: 2,
    sessionId: session.id,
    capturedAt: new Date().toISOString(),
    sessionStartedAt: session.createdAt,
    network,
    page: collectors.page(),
  };
}
