/**
 * Fifty workflows — lifecycle, status machine and process — built in the Logic
 * step's editors with nothing but the page: no API call writes or reads one.
 * Each is saved, the page is reloaded, and the workflow is opened again from the
 * rail to prove what the ladder or the diagram shows is what was built.
 *
 * `WF_ONLY=<substring>` runs the workflows whose name contains it.
 */

import { expect, test } from "@playwright/test";
import { expectWorkflowShown, LogicPage } from "../lib/logic-page";
import { type Author, authorWithProject, browserAs } from "../lib/session";
import { WORKFLOWS } from "../scenarios/workflow-catalogue";

const only = process.env.WF_ONLY;
const workflows = WORKFLOWS.filter((w) => !only || w.name.includes(only));

test.describe("workflow editors — workflows built through the page", () => {
  let author: Author;

  test.beforeAll(async ({ playwright }) => {
    author = await authorWithProject(playwright, "workflow-editor");
  });
  test.afterAll(async () => {
    await author.session.request.dispose();
  });

  for (const wf of workflows) {
    test(`${wf.kind}: ${wf.name} (${wf.entity})`, async ({ browser }, testInfo) => {
      test.setTimeout(240_000);
      const context = await browserAs(browser, author);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const logic = new LogicPage(page, author.projectId);

      await logic.open();
      await logic.createWorkflow(wf);
      await testInfo.attach("built", { body: await page.screenshot(), contentType: "image/png" });
      await logic.save();

      await logic.open();
      await logic.select(wf.name);
      await expectWorkflowShown(logic, wf);
      expect(errors, "no uncaught error in the page").toEqual([]);
      await context.close();
    });
  }
});
