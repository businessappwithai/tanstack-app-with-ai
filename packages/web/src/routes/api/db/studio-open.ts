/**
 * GET /api/db/studio-open
 *
 * Starts LibreDB Studio (if not already running), logs in server-side, and
 * bridges the auth cookie to the browser via a 302 redirect.
 *
 * Cookie scoping note: HTTP cookies are hostname-scoped, not port-scoped.
 * A Set-Cookie issued by localhost:3000 with no explicit Domain attribute is
 * stored for the host "localhost" and is sent to ALL ports on localhost,
 * including 3002.  With SameSite=Lax the redirect target (localhost:3002) is
 * same-site, so the cookie arrives on the first request and the user lands
 * directly on the studio — no login screen.
 */

import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/require-user";

const STUDIO_PORT = 3002;
const STUDIO_URL = `http://localhost:${STUDIO_PORT}`;
const ADMIN_EMAIL = "admin@libredb.org";

/** Read the generated admin password from the launcher's cache directory. */
async function readAdminPassword(): Promise<string | null> {
  const { readFile } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const path = await import("node:path");

  // The launcher writes this file; find the highest cached version.
  const cacheBase = path.join(homedir(), ".libredb-studio");
  try {
    const { readdir } = await import("node:fs/promises");
    const versions = await readdir(cacheBase).catch(() => [] as string[]);
    const sorted = versions
      .filter((v) => /^\d/.test(v))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const ver of sorted) {
      const p = path.join(cacheBase, ver, "payload", "data", "auth-bootstrap.json");
      try {
        const raw = await readFile(p, "utf8");
        const parsed = JSON.parse(raw) as { adminPassword?: string };
        if (parsed.adminPassword) return parsed.adminPassword;
      } catch {
        // try next version
      }
    }
  } catch {
    // cache not found
  }
  return null;
}

/** Login to the studio and return the raw Set-Cookie header string. */
async function loginToStudio(password: string): Promise<string | null> {
  try {
    const res = await fetch(`${STUDIO_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password }),
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return res.headers.get("set-cookie");
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/db/studio-open")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const caller = await requireUser(request, "db:studio-open", "read");
        if (caller.response) return caller.response;

        const password = await readAdminPassword();
        if (!password) {
          return new Response("LibreDB Studio credentials not found.", { status: 503 });
        }

        const cookie = await loginToStudio(password);

        const headers = new Headers({ Location: STUDIO_URL });
        if (cookie) {
          // Forward the studio's auth-token cookie so the browser carries it to localhost:3002.
          // Cookies are hostname-scoped (not port-scoped), so the cookie set here is sent to
          // localhost:3002 on the subsequent redirect request.
          headers.set("Set-Cookie", cookie);
        }

        return new Response(null, { status: 302, headers });
      },
    },
  },
});
