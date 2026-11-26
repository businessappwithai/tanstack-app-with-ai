/**
 * A signed-in client for the generated application, as the editors use it:
 * the same `/api` routes through the front end's proxy, the same session cookie.
 */

export const BASE = process.env.GEN_URL ?? "http://localhost:4000";

export class Session {
  private cookie = "";

  static async signIn(
    email = process.env.GEN_EMAIL ?? "admin@admin.com",
    password = process.env.GEN_PASSWORD ?? "admin123"
  ): Promise<Session> {
    const session = new Session();
    const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`sign-in answered ${res.status}`);
    session.cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    return session;
  }

  async call<T = any>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; body: T }> {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: this.cookie, Origin: BASE },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not JSON
    }
    return { status: res.status, body: parsed };
  }

  get = <T = any>(path: string) => this.call<T>("GET", path);
  post = <T = any>(path: string, body?: unknown) => this.call<T>("POST", path, body);
  put = <T = any>(path: string, body?: unknown) => this.call<T>("PUT", path, body);
  del = <T = any>(path: string) => this.call<T>("DELETE", path);
}
