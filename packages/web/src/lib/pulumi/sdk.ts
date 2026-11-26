import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { CloudProvider } from "./types";

/**
 * The Pulumi SDK is installed on first deploy, not by `bun install`.
 *
 * The provider packages are 60–100 MB each unpacked (about 770 MB with all of
 * them and their dependencies), only an installation that deploys needs one, and
 * `scripts/ensure-packages-built.ts` would demand every declared one before each
 * `bun run dev`. So no manifest in the workspace declares them: the deploy route
 * installs the provider it is deploying to, at the exact version below, into a
 * directory of its own, and loads it from there.
 *
 * The versions are held to the majors the programs in this directory are written
 * against. Moving one is a change to check: install it next to these files and run
 * `bun check` on them, because nothing in the workspace types the providers.
 */
export const PULUMI_SDK_VERSIONS = {
  "@pulumi/pulumi": "3.272.0",
  "@pulumi/docker": "4.11.2",
  "@pulumi/aws": "6.83.4",
  "@pulumi/azure-native": "2.92.3",
  "@pulumi/gcp": "7.38.0",
  "@pulumi/oci": "2.33.0",
} as const;

type SdkPackage = keyof typeof PULUMI_SDK_VERSIONS;

/** The npm package and the Pulumi plugin each provider deploys with. */
const PROVIDERS: Record<CloudProvider, { pkg: SdkPackage; plugin: string }> = {
  aws: { pkg: "@pulumi/aws", plugin: "aws" },
  gcp: { pkg: "@pulumi/gcp", plugin: "gcp" },
  azure: { pkg: "@pulumi/azure-native", plugin: "azure-native" },
  oracle: { pkg: "@pulumi/oci", plugin: "oci" },
};

/** Where the SDK is installed: `APPWITHAI_PULUMI_SDK_DIR`, else `~/.appwithai/pulumi-sdk`. */
export function pulumiSdkDir(): string {
  return (
    process.env.APPWITHAI_PULUMI_SDK_DIR ?? path.join(os.homedir(), ".appwithai", "pulumi-sdk")
  );
}

// The subset of `@pulumi/pulumi` and `@pulumi/pulumi/automation` the programs here
// call, with Pulumi's own signatures. These are plain types rather than an ambient
// `declare module`, so they never stand in for the real package.

export interface PulumiOutput<T> {
  apply<U>(fn: (value: T) => U | PulumiOutput<U> | Promise<U>): PulumiOutput<U>;
}

export interface PulumiCore {
  interpolate(literals: TemplateStringsArray, ...placeholders: unknown[]): PulumiOutput<string>;
  Config: new (name?: string) => {
    get(key: string): string | undefined;
    require(key: string): string;
  };
}

export interface PulumiStack {
  readonly workspace: {
    installPlugin(name: string, version: string, kind?: string): Promise<void>;
  };
  setConfig(key: string, value: { value: string; secret?: boolean }): Promise<void>;
  up(opts?: { onOutput?: (out: string) => void }): Promise<{
    outputs: Record<string, { value: unknown; secret: boolean }>;
  }>;
}

export interface PulumiAutomation {
  LocalWorkspace: {
    createOrSelectStack(
      args: {
        stackName: string;
        projectName: string;
        program: () => Promise<Record<string, unknown> | void>;
      },
      opts?: { envVars?: Record<string, string> }
    ): Promise<PulumiStack>;
  };
}

export interface PulumiSdk {
  pulumi: PulumiCore;
  automation: PulumiAutomation;
  // The provider packages are not installed in this workspace, so nothing here can
  // type them; the programs give each callback parameter its type explicitly.
  docker: any;
  provider: any;
  /** The plugins the program needs, at the versions its packages were built for. */
  plugins: { name: string; version: string }[];
}

let installing: Promise<unknown> = Promise.resolve();

/**
 * Installs whatever of `@pulumi/pulumi`, `@pulumi/docker` and the provider's
 * package is missing or at another version, then loads all three from
 * {@link pulumiSdkDir}. Installs run one at a time: two deploys at once would
 * otherwise write one `node_modules` together.
 */
export async function loadPulumiSdk(
  provider: CloudProvider,
  onLog: (msg: string) => void
): Promise<PulumiSdk> {
  const { pkg, plugin } = PROVIDERS[provider];
  const wanted: SdkPackage[] = ["@pulumi/pulumi", "@pulumi/docker", pkg];
  const dir = pulumiSdkDir();

  const install = installing.then(() => ensureInstalled(dir, wanted, onLog));
  installing = install.catch(() => undefined);
  await install;

  const require = createRequire(path.join(dir, "package.json"));
  return {
    pulumi: require("@pulumi/pulumi") as PulumiCore,
    automation: require("@pulumi/pulumi/automation") as PulumiAutomation,
    docker: require("@pulumi/docker"),
    provider: require(pkg),
    plugins: [
      { name: plugin, version: `v${PULUMI_SDK_VERSIONS[pkg]}` },
      { name: "docker", version: `v${PULUMI_SDK_VERSIONS["@pulumi/docker"]}` },
    ],
  };
}

/** Installs the plugins {@link loadPulumiSdk} named into the stack's workspace. */
export async function installPlugins(
  stack: PulumiStack,
  sdk: PulumiSdk,
  onLog: (msg: string) => void
): Promise<void> {
  for (const { name, version } of sdk.plugins) {
    onLog(`Installing the ${name} ${version} plugin…`);
    await stack.workspace.installPlugin(name, version);
  }
}

async function installedVersion(dir: string, name: string): Promise<string | undefined> {
  try {
    const manifest = path.join(dir, "node_modules", name, "package.json");
    return (JSON.parse(await fs.readFile(manifest, "utf-8")) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

async function ensureInstalled(
  dir: string,
  wanted: SdkPackage[],
  onLog: (msg: string) => void
): Promise<void> {
  const missing: string[] = [];
  for (const name of wanted) {
    if ((await installedVersion(dir, name)) !== PULUMI_SDK_VERSIONS[name]) {
      missing.push(`${name}@${PULUMI_SDK_VERSIONS[name]}`);
    }
  }
  if (missing.length === 0) return;

  await fs.mkdir(dir, { recursive: true });
  const manifest = path.join(dir, "package.json");
  try {
    await fs.access(manifest);
  } catch {
    const empty = { name: "appwithai-pulumi-sdk", private: true };
    await fs.writeFile(manifest, `${JSON.stringify(empty)}\n`);
  }

  onLog(`Installing the Pulumi SDK into ${dir} (${missing.join(", ")}) — once per version…`);
  // Under `bun --bun` the server's own executable is bun; under Node it is not.
  const bun = process.versions.bun ? process.execPath : "bun";
  const code = await new Promise<number | null>((resolve) => {
    const proc = spawn(bun, ["add", "--exact", ...missing], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout.on("data", (c) => onLog(String(c).trimEnd()));
    proc.stderr.on("data", (c) => onLog(String(c).trimEnd()));
    proc.on("error", () => resolve(null));
    proc.on("close", resolve);
  });
  if (code !== 0) {
    throw new Error(
      `Installing the Pulumi SDK failed (bun add exited ${code ?? "without starting"}). ` +
        `Install it by hand: cd ${dir} && bun add --exact ${missing.join(" ")}`
    );
  }
}
