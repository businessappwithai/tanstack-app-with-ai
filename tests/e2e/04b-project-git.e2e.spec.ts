import { expect, test } from "@playwright/test";
import { adminContext, createProject, createUserSession, SAMPLE_EML, unique } from "./helpers";

test("drafts, named versions, Git context and history survive reload and enforce access", async ({
  playwright,
  browser,
}) => {
  const admin = await adminContext(playwright);
  const owner = await createUserSession(playwright, admin, "git-owner");
  const stranger = await createUserSession(playwright, admin, "git-stranger");
  const projectId = await createProject(owner.request, unique("git-history"));
  const url = `/api/projects/${projectId}/git`;
  const draftResponse = await owner.request.post(url, {
    data: {
      action: "save",
      model: SAMPLE_EML,
      mode: "draft",
      requestId: "draft-first",
      expectedCommit: null,
    },
  });
  expect(draftResponse.status()).toBe(200);
  const draft = await draftResponse.json();
  expect(draft.modelCommit).toMatch(/^[a-f0-9]{40}$/);
  const versions = async () =>
    (await (await owner.request.get(`/api/projects/${projectId}/erd-versions`)).json()).versions;
  expect(await versions()).toHaveLength(0);
  const named = {
    action: "save",
    model: SAMPLE_EML,
    mode: "version",
    requestId: "version-first",
    expectedCommit: draft.modelCommit,
  };
  const saved = await owner.request.post(url, { data: named });
  expect(saved.status()).toBe(200);
  expect(await (await owner.request.post(url, { data: named })).json()).toEqual(await saved.json());
  expect(await versions()).toHaveLength(1);
  const context = await (await owner.request.get(`${url}?action=context`)).json();
  expect(context.commit).toBe(draft.modelCommit);
  expect(context.projection).toContain("entities:");
  expect(context.diagram).toContain("flowchart");
  expect((await stranger.request.get(`${url}?action=context`)).status()).toBe(404);
  expect(
    (
      await stranger.request.post(url, { data: { action: "restore", commit: draft.commit } })
    ).status()
  ).toBe(404);
  const changed = await owner.request.post(url, {
    data: {
      action: "save",
      model: SAMPLE_EML + "\n%% Saved draft comment\n",
      mode: "draft",
      expectedCommit: draft.modelCommit,
    },
  });
  expect(changed.status()).toBe(200);
  expect(
    (
      await owner.request.post(url, {
        data: { action: "save", model: SAMPLE_EML, expectedCommit: draft.modelCommit },
      })
    ).status()
  ).toBe(409);
  const state = await (await owner.request.get(url)).json();
  const diff = await (
    await owner.request.get(`${url}?from=${draft.commit}&to=${state.state.model_commit}`)
  ).json();
  expect(diff.diff).toContain("Saved draft comment");
  const browserContext = await browser.newContext({
    storageState: await owner.request.storageState(),
  });
  try {
    const page = await browserContext.newPage();
    await page.goto(`/projects/${projectId}/design`);
    await page.getByRole("button", { name: "Versions", exact: true }).click();
    await expect(page.getByRole("region", { name: "Local Git history" })).toBeVisible();
    await page.getByRole("button", { name: "History", exact: true }).click();
    await page.getByRole("button", { name: "View saved model summary" }).click();
    await expect(page.getByRole("button", { name: "Download YAML summary" })).toBeVisible();
    await page.reload();
    await expect(page.getByPlaceholder("Enter Mermaid ERD syntax here...")).toHaveValue(
      /Saved draft comment/
    );
  } finally {
    await browserContext.close();
    await owner.request.dispose();
    await stranger.request.dispose();
    await admin.dispose();
  }
});
