/** Server-only Git/filesystem adapter. No shell, hooks, global config, or shared index. */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export class RepositoryError extends Error {
  constructor(
    message: string,
    public status = 409
  ) {
    super(message);
  }
}
export type Files = Record<string, string | null>; // base64 bytes; null deletes a managed file
export const encode = (text: string) => Buffer.from(text).toString("base64");
export const decode = (text: string) => Buffer.from(text, "base64").toString("utf8");
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const MODEL = "model/model.eml.mmd";
export const EDITOR = "model/editor.eml.mmd";
export const GENERATION = ".appwithai/generation.json";
export const MANIFEST = ".appwithai/generated-files.json";
const OMIT = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".output",
  ".vinxi",
  ".cache",
  "coverage",
  "logs",
  "data",
  ".mastra",
  ".next",
]);
const SOURCE =
  /\.(?:[cm]?[jt]sx?|json|jsonc|ya?ml|toml|md|mmd|txt|sql|css|scss|html|sh|prisma|graphql|gql|svg|hbs|lock)$/i;
export function allowedFile(name: string): boolean {
  if ([...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  const parts = name.split("/");
  if (
    name.startsWith("/") ||
    name.includes("\\") ||
    parts.some((p) => !p || p === "." || p === ".." || OMIT.has(p))
  )
    return false;
  if (
    parts.some((p) =>
      /(?:secret|credential|private[-_]?key)|\.(?:pem|key|p12|db|sqlite|log|pid)$/i.test(p)
    )
  )
    return false;
  const base = parts.at(-1)!;
  if (base.startsWith(".env") && ![".env.example", ".env.sample", ".env.template"].includes(base))
    return false;
  return (
    SOURCE.test(base) ||
    /^(?:Dockerfile(?:\..+)?|Makefile|\.gitignore|\.dockerignore|\.env\.(?:example|sample|template)|LICENSE)$/.test(
      base
    )
  );
}

export function outputRoot(): string {
  if (process.env.DEFAULT_OUTPUT_DIR) return path.resolve(process.env.DEFAULT_OUTPUT_DIR);
  const cwd = process.cwd();
  return path.basename(cwd) === "web" && path.basename(path.dirname(cwd)) === "packages"
    ? path.join(cwd, "generated-projects")
    : path.join(cwd, "packages/web/generated-projects");
}

export async function projectDirectory(projectId: string, root = outputRoot()): Promise<string> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId))
    throw new RepositoryError("Invalid project ID", 400);
  await fs.mkdir(root, { recursive: true });
  root = await fs.realpath(root);
  const dir = path.join(root, projectId);
  await fs.mkdir(dir, { recursive: true });
  if ((await fs.lstat(dir)).isSymbolicLink() || (await fs.realpath(dir)) !== dir)
    throw new RepositoryError("Project directory must not be a symlink");
  return dir;
}

async function checkedPath(dir: string, name: string): Promise<string> {
  if (!allowedFile(name)) throw new RepositoryError(`Unmanaged or unsafe path: ${name}`, 400);
  const segments = name.split("/");
  let current = dir;
  for (const part of segments) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (stat?.isSymbolicLink()) throw new RepositoryError(`Symlink is not allowed: ${name}`);
  }
  return current;
}

export async function readFile(dir: string, name: string): Promise<string | null> {
  const file = await checkedPath(dir, name);
  try {
    return (await fs.readFile(file)).toString("base64");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function inventory(dir: string): Promise<Files> {
  const files: Files = {};
  let total = 0;
  async function walk(relative = "") {
    for (const entry of await fs.readdir(path.join(dir, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!OMIT.has(entry.name) && !entry.name.startsWith(".")) await walk(name);
        else if (entry.name === ".appwithai") await walk(name);
      } else if (entry.isFile() && allowedFile(name)) {
        const stat = await fs.stat(path.join(dir, name));
        total += stat.size;
        if (stat.size > 5_000_000 || total > 100_000_000 || Object.keys(files).length >= 10000)
          throw new RepositoryError("Project source exceeds the snapshot size limit", 413);
        files[name] = await readFile(dir, name);
      }
    }
  }
  await walk();
  return files;
}

export async function git(
  dir: string,
  args: string[],
  input?: string | Buffer,
  extraEnv: Record<string, string> = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
    );
    const child = spawn(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.autocrlf=false",
        ...args,
      ],
      {
        cwd: dir,
        env: {
          ...env,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
          ...extraEnv,
        },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
    child.stdout.on("data", (b: Buffer) => {
      size += b.length;
      if (size > 12_000_000) child.kill("SIGKILL");
      else chunks.push(b);
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr = (stderr + b.toString()).slice(-2000);
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(
        new RepositoryError("Git could not start. Install Git on the application server.", 503)
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"));
      else
        reject(
          new RepositoryError(
            `Git operation failed (${args[0]}): ${stderr.trim() || "timeout or output limit"}`,
            503
          )
        );
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export async function ensureRepository(
  dir: string,
  projectId: string,
  pending = false,
  readOnly = false
): Promise<void> {
  const stat = await fs.lstat(path.join(dir, ".git")).catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
    throw new RepositoryError(
      "Linked worktrees and symlink repositories cannot be attached automatically"
    );
  if (!stat && readOnly)
    throw new RepositoryError(
      "Local repository is missing. Restore it from a backup before continuing.",
      409
    );
  if (!stat) await git(dir, ["init", "--initial-branch=main"]);
  const top = (await git(dir, ["rev-parse", "--show-toplevel"])).trim();
  if ((await fs.realpath(top)) !== (await fs.realpath(dir)))
    throw new RepositoryError("Refusing to use the enclosing repository");
  const marker = await readFile(dir, ".appwithai/project.json");
  if (marker && JSON.parse(decode(marker)).projectId !== projectId)
    throw new RepositoryError("Repository belongs to another project");
  // We never consume an external index, but refuse to obscure staged user work.
  if (!pending && (await git(dir, ["diff", "--cached", "--name-only"])).trim())
    throw new RepositoryError(
      "Repository has staged changes. Commit or unstage them before using APPWITHAI."
    );
}

export async function head(dir: string): Promise<string | null> {
  const refs = await git(dir, ["rev-parse", "--verify", "--quiet", "HEAD"]).catch(() => "");
  return /^[a-f0-9]{40,64}$/.test(refs.trim()) ? refs.trim() : null;
}
export async function assertCommit(dir: string, commit: string): Promise<void> {
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new RepositoryError("Invalid commit", 400);
  await git(dir, ["cat-file", "-e", `${commit}^{commit}`]);
}
export async function treeFiles(dir: string, commit: string, prefix?: string): Promise<Files> {
  await assertCommit(dir, commit);
  const list = await git(dir, ["ls-tree", "-r", "-z", commit, ...(prefix ? ["--", prefix] : [])]);
  const files: Files = {};
  for (const row of list.split("\0").filter(Boolean)) {
    const match = /^(100644|100755) blob ([a-f0-9]+)\t(.+)$/.exec(row);
    if (match && allowedFile(match[3]!))
      files[match[3]!] = encode(await git(dir, ["cat-file", "blob", match[2]!]));
  }
  return files;
}

/** Journal replay only accepts the pre-operation bytes or the already-applied bytes. */
export async function publishFiles(dir: string, before: Files, after: Files): Promise<void> {
  for (const name of Object.keys(after)) {
    const current = await readFile(dir, name);
    if (current !== before[name] && current !== after[name])
      throw new RepositoryError(
        `File changed outside this operation: ${name}. Preserve or reconcile the edit before retrying.`
      );
  }
  for (const [name, value] of Object.entries(after)) {
    const current = await readFile(dir, name);
    if (current === value) continue;
    if (current !== before[name])
      throw new RepositoryError(`File changed during publication: ${name}`);
    const target = await checkedPath(dir, name);
    if (value === null)
      await fs.unlink(target).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.${randomUUID()}.tmp`;
      const mode = await fs
        .stat(target)
        .then((s) => s.mode)
        .catch(() => (name.endsWith(".sh") ? 0o755 : 0o644));
      try {
        await fs.writeFile(tmp, Buffer.from(value, "base64"), { flag: "wx", mode });
        await fs.rename(tmp, target);
      } finally {
        await fs.rm(tmp, { force: true });
      }
    }
  }
}

export async function commitFiles(
  dir: string,
  files: Files,
  parent: string | null,
  message: string,
  author: string,
  ref = "HEAD"
): Promise<string> {
  const index = path.join(dir, ".git", `appwithai-index-${randomUUID()}`);
  const env = {
    GIT_INDEX_FILE: index,
    GIT_AUTHOR_NAME: author.replace(/[\r\n<>]/g, " ").slice(0, 120) || "APPWITHAI user",
    GIT_AUTHOR_EMAIL: "local@appwithai.invalid",
    GIT_COMMITTER_NAME: "APPWITHAI",
    GIT_COMMITTER_EMAIL: "local@appwithai.invalid",
  };
  try {
    await git(dir, ["read-tree", ...(parent ? [parent] : ["--empty"])], undefined, env);
    let entries = "";
    for (const [name, value] of Object.entries(files)) {
      if (!allowedFile(name)) throw new RepositoryError(`Unsafe snapshot path: ${name}`);
      if (value === null) entries += `0 ${"0".repeat(40)}\t${name}\0`;
      else {
        const blob = (
          await git(dir, ["hash-object", "-w", "--stdin"], Buffer.from(value, "base64"), env)
        ).trim();
        const executable = await fs
          .stat(path.join(dir, name))
          .then((s) => !!(s.mode & 0o111))
          .catch(() => name.endsWith(".sh"));
        entries += `${executable ? "100755" : "100644"} ${blob}\t${name}\0`;
      }
    }
    await git(dir, ["update-index", "-z", "--index-info"], entries, env);
    const tree = (await git(dir, ["write-tree"], undefined, env)).trim();
    if (parent && tree === (await git(dir, ["rev-parse", `${parent}^{tree}`])).trim())
      return parent;
    const commit = (
      await git(dir, ["commit-tree", tree, ...(parent ? ["-p", parent] : [])], message, env)
    ).trim();
    await git(dir, ["update-ref", ref, commit, parent ?? "0".repeat(40)]);
    // Update the normal index only after HEAD moves; do not touch working files.
    if (ref === "HEAD") await git(dir, ["read-tree", commit]);
    return commit;
  } finally {
    await fs.rm(index, { force: true });
  }
}

/** Three-way merge only owned paths; deletion and new-file collisions are conflicts. */
export async function mergeGenerated(dir: string, old: Files, incoming: Files): Promise<Files> {
  const changes: Files = {};
  const conflicts: string[] = [];
  for (const name of new Set([...Object.keys(old), ...Object.keys(incoming)])) {
    if (name.startsWith("model/") || name.startsWith(".appwithai/") || name === ".gitignore")
      continue;
    const base = old[name] ?? null;
    const next = incoming[name] ?? null;
    const local = await readFile(dir, name);
    if (local === next || next === base) continue;
    if (local === base) {
      changes[name] = next;
      continue;
    }
    if (base !== null && next !== null && local !== null) {
      const temporary = await fs.mkdtemp(path.join(dir, ".git", "merge-"));
      try {
        const names = ["local", "base", "next"].map((n) => path.join(temporary, n));
        await Promise.all(
          [local, base, next].map((v, i) => fs.writeFile(names[i]!, Buffer.from(v, "base64")))
        );
        const merged = await git(dir, ["merge-file", "-p", ...names]).catch(() => null);
        if (merged !== null) {
          changes[name] = encode(merged);
          continue;
        }
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
    }
    conflicts.push(name);
  }
  if (conflicts.length)
    throw new RepositoryError(
      `Generation conflicts with local edits: ${conflicts.join(", ")}. Resolve these files before regenerating.`
    );
  return changes;
}
