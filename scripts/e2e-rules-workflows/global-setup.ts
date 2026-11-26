import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import { signInToGeneratedApp } from "./lib/generated-signin";

/**
 * Against a generated application, sign in and open the rule editor once before any test, so
 * the dev server's first compile of Monaco and the GoRules bundle is not charged to a test.
 */
export default async function globalSetup(config: FullConfig) {
  if (process.env.LOGIC_TARGET !== "generated") return;
  const project = config.projects[0];
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const baseURL = project?.use.baseURL;
    // The sign-in opens its own context; hand it one that knows where the application is.
    const state = await signInToGeneratedApp({
      newContext: (options: object) => browser.newContext({ ...options, baseURL }),
    } as unknown as Parameters<typeof signInToGeneratedApp>[0]);
    const file = path.join(tmpdir(), `generated-state-${process.pid}.json`);
    writeFileSync(file, JSON.stringify(state));
    process.env.GENERATED_STORAGE_STATE = file;
  } finally {
    await browser.close();
  }
}
