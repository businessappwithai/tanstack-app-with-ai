import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/require-user";

const STUDIO_PORT = 3002;
const STUDIO_URL = `http://localhost:${STUDIO_PORT}`;

// Singleton process handle — survives across requests for the lifetime of the dev server.
let studioProc: ReturnType<typeof import("node:child_process").spawn> | null = null;
// Track the last seed file path so we can overwrite it when the project DB changes.
let currentSeedPath: string | null = null;

async function isStudioReady(): Promise<boolean> {
  try {
    // LibreDB Studio serves its UI at the root; any 2xx/3xx means the server is up.
    const res = await fetch(STUDIO_URL, {
      signal: AbortSignal.timeout(1500),
      redirect: "manual",
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

// First run downloads the release archive from GitHub (~30 MB) and caches it in
// ~/.libredb-studio/<version>/. Give it up to 3 minutes.
async function waitForReady(maxMs = 180_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await isStudioReady()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function findBun(): Promise<string> {
  // The dev server runs under Node.js (vinxi) where `bunx` may not be in PATH.
  // Probe common locations then fall back to PATH lookup.
  const { existsSync } = await import("node:fs");
  const candidates = [
    // Reflex-managed Bun (most common on this machine)
    `${process.env["HOME"] ?? ""}/.reflex/bun/bin/bun`,
    // System bun via reflex
    "/Users/pramodkoshy/Library/Application Support/reflex/bun/bin/bun",
    // Homebrew / manual installs
    "/usr/local/bin/bun",
    "/opt/homebrew/bin/bun",
    // $BUN_INSTALL
    `${process.env["BUN_INSTALL"] ?? ""}/bin/bun`,
  ];
  for (const p of candidates) {
    if (p !== "/bin/bun" && existsSync(p)) return p;
  }
  // Last resort: let the OS find it
  return "bun";
}

// Fixed seed path — stable across Vite hot-reloads so the running studio always polls the same file.
const SEED_DIR = `${process.env["HOME"] ?? "/tmp"}/.libredb-studio/appwithai-seed`;
const SEED_FILE = `${SEED_DIR}/seed-connections.yaml`;

/** Build a seed-connections.yaml for the given connection string. */
async function writeSeedConfig(overrideUrl?: string): Promise<string | null> {
  const { writeFile, mkdir } = await import("node:fs/promises");

  // Prefer the caller-supplied URL (project's saved database_url), then fall back to
  // the tool's own DATABASE_URL / PG* env vars.
  let connStr: string | null = overrideUrl ?? null;
  if (!connStr) {
    const dbUrl = process.env["DATABASE_URL"];
    const pgHost = process.env["PGHOST"];
    const pgPort = process.env["PGPORT"];
    const pgUser = process.env["PGUSER"];
    const pgPassword = process.env["PGPASSWORD"];
    const pgDatabase = process.env["PGDATABASE"];
    if (dbUrl) {
      connStr = dbUrl;
    } else if (pgHost && pgDatabase) {
      connStr = `postgresql://${pgUser ?? ""}:${pgPassword ?? ""}@${pgHost}:${pgPort ?? 5432}/${pgDatabase}`;
    }
  }

  if (!connStr) return null;

  // Parse the connection string into host/port/user/password/database fields
  // that LibreDB Studio's seed format expects.
  let host = "localhost";
  let port = 5432;
  let user = "";
  let password = "";
  let database = "";
  let ssl = false;
  try {
    const u = new URL(connStr);
    host = u.hostname;
    port = u.port ? Number(u.port) : 5432;
    user = decodeURIComponent(u.username);
    password = decodeURIComponent(u.password);
    database = u.pathname.replace(/^\//, "");
    ssl = u.searchParams.get("sslmode") !== "disable";
  } catch {
    return null;
  }

  // Local postgres typically doesn't have SSL; don't force it.
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const useSsl = ssl && !isLocal;

  // LibreDB Studio ssl field is an optional object with a `mode` enum.
  // { mode: "disable" } turns SSL off; omitting the field defaults to require for remote hosts.
  const sslYaml = useSsl
    ? "    ssl:\n      rejectUnauthorized: false"
    : "    ssl:\n      mode: disable";

  // Turn "shipping_management" → "Shipping Management", "shipping" → "Shipping"
  const dbLabel = database
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const lines = [
    'version: "1"',
    "defaults:",
    "  managed: true",
    "connections:",
    `  - id: "db-${database}"`,
    `    name: "${dbLabel}"`,
    "    type: postgres",
    `    host: ${host}`,
    `    port: ${port}`,
    `    database: ${database}`,
    `    user: "${user}"`,
  ];
  if (password) lines.push(`    password: "${password.replace(/"/g, '\\"')}"`);
  lines.push(sslYaml);
  lines.push("    roles:");
  lines.push('      - "*"');
  lines.push("    color: '#6366f1'");

  const yaml = lines.join("\n");

  // Write to the fixed stable path so the running studio always polls the same file,
  // even after Vite hot-reloads reset the in-memory currentSeedPath variable.
  await mkdir(SEED_DIR, { recursive: true });
  await writeFile(SEED_FILE, yaml, "utf8");
  currentSeedPath = SEED_FILE;
  return SEED_FILE;
}

async function ensureStudio(databaseUrl?: string): Promise<{ url: string }> {
  // Always (re)write the seed file so a project switch updates the connection while the
  // studio is already running — LibreDB Studio polls it every few seconds.
  await writeSeedConfig(databaseUrl);

  if (await isStudioReady()) return { url: STUDIO_URL };

  const { spawn } = await import("node:child_process");
  const bunBin = await findBun();
  // Always use the fixed stable path so a restarted studio finds the same seed file.
  const seedConfigPath = SEED_FILE;

  // `bun x --bun` runs the launcher under Bun, which reports process.versions.node as 26.x —
  // above the Node 24 floor the launcher checks. Plain node (22) is refused.
  studioProc = spawn(bunBin, ["x", "--bun", "@libredb/studio", "--port", String(STUDIO_PORT)], {
    env: {
      ...process.env,
      PORT: String(STUDIO_PORT),
      // Suppress the built-in SQLite sample connections.
      SQLITE_EMBEDDED_SAMPLE: "false",
      ...(seedConfigPath ? { SEED_CONFIG_PATH: seedConfigPath } : {}),
    },
    // Pipe stdout so we can detect the "Starting LibreDB Studio" message.
    stdio: ["ignore", "pipe", "ignore"],
    detached: false,
  });

  // Prevent an unhandled error event from crashing the dev server.
  studioProc.on("error", (err) => {
    console.error("[studio] spawn error:", err.message);
    studioProc = null;
  });

  studioProc.on("exit", () => {
    studioProc = null;
  });

  // The launcher logs "Starting LibreDB Studio <ver> on http://..." when it's ready.
  // Resolve the promise early on that signal; fall back to HTTP polling.
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };

    studioProc?.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Starting LibreDB Studio")) done();
    });

    // Fallback: poll HTTP until the server answers.
    void waitForReady().then(done);
  });

  if (!(await isStudioReady())) {
    throw new Error(
      "LibreDB Studio did not become ready. " +
        "On first run it downloads the release archive from GitHub — check your network connection."
    );
  }

  return { url: STUDIO_URL };
}

export const Route = createFileRoute("/api/db/studio")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const caller = await requireUser(request, "db:studio", "read");
        if (caller.response) return caller.response;
        const ready = await isStudioReady();
        return Response.json({ ready, url: STUDIO_URL });
      },

      POST: async ({ request }) => {
        const caller = await requireUser(request, "db:studio", "write");
        if (caller.response) return caller.response;
        try {
          const body = await request.json().catch(() => ({})) as { databaseUrl?: string };
          const result = await ensureStudio(body.databaseUrl);
          return Response.json({ ...result, ready: true });
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed to start studio" },
            { status: 500 }
          );
        }
      },
    },
  },
});
