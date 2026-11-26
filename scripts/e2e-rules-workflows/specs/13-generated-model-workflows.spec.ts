/**
 * The workflows the model declares, on a generated application's Rules & workflows screen.
 *
 * Their rows are compiled for the engine, so the diagram an author drew is written into the
 * front end at generation (`lib/model-logic.ts`) and shown beside the workflows built in the
 * application — read-only, because the next generation rewrites them. Status flows are the
 * exception: the application runs a saved one in place of the model's, so they stay editable.
 *
 * Run with `LOGIC_TARGET=generated` against the education model (`AdmissionToEnrolment`).
 */

import { expect, test } from "@playwright/test";
import { authorWithProject, browserAs, GENERATED, logicPath } from "../lib/session";

test.skip(!GENERATED, "needs LOGIC_TARGET=generated with the education model");

test("a workflow the model declares is listed, readable and locked", async ({
  browser,
  playwright,
}) => {
  test.setTimeout(240_000);
  const author = await authorWithProject(playwright, "model-workflows");
  const context = await browserAs(browser, author);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(logicPath(author));
  await expect(page.getByText("Loading the model…")).toHaveCount(0, { timeout: 60_000 });

  const rail = page.locator("aside").first();
  const row = rail.getByRole("button", { name: /^\s*Admission To Enrolment\b/ }).first();
  await expect(row, "the model's process is on the rail").toBeVisible();
  await expect(rail.getByTitle("Declared in the model").first()).toBeVisible();
  // Nothing about it can be deleted from here.
  await expect(rail.getByLabel("Delete Admission To Enrolment")).toHaveCount(0);

  await row.click();
  await expect(page.getByRole("note")).toContainText("declared in the model");
  // The editor is out of reach of the pointer and the keyboard, so an edit cannot be made and lost.
  await expect(page.locator("[data-locked] ")).toHaveAttribute("inert", "");

  // Saving leaves it alone: it was never written, so nothing is created or deleted for it.
  const writes: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/workflow-definitions/.test(request.url()) && request.method() !== "GET") {
      writes.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Saved to the model/)).toBeVisible({ timeout: 30_000 });
  expect(writes, "no write for a workflow the model owns").toEqual([]);
  expect(errors, "no uncaught error in the page").toEqual([]);
  await context.close();
});
