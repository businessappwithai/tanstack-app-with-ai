/**
 * Deploy a generated application by building it into an image.
 *
 * "Deploy" used to print three encouraging lines and a URL that nothing was
 * listening on. What it does now is the thing that is actually reusable: take
 * the generated project on disk and hand it to `docker build`, producing an
 * image that carries the whole application — API, web front end, migrations and
 * seeds — and can be run anywhere with a database.
 *
 * The build runs against whatever daemon the socket points at. In the container
 * image that is the host's, mounted in; there is no daemon inside.
 *
 * Output is streamed as it arrives rather than collected: an image build is
 * minutes long and a progress bar that only moves at the end is not progress.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import { requireProjectAccess } from "@/lib/project-access";

/** Docker tags are lowercase, and separators are limited. */
function toImageTag(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  return slug || "generated-app";
}

/** Whether a docker daemon is actually reachable, and why not when it is not. */
async function dockerAvailable(): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const probe = spawn("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    probe.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    probe.on("error", () =>
      resolve({ ok: false, reason: "the docker command is not installed in this environment" })
    );
    probe.on("close", (code) => {
      if (code === 0) return resolve({ ok: true });
      resolve({
        ok: false,
        reason:
          stderr.includes("Cannot connect") || stderr.includes("docker.sock")
            ? "no docker daemon is reachable — mount /var/run/docker.sock into this container"
            : stderr.trim() || "docker is not usable here",
      });
    });
  });
}

/** Slugify a project name for use in docker resource names. */
function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "app";
}

/**
 * Ensure a Postgres container is running on a dedicated Docker network.
 * Returns the DATABASE_URL pointing at the container (via its network hostname).
 * Idempotent: calling twice reuses the existing container and network.
 */
async function ensurePostgres(
  slug: string,
  dbName: string,
  log: (level: string, msg: string) => void
): Promise<string> {
  const network = `appwithai-${slug}`;
  const container = `appwithai-${slug}-db`;
  const password = "postgres";
  const user = "postgres";

  // Create network (ignore "already exists")
  await new Promise<void>((resolve) => {
    const p = spawn("docker", ["network", "create", network], { stdio: ["ignore", "ignore", "pipe"] });
    p.on("close", () => resolve());
    p.on("error", () => resolve());
  });

  // Check if container is already running
  const running = await new Promise<boolean>((resolve) => {
    const p = spawn("docker", ["inspect", "--format", "{{.State.Running}}", container], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    p.stdout.on("data", (c) => { out += String(c); });
    p.on("close", (code) => resolve(code === 0 && out.trim() === "true"));
    p.on("error", () => resolve(false));
  });

  if (!running) {
    log("info", `Starting Postgres container (${container}) on network ${network}…`);
    const startCode = await new Promise<number>((resolve) => {
      const p = spawn(
        "docker",
        [
          "run", "-d", "--rm",
          "--name", container,
          "--network", network,
          "-e", `POSTGRES_USER=${user}`,
          "-e", `POSTGRES_PASSWORD=${password}`,
          "-e", `POSTGRES_DB=${dbName}`,
          "postgres:16-alpine",
        ],
        { stdio: ["ignore", "ignore", "pipe"] }
      );
      p.on("error", () => resolve(-1));
      p.on("close", (code) => resolve(code ?? -1));
    });
    if (startCode !== 0) throw new Error(`Failed to start Postgres container — is Docker running?`);

    // Wait for Postgres to accept connections (up to 30s)
    log("info", "Waiting for Postgres to be ready…");
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      ready = await new Promise<boolean>((resolve) => {
        const p = spawn(
          "docker",
          ["exec", container, "pg_isready", "-U", user, "-d", dbName],
          { stdio: ["ignore", "ignore", "ignore"] }
        );
        p.on("close", (code) => resolve(code === 0));
        p.on("error", () => resolve(false));
      });
      if (ready) break;
    }
    if (!ready) throw new Error("Postgres container did not become ready within 30s");
    log("success", "Postgres ready");
  } else {
    log("info", `Reusing existing Postgres container (${container})`);
  }

  return `postgresql://${user}:${password}@${container}:5432/${dbName}`;
}

export const Route = createFileRoute("/api/deploy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Read the body and settle access before a single byte of the stream
        // is written. A refusal has to be an HTTP status: an SSE frame saying
        // "denied" arrives inside a 200, and the caller has already been given
        // a build. Unguarded, this route ran `docker build` over somebody
        // else's generated application for anyone who could name a project id.
        const body = (await request.json().catch(() => ({}))) as {
          projectId?: string;
          envVars?: Array<{ key: string; value: string }>;
        };
        const { projectId, envVars } = body;
        if (!projectId) {
          return new Response(JSON.stringify({ error: "Missing required field: projectId" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const access = await requireProjectAccess(request, projectId, "read_write");
        if (access.response) return access.response;

        const encoder = new TextEncoder();

        const stream = new ReadableStream({
          async start(controller) {
            let closed = false;
            const send = (payload: Record<string, unknown>) => {
              if (closed) return;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            };
            const log = (level: string, message: string) => send({ log: message, level });

            // A single image-build step can be silent for minutes — copying a
            // dependency tree, or a slow compile. Without something on the wire
            // the connection is closed as idle and the build dies with it, so a
            // comment goes out on a timer. SSE ignores comment frames.
            const heartbeat = setInterval(() => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(": keep-alive\n\n"));
              } catch {
                // The client is gone; the close path below will tidy up.
              }
            }, 15_000);

            const finish = () => {
              if (closed) return;
              closed = true;
              clearInterval(heartbeat);
              controller.close();
            };
            const fail = (error: string) => {
              send({ error });
              finish();
            };

            try {
              const { projectDb } = await import("@appwithai/core/services");
              const project = await projectDb.findById(projectId);
              if (!project) return fail("Project not found");

              const projectPath = project.generatedPath;
              if (!projectPath) {
                return fail(
                  "This project has not been generated yet — run the generate step first"
                );
              }

              // The Dockerfile is what makes the project buildable. An older
              // project generated before it existed needs regenerating, and
              // saying so is more useful than docker's "no such file".
              const dockerfile = path.join(projectPath, "Dockerfile");
              try {
                await fs.access(dockerfile);
              } catch {
                return fail(
                  `No Dockerfile in ${projectPath}. Regenerate the application to produce one.`
                );
              }

              const docker = await dockerAvailable();
              if (!docker.ok) return fail(`Cannot build an image: ${docker.reason}`);

              const tag = `${toImageTag(project.name)}:${Date.now()}`;
              const latest = `${toImageTag(project.name)}:latest`;

              // Behind a TLS-intercepting proxy the build cannot install
              // dependencies unless it trusts the same CA this process does.
              // Copying it into the project's certificate directory means the
              // build works without anyone having to know that.
              // The Dockerfile always does `COPY docker/ca-certificates/ …`; if the
              // directory is absent Docker fails with "not found" even when no
              // certificate was ever needed. Ensure it exists unconditionally.
              const certsDir = path.join(projectPath, "docker", "ca-certificates");
              await fs.mkdir(certsDir, { recursive: true });

              const caSource = process.env.DEPLOY_EXTRA_CA_CERT;
              if (caSource) {
                try {
                  await fs.copyFile(caSource, path.join(certsDir, "deploy-ca.crt"));
                  log("info", "Added the configured CA certificate to the build context");
                } catch (error) {
                  log(
                    "warn",
                    `Could not stage ${caSource}: ${
                      error instanceof Error ? error.message : "unknown error"
                    }`
                  );
                }
              }

              log("info", `Building ${tag} from ${projectPath}`);
              log(
                "info",
                "This takes a few minutes the first time — layers are cached after that."
              );

              // Proxy settings are passed through rather than assumed absent:
              // the build runs on the host daemon, which does not inherit this
              // process's environment.
              const proxyArgs: string[] = [];
              for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"]) {
                const value = process.env[name] ?? process.env[name.toLowerCase()];
                if (value) proxyArgs.push("--build-arg", `${name}=${value}`);
              }

              const build = spawn(
                "docker",
                [
                  "build",
                  ...(process.env.DEPLOY_BUILD_NETWORK
                    ? ["--network", process.env.DEPLOY_BUILD_NETWORK]
                    : []),
                  ...proxyArgs,
                  "-t",
                  tag,
                  "-t",
                  latest,
                  // No `--progress plain`: it is a buildx flag, and a daemon
                  // without the buildx plugin rejects it outright with exit 125.
                  // Output is plain anyway when nothing is attached to a TTY.
                  ".",
                ],
                { cwd: projectPath, stdio: ["ignore", "pipe", "pipe"] }
              );

              // Docker writes build progress to stderr, so both streams carry
              // output worth showing and neither is inherently an error.
              const relay = (chunk: unknown) => {
                for (const line of String(chunk).split("\n")) {
                  const text = line.trimEnd();
                  if (text) log("info", text);
                }
              };
              build.stdout.on("data", relay);
              build.stderr.on("data", relay);

              const code = await new Promise<number>((resolve) => {
                build.on("error", () => resolve(-1));
                build.on("close", (exitCode) => resolve(exitCode ?? -1));
              });

              if (code !== 0) {
                return fail(`docker build exited with code ${code}`);
              }

              log("success", `Built ${tag}`);
              log("info", `Also tagged ${latest}`);

              const liveUrl = `http://localhost:${project.port}`;

              // Build the env var list from what the user submitted.
              const runEnvArgs: string[] = [];
              for (const ev of envVars ?? []) {
                if (ev.key && ev.value !== undefined) runEnvArgs.push("-e", `${ev.key}=${ev.value}`);
              }

              // The image runs with NODE_ENV=production, where Better Auth stops
              // trusting localhost implicitly and accepts only the origins named
              // in CORS_ORIGIN. The container is published on this project's
              // port, so that is the address people open. Without it every
              // sign-in answered 403 "Invalid origin" — which looks like a wrong
              // password rather than a missing environment variable.
              const hasCorsOrigin = (envVars ?? []).some(
                (ev) => ev.key === "CORS_ORIGIN" && ev.value
              );
              if (!hasCorsOrigin) {
                runEnvArgs.push(
                  "-e",
                  `CORS_ORIGIN=${liveUrl},http://127.0.0.1:${project.port}`
                );
              }

              // Auto-provision a Postgres container + Docker network when DATABASE_URL is absent.
              const slug = toSlug(project.name);
              const dbName = slug.replace(/-/g, "_") || "app";
              const network = `appwithai-${slug}`;
              const hasDatabaseUrl = (envVars ?? []).some((ev) => ev.key === "DATABASE_URL" && ev.value);
              if (!hasDatabaseUrl) {
                try {
                  const databaseUrl = await ensurePostgres(slug, dbName, log);
                  runEnvArgs.push("-e", `DATABASE_URL=${databaseUrl}`);
                  runEnvArgs.push("-e", `DATABASE_NAME=${dbName}`);
                } catch (err) {
                  log("warning", `Could not auto-provision Postgres: ${err instanceof Error ? err.message : err}. Set DATABASE_URL manually if needed.`);
                }
              }

              log("info", `Starting container on port ${project.port}…`);
              const runProc = spawn(
                "docker",
                [
                  "run", "-d", "--rm",
                  "--network", network,
                  "-p", `${project.port}:${project.port}`,
                  "-p", `${project.port + 1}:${project.port + 1}`,
                  ...runEnvArgs,
                  latest,
                ],
                { stdio: ["ignore", "pipe", "pipe"] }
              );
              let containerIdRaw = "";
              let runErrRaw = "";
              runProc.stdout.on("data", (chunk) => { containerIdRaw += String(chunk); });
              runProc.stderr.on("data", (chunk) => { runErrRaw += String(chunk); });
              const runCode = await new Promise<number>((resolve) => {
                runProc.on("error", () => resolve(-1));
                runProc.on("close", (c) => resolve(c ?? -1));
              });

              let containerId: string | undefined;
              if (runCode === 0) {
                containerId = containerIdRaw.trim();
                log("success", `Container started: ${containerId.slice(0, 12)}`);
              } else {
                log("error", `Could not start container: ${runErrRaw.trim() || "unknown error"}`);
                log("info", `Start it by hand: docker run -p ${project.port}:${project.port} ${runEnvArgs.join(" ")} ${latest}`);
              }

              await projectDb
                .update(projectId, {
                  deploymentStatus: containerId ? "running" : "deployed",
                  deployment_url: liveUrl,
                })
                .catch(() => {});

              if (containerId) {
                const { deploymentDb } = await import("@appwithai/core/services");
                await deploymentDb
                  .upsert({ project_id: projectId, status: "running", deployment_url: liveUrl, port: project.port, process_id: containerId })
                  .catch(() => {});
              }

              send({ complete: true, image: tag, url: liveUrl });
              finish();
            } catch (error) {
              console.error("[deploy] failed:", error);
              fail(error instanceof Error ? error.message : "Deployment failed");
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
