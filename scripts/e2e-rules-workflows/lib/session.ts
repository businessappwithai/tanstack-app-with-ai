/**
 * An author, a project and a browser signed in as them.
 *
 * The project routes refuse the administrator ("Admins cannot modify
 * projects"), so the suite registers an ordinary account, has the bootstrap
 * administrator approve it, and works as that account — the same arrangement
 * `tests/e2e/helpers.ts` makes for the main suite, reused rather than copied.
 */

import { readFileSync } from "node:fs";
import {
  type Browser,
  type BrowserContext,
  expect,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import {
  adminContext,
  createUserSession,
  type UserSession,
  unique,
} from "../../../tests/e2e/helpers";
import { signInToGeneratedApp } from "./generated-signin";

/** The model the suite is run against; override with RULES_WORKFLOWS_MODEL. */
export const MODEL_PATH =
  process.env.RULES_WORKFLOWS_MODEL ??
  new URL(
    "../../../docs/eml-sessions/education-management-system/education-management-system.mmd",
    import.meta.url
  ).pathname;

export const MODEL_SOURCE = readFileSync(MODEL_PATH, "utf8");

/**
 * `LOGIC_TARGET=generated` points the same specs at a generated application's
 * Admin → Rules and workflows screen instead of the modelling tool's Logic step. The
 * screen is one component in both (`@appwithai/editors`), so the specs are the proof.
 */
export const GENERATED = process.env.LOGIC_TARGET === "generated";

/**
 * What a rule the model declares is called in a running application. The model keeps a title
 * beside its identifier ("Student Record Control"); the application files it under the
 * identifier alone (`studentRecordControl`) — only a rule written in the application keeps
 * its title. Use it for the rules the model brought, never for ones a spec built.
 */
export const seededRuleName = (title: string) =>
  GENERATED
    ? title
        .replace(/[^A-Za-z0-9]+/g, " ")
        .trim()
        .split(" ")
        .map((word, i) =>
          i === 0
            ? word.toLowerCase()
            : (word[0]?.toUpperCase() ?? "") + word.slice(1).toLowerCase()
        )
        .join("")
    : title;

/** Where the rules and workflows screen lives for this author. */
export const logicPath = (author: { projectId: string }) =>
  GENERATED ? "/admin/automations" : `/projects/${author.projectId}/logic`;

export interface Author {
  session: UserSession;
  projectId: string;
}

export async function authorWithProject(
  playwright: PlaywrightWorkerArgs["playwright"],
  label: string
): Promise<Author> {
  if (GENERATED) {
    // The generated application has no projects: it is signed in as its administrator.
    return {
      session: { request: { dispose: async () => {} } } as unknown as UserSession,
      projectId: "generated",
    };
  }
  const admin = await adminContext(playwright);
  const session = await createUserSession(playwright, admin, label);
  await admin.dispose();
  const response = await session.request.post("/api/projects", {
    data: { name: unique(label), erdCode: MODEL_SOURCE },
  });
  expect(response.status(), "creating the project from the model").toBe(201);
  const { project } = (await response.json()) as { project: { id: string } };
  return { session, projectId: project.id };
}

let generatedState: Awaited<ReturnType<BrowserContext["storageState"]>> | undefined;

export async function browserAs(browser: Browser, author: Author): Promise<BrowserContext> {
  if (GENERATED) {
    // Signed in once and reused: a sign-in per test is a race with the previous test's
    // session, and what is under test is the screen, not the login.
    const file = process.env.GENERATED_STORAGE_STATE;
    generatedState ??= file
      ? JSON.parse(readFileSync(file, "utf8"))
      : await signInToGeneratedApp(browser);
    // Wider than the tool's: the application's navigation takes a column of the page, and a
    // squeezed table puts its add-column control out of reach.
    return browser.newContext({
      storageState: generatedState,
      viewport: { width: 2000, height: 1200 },
    });
  }
  return browser.newContext({
    storageState: await author.session.request.storageState(),
    viewport: { width: 1600, height: 1000 },
  });
}

/** The model as stored now. */
export async function storedModel(author: Author): Promise<string> {
  const response = await author.session.request.get(`/api/projects/${author.projectId}/eml`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { eml: string }).eml;
}

export function scenario<T>(file: string): T {
  return JSON.parse(readFileSync(new URL(`../scenarios/${file}`, import.meta.url), "utf8")) as T;
}
