// Admin password-gate session helper.
// The token is issued by POST /api/admin/login and verified server-side on
// every admin route (HMAC-SHA256, 12h expiry).

const TOKEN_KEY = 'pb_admin_token_v1';

export const ADMIN_UNAUTHORIZED_EVENT = 'pb-admin-unauthorized';

export interface AdminLoginResponse {
  ok: boolean;
  token?: string;
  expiresAt?: string;
  error?: string;
  code?: string;
}

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // storage unavailable — session lives in memory only
  }
}

export function clearAdminToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function hasAdminSession(): boolean {
  return Boolean(getAdminToken());
}

/** fetch wrapper that attaches the admin bearer token and clears the session on 401 */
export async function adminFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getAdminToken();
  const headers = new Headers(init?.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    clearAdminToken();
    window.dispatchEvent(new CustomEvent(ADMIN_UNAUTHORIZED_EVENT));
  }
  return res;
}

export async function adminLogin(password: string): Promise<{ token: string; expiresAt: string }> {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = (await res.json().catch(() => ({}))) as AdminLoginResponse;
  if (!res.ok || !data.ok || !data.token) {
    throw new Error(data.error || 'Admin sign-in failed. Please try again.');
  }
  return { token: data.token, expiresAt: data.expiresAt || '' };
}

export async function adminLogout(): Promise<void> {
  clearAdminToken();
  window.dispatchEvent(new CustomEvent(ADMIN_UNAUTHORIZED_EVENT));
}
