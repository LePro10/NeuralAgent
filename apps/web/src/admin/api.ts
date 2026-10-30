// Typed client for the relay's JSON API (same origin). The access token lives in memory only;
// the rotating refresh token and the device id are kept in localStorage (key `na-admin`).

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string | null;
  status: "pending" | "approved" | "denied" | "blocked";
  is_admin: boolean;
  remote: boolean;
  message?: string | null;
  provider: string;
  created_at: number;
  decided_at?: number | null;
  devices: number;
  online: number;
  bytes: number;
  last_seen?: number | null;
}

export interface Device {
  id: string;
  name: string;
  platform: string;
  kind: string;
  online: boolean;
  last_seen?: number | null;
}

export interface DayStats {
  day: string;
  signins?: number;
  connections?: number;
  pairings?: number;
  requests?: number;
  active_devices?: number;
}

export interface Stats {
  users: number;
  pending: number;
  devices: number;
  online: number;
  days: DayStats[];
}

export interface Session {
  user: User;
}

export interface Config {
  providers: string[];
  pair_ttl?: number;
}

interface Tokens {
  access: string;
  refresh: string;
  expires_in: number;
  device_id: string;
  user: User;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const KEY = "na-admin";
const redirectUri = () => `${location.origin}/admin/`;

// ── Storage ───────────────────────────────────────────────────────────────────

interface Stored {
  refresh: string;
  device_id: string;
}

function load(): Stored | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") as Stored | null;
  } catch {
    return null;
  }
}

function save(s: Stored | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the session just will not survive a reload */
  }
}

export const hasStoredSession = () => load() !== null;

// ── base64url ─────────────────────────────────────────────────────────────────

export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ── Tokens ────────────────────────────────────────────────────────────────────

let access: string | null = null;
let expiresAt = 0;
let refreshing: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Called when the refresh token is rejected or the user signs out. */
export const onSignedOut = (cb: () => void) => (listeners.add(cb), () => void listeners.delete(cb));

function clear() {
  access = null;
  expiresAt = 0;
  save(null);
  listeners.forEach((cb) => cb());
}

function adopt(t: Tokens) {
  access = t.access;
  expiresAt = Date.now() + t.expires_in * 1000;
  // Refresh tokens rotate: persist the new one right away, the old one is dead.
  save({ refresh: t.refresh, device_id: t.device_id });
}

/** One refresh at a time: a second concurrent use of the old token would sign the device out. */
function refresh(): Promise<void> {
  refreshing ??= (async () => {
    const stored = load();
    if (!stored) throw new ApiError(401, "Not signed in");
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh: stored.refresh }),
    });
    if (res.status === 401) {
      clear();
      throw new ApiError(401, "Session expired");
    }
    if (!res.ok) throw await fail(res);
    adopt((await res.json()) as Tokens);
  })().finally(() => (refreshing = null));
  return refreshing;
}

async function fail(res: Response): Promise<ApiError> {
  let msg = res.statusText || `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) msg = body.error;
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, msg);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (!access || Date.now() > expiresAt - 60_000) await refresh();
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { authorization: `Bearer ${access}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && attempt === 0) {
      access = null; // expired early: refresh and retry once
      continue;
    }
    if (!res.ok) throw await fail(res);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

// ── Sign-in (OAuth + PKCE, in the browser) ───────────────────────────────────

const PENDING = "na-admin-oauth";

export async function config(): Promise<Config> {
  const res = await fetch("/api/config");
  if (!res.ok) throw await fail(res);
  return (await res.json()) as Config;
}

/** Leaves the page for the provider. `extra` carries the test sign-in's email and name. */
export async function startSignIn(provider: string, extra: Record<string, string> = {}) {
  const verifier = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const state = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const challenge = b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state }));
  const q = new URLSearchParams({ redirect_uri: redirectUri(), state, code_challenge: challenge, code_challenge_method: "S256", ...extra });
  location.assign(`/auth/${provider}/start?${q}`);
}

function browserName(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "browser";
}

/** Handles `?code=…&state=…` or `?error=…` after the redirect back. Returns null if the URL has neither. */
export async function finishSignIn(): Promise<{ error?: string } | null> {
  const q = new URLSearchParams(location.search);
  const code = q.get("code");
  const error = q.get("error");
  if (!code && !error) return null;
  const state = q.get("state");
  history.replaceState(null, "", location.pathname);
  const pending = sessionStorage.getItem(PENDING);
  sessionStorage.removeItem(PENDING);
  if (error) return { error };
  const saved = pending ? (JSON.parse(pending) as { verifier: string; state: string }) : null;
  if (!code || !saved || saved.state !== state) return { error: "Sign-in could not be verified. Please try again." };
  const res = await fetch("/api/auth/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      verifier: saved.verifier,
      redirect_uri: redirectUri(),
      device: { name: `Admin (${browserName()})`, platform: "web", kind: "client" },
    }),
  });
  if (!res.ok) return { error: (await fail(res)).message };
  adopt((await res.json()) as Tokens);
  return {};
}

/** Makes sure there is a usable access token (restores the session after a reload). */
export const restore = () => refresh();

export async function signOut() {
  try {
    if (access) await fetch("/api/auth/logout", { method: "POST", headers: { authorization: `Bearer ${access}` } });
  } catch {
    /* offline: still sign out locally */
  }
  clear();
}

// ── Admin endpoints ───────────────────────────────────────────────────────────

export const api = {
  session: () => call<Session>("GET", "/api/admin/session"),
  users: () => call<{ users: User[] }>("GET", "/api/admin/users").then((r) => r.users),
  userAction: (id: string, action: "approve" | "deny" | "block" | "unblock" | "remote_on" | "remote_off") =>
    call<{ user: User }>("POST", `/api/admin/users/${encodeURIComponent(id)}/${action}`).then((r) => r.user),
  deleteUser: (id: string) => call<unknown>("DELETE", `/api/admin/users/${encodeURIComponent(id)}`),
  devices: (id: string) => call<{ devices: Device[] }>("GET", `/api/admin/users/${encodeURIComponent(id)}/devices`).then((r) => r.devices),
  deleteDevice: (id: string) => call<unknown>("DELETE", `/api/admin/devices/${encodeURIComponent(id)}`),
  stats: (days = 30) => call<Stats>("GET", `/api/admin/stats?days=${days}`),
};
