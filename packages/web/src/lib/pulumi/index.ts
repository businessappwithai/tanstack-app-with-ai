import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function findPulumiBin(): Promise<string | null> {
  // Check default install location first (~/.pulumi/bin/pulumi)
  const defaultBin = path.join(os.homedir(), ".pulumi", "bin", "pulumi");
  try {
    await fs.access(defaultBin, fs.constants?.X_OK ?? 1);
    return defaultBin;
  } catch {}
  // Fall back to PATH
  return new Promise((resolve) => {
    const probe = spawn("which", ["pulumi"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    probe.stdout.on("data", (c) => { out += String(c); });
    probe.on("error", () => resolve(null));
    probe.on("close", (code) => resolve(code === 0 ? out.trim() : null));
  });
}

/** Auto-installs Pulumi via the official script if not present. */
export async function ensurePulumi(
  onLog: (msg: string) => void
): Promise<{ ok: true; bin: string } | { ok: false; reason: string }> {
  const existing = await findPulumiBin();
  if (existing) return { ok: true, bin: existing };

  onLog("Pulumi not found — installing automatically (this takes ~30s on first run)…");

  const installed = await new Promise<boolean>((resolve) => {
    const proc = spawn("sh", ["-c", "curl -fsSL https://get.pulumi.com | sh"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PULUMI_SKIP_UPDATE_CHECK: "true" },
    });
    proc.stdout.on("data", (c) => onLog(String(c).trimEnd()));
    proc.stderr.on("data", (c) => onLog(String(c).trimEnd()));
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });

  if (!installed) {
    return {
      ok: false,
      reason: "Auto-install failed. Install Pulumi manually: https://www.pulumi.com/docs/install/",
    };
  }

  const bin = await findPulumiBin();
  if (!bin) {
    return {
      ok: false,
      reason: "Pulumi installed but binary not found. Try reopening the terminal.",
    };
  }

  onLog(`Pulumi installed at ${bin}`);
  return { ok: true, bin };
}

/** @deprecated Use ensurePulumi() — this never auto-installs. */
export async function pulumiAvailable(): Promise<{ ok: boolean; reason?: string }> {
  const bin = await findPulumiBin();
  return bin ? { ok: true } : { ok: false, reason: "pulumi not installed" };
}

export { deployAWS } from "./aws";
export { deployGCP } from "./gcp";
export { deployAzure } from "./azure";
export { deployOracle } from "./oracle";
export type {
  CloudProvider,
  AWSCredentials,
  GCPCredentials,
  AzureCredentials,
  OracleCredentials,
  CloudCredentials,
  DeployInput,
} from "./types";
