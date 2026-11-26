/**
 * Host-injected Git port: the package cannot bypass a host's access checks,
 * repository boundaries, journal, lock, or index. No Node imports in this module.
 */
export interface GitHistoryPort {
  showFile(commit: string, path: string): Promise<string>;
  diffFile(from: string, to: string, path: string): Promise<string>;
  historyForFile(path: string, limit: number): Promise<string[]>;
  commitFiles?(files: Record<string, string>, message: string): Promise<string>;
}
function safePath(path: string): void {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((p) => !p || p === ".." || p === ".git") ||
    [...path].some((c) => c.charCodeAt(0) < 32)
  )
    throw new Error("Unsafe artifact path");
}
function safeCommit(commit: string): void {
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Expected a full commit ID");
}
export async function showFileAtCommit(port: GitHistoryPort, commit: string, path: string) {
  safeCommit(commit);
  safePath(path);
  return port.showFile(commit, path);
}
export async function diffFile(port: GitHistoryPort, from: string, to: string, path: string) {
  safeCommit(from);
  safeCommit(to);
  safePath(path);
  return port.diffFile(from, to, path);
}
export async function historyForFile(port: GitHistoryPort, path: string, limit = 20) {
  safePath(path);
  return port.historyForFile(path, Math.max(1, Math.min(100, Math.floor(limit) || 20)));
}
/** The application supplies its durable commit coordinator, never a raw git commit. */
export async function commitArtifactPair(
  port: GitHistoryPort,
  mmdPath: string,
  mmd: string,
  yamlPath: string,
  yaml: string,
  message: string
) {
  safePath(mmdPath);
  safePath(yamlPath);
  if (!port.commitFiles) throw new Error("This Git port is read-only");
  return port.commitFiles({ [mmdPath]: mmd, [yamlPath]: yaml }, message);
}
