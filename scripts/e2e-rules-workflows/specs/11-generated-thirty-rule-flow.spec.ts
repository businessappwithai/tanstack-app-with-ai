/**
 * Thirty business rules in one flow, built and tested only through the rule editor.
 *
 * Everything an author can put in a graph, in one rule on Opportunity: a Record,
 * an Expression that works out six facts, a Decision table of eight discount
 * bands, a Function that scores the deal four ways, a Switch with four branches,
 * a second Decision table of eight verdicts, and a Response. Every node is
 * dragged from the Components panel, every line drawn by pointer, every cell
 * typed into the editor. It is then run in the Simulator and in Try it with one
 * sample per path — each table row, each switch branch and each scoring rule is
 * the reason for at least one answer — saved, and opened again.
 *
 * | Node                    | Rules | What they decide                                   |
 * |-------------------------|-------|----------------------------------------------------|
 * | Expression  derive      | 6     | isLarge, isStrategic, isLate, isForeign, fromPartner, noNextStep |
 * | Decision    discountTier| 8     | amount band → discountCap, tier                    |
 * | Function    dealScore   | 4     | +15 large, +10 partner, −25 late, −10 no next step |
 * | Switch      route       | 4     | closed lost / closed won / no amount → no review   |
 * | Decision    verdict     | 8     | four refusals, four ways through, with a message   |
 *
 * Run against a started generated CRM:
 *   E2E_NO_SERVER=1 E2E_BASE_URL=http://127.0.0.1:4000 bunx playwright test -c playwright.config.ts specs/11
 */

import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { RuleGraph } from "../lib/rule-graph";

const EMAIL = process.env.GEN_EMAIL ?? "admin@admin.com";
const PASSWORD = process.env.GEN_PASSWORD ?? "admin123";
const SHOTS = process.env.SHOTS_DIR ?? "test-results/thirty-rules";

const DERIVE: Array<[string, string]> = [
  ["isLarge", "(amount ?? 0) >= 100000"],
  ["isStrategic", "(amount ?? 0) >= 250000"],
  ["isLate", "probability != null and probability < 30"],
  ["isForeign", 'currency_code != null and currency_code != "USD"'],
  ["fromPartner", 'lead_source == "partner" or lead_source == "referral"'],
  ["noNextStep", 'next_step == null or next_step == ""'],
];

const DISCOUNT: Array<[string, string, string]> = [
  [">= 500000", "25", '"platinum"'],
  [">= 250000", "20", '"gold"'],
  [">= 100000", "15", '"silver"'],
  [">= 50000", "10", '"bronze"'],
  [">= 25000", "7", '"standard"'],
  [">= 10000", "5", '"small"'],
  ["> 0", "2", '"micro"'],
  ["", "0", '"none"'],
];

const SCORE = [
  "export const handler = async (input) => {",
  "  let score = 50;",
  "  if (input.isLarge) score += 15;",
  "  if (input.fromPartner) score += 10;",
  "  if (input.isLate) score -= 25;",
  "  if (input.noNextStep) score -= 10;",
  "  return { ...input, score };",
  "};",
].join("\n");

const ROUTE = ['stage == "closed_lost"', 'stage == "closed_won"', "amount == null"];

const VERDICT: Array<[string, string, string]> = [
  [
    "isStrategic and score < 40",
    '"validation-error"',
    '"Strategic deal scoring " + string(score) + " needs a deal-desk review"',
  ],
  [
    "discountCap >= 20 and noNextStep",
    '"validation-error"',
    '"A " + tier + " deal must name its next step"',
  ],
  [
    "isForeign and isLarge and probability < 20",
    '"validation-error"',
    '"A large deal in " + currency_code + " below 20% needs finance sign-off"',
  ],
  ["isLate and isLarge", '"validation-error"', '"A large deal below 30% needs a recovery plan"'],
  ["score >= 75", '"allow"', '"Fast lane: tier " + tier + ", score " + string(score)'],
  ["fromPartner", '"allow"', '"Partner deal: tier " + tier + ", score " + string(score)'],
  [
    "isLarge",
    '"allow"',
    '"Large deal: tier " + tier + ", discount cap " + string(discountCap) + "%"',
  ],
  ["", '"allow"', '"Standard deal: tier " + tier + ", score " + string(score)'],
];

type Sample = { name: string; record: Record<string, unknown>; blocks: boolean; says?: string };

const deal = (over: Record<string, unknown>) => ({
  name: "Thirty-rule test",
  stage: "proposal",
  amount: 30000,
  probability: 50,
  currency_code: "USD",
  lead_source: "web",
  next_step: "Send the quote",
  ...over,
});

const SAMPLES: Sample[] = [
  { name: "switch 1 — closed lost skips the review", record: deal({ stage: "closed_lost", amount: 900000, probability: 0, next_step: "" }), blocks: false },
  { name: "switch 2 — closed won skips the review", record: deal({ stage: "closed_won", amount: 900000, probability: 100, next_step: "" }), blocks: false },
  { name: "switch 3 — no amount skips the review", record: deal({ amount: null, probability: 5, next_step: "" }), blocks: false },
  { name: "verdict 1 — strategic, score 30", record: deal({ stage: "negotiation", amount: 300000, probability: 20, next_step: "" }), blocks: true, says: "Strategic deal scoring 30 needs a deal-desk review" },
  { name: "verdict 2 — platinum with no next step", record: deal({ amount: 600000, probability: 70, lead_source: "referral", next_step: "" }), blocks: true, says: "A platinum deal must name its next step" },
  { name: "verdict 3 — large, EUR, 10%", record: deal({ amount: 120000, probability: 10, currency_code: "EUR", next_step: "Call the CFO" }), blocks: true, says: "A large deal in EUR below 20% needs finance sign-off" },
  { name: "verdict 4 — large and late", record: deal({ amount: 150000, probability: 25, next_step: "Call" }), blocks: true, says: "A large deal below 30% needs a recovery plan" },
  { name: "verdict 5 — fast lane", record: deal({ amount: 200000, probability: 90, lead_source: "partner", next_step: "Demo" }), blocks: false, says: "Fast lane: tier silver, score 75" },
  { name: "verdict 6 — partner deal", record: deal({ amount: 5000, probability: 60, lead_source: "partner" }), blocks: false, says: "Partner deal: tier micro, score 60" },
  { name: "verdict 7 — large deal", record: deal({ amount: 110000, probability: 60 }), blocks: false, says: "Large deal: tier silver, discount cap 15%" },
  { name: "verdict 7 — gold band", record: deal({ amount: 260000, probability: 80 }), blocks: false, says: "Large deal: tier gold, discount cap 20%" },
  { name: "verdict 8 — standard band", record: deal({ amount: 30000, lead_source: "inbound_call" }), blocks: false, says: "Standard deal: tier standard, score 50" },
  { name: "verdict 8 — bronze band", record: deal({ amount: 60000 }), blocks: false, says: "Standard deal: tier bronze, score 50" },
  { name: "verdict 8 — small band", record: deal({ amount: 12000 }), blocks: false, says: "Standard deal: tier small, score 50" },
  { name: "verdict 8 — no band", record: deal({ amount: 0 }), blocks: false, says: "Standard deal: tier none, score 50" },
];

test.use({ viewport: { width: 2000, height: 1400 }, video: "on" });

/** Type into a cell of the open decision table (Developer view: a cell is plain text). */
async function typeCell(page: Page, graph: RuleGraph, row: number, column: number, text: string) {
  if (!text) return;
  const cell = graph.editor.locator("tbody tr >> visible=true").nth(row).locator("td").nth(column);
  await cell.scrollIntoViewIfNeeded();
  await cell.click({ position: { x: 60, y: 20 } });
  // A new output cell starts as `""`: replace what is there rather than append to it.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
}

/** Rename the open table's first output column, then add another. */
async function nameOutputs(page: Page, graph: RuleGraph, first: string, second: string) {
  await graph.editor.locator(".grl-field-edit >> visible=true").filter({ hasText: "output" }).first().click();
  await page.locator("input[value='output']").first().fill(first);
  await page.getByRole("button", { name: "Update" }).click();
  await expect(page.getByText("Output Field")).toHaveCount(0);
  const field = page.getByText("Output Field");
  for (let attempt = 0; attempt < 5 && !(await field.isVisible()); attempt++) {
    await graph.editor
      .locator("thead tr:first-child th:nth-child(3) .cta-wrapper button >> visible=true")
      .first()
      .click();
    await field.waitFor({ timeout: 2500 }).catch(() => {});
  }
  await page.keyboard.type(second);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(graph.editor.locator(".grl-field-edit >> visible=true").filter({ hasText: second })).toBeVisible();
}

async function addRows(page: Page, graph: RuleGraph, count: number) {
  const rows = graph.editor.locator("tbody tr >> visible=true");
  for (let attempt = 0; attempt < count * 3 && (await rows.count()) < count; attempt++) {
    await graph.editor.locator(".grl-dt__add-row >> visible=true").first().click();
    await page.waitForTimeout(250);
  }
  await expect(rows).toHaveCount(count);
}

test("thirty business rules in one flow, built and tested in the rule editor", async ({ page }) => {
  test.setTimeout(1_800_000);
  mkdirSync(SHOTS, { recursive: true });
  let shot = 0;
  const snap = async (name: string) => {
    await page.waitForTimeout(400);
    const file = `${SHOTS}/${String(++shot).padStart(2, "0")}-${name}.png`;
    await page.screenshot({ path: file, fullPage: false });
    console.log("shot", file);
  };
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const cdn: string[] = [];
  page.on("request", (r) => {
    if (/^https?:\/\/[^/]*(jsdelivr|unpkg|cdnjs)/.test(r.url())) cdn.push(r.url());
  });
  const marker = `${Date.now() % 100000}`;
  const ruleTitle = `Deal desk review ${marker}`;
  const graph = new RuleGraph(page);

  await test.step("sign in and open a new rule on Opportunity", async () => {
    await page.goto("/auth/login", { timeout: 300_000 });
    await page.waitForSelector("input[type=password]", { timeout: 300_000 });
    // A dev server still optimising dependencies reloads the page under the form, which
    // empties it: fill and submit again until the page leaves the sign-in screen.
    for (let attempt = 0; attempt < 5 && new URL(page.url()).pathname.startsWith("/auth/login"); attempt++) {
      await page.waitForSelector("input[type=password]", { timeout: 300_000 });
      await page.fill("input[type=email]", EMAIL);
      await page.fill("input[type=password]", PASSWORD);
      await page.click("button[type=submit]");
      await page
        .waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 60_000 })
        .catch(() => {});
    }
    expect(new URL(page.url()).pathname).not.toMatch(/^\/auth\/login/);
    await page.goto("/admin/rules/new", { waitUntil: "networkidle", timeout: 300_000 });
    await page.getByText("Select entity...").click();
    await page.getByRole("option", { name: "Opportunity", exact: true }).click();
    await page.fill("input[placeholder*='Validate Email']", ruleTitle);
    await graph.waitReady();
    await graph.editor.scrollIntoViewIfNeeded();
    await snap("new-rule-on-opportunity");
  });

  await test.step("drag the seven nodes onto an empty graph and join them", async () => {
    await graph.clear();
    for (const kind of ["Record", "Expression", "Decision table", "Function", "Switch", "Decision table", "Response"] as const) {
      await graph.add(kind);
    }
    await expect(graph.nodes).toHaveCount(7);
    await graph.fitView();
    await snap("seven-nodes-placed");
    await graph.link("Record", "expression1", 0, 1);
    await graph.link("expression1", "decisionTable1", 0, 2);
    await graph.link("decisionTable1", "function1", 0, 3);
    await graph.link("function1", "switch1", 0, 4);
    await snap("seven-nodes-joined");
  });

  await test.step("Expression: six facts worked out from the record (rules 1–6)", async () => {
    await graph.node("expression1").getByText("Edit Expression").click();
    await graph.editor.getByText("Developer", { exact: true }).click();
    const rows = graph.editor.locator(".expression-list-item >> visible=true");
    for (const [key, value] of DERIVE) {
      const before = await rows.count();
      await graph.editor.getByText("Add row", { exact: true }).locator("visible=true").first().click();
      await expect(rows).toHaveCount(before + 1);
      const row = rows.nth(before);
      await row.locator(".expression-list-item__key").click();
      await page.keyboard.insertText(key);
      await row.locator(".expression-list-item__value").click();
      await page.keyboard.insertText(value);
      await page.keyboard.press("Escape");
    }
    for (const [key, value] of DERIVE) {
      await expect(graph.editor).toContainText(key);
      await expect(graph.editor).toContainText(value.slice(0, 12));
    }
    await snap("expression-six-facts");
    await graph.openTab("Graph");
  });

  await test.step("Decision table: eight discount bands by amount (rules 7–14)", async () => {
    await graph.node("decisionTable1").getByText("Edit Table").click();
    await page.getByRole("group", { name: "Inputs of decisionTable1" }).getByLabel("Input field whole record").selectOption("amount");
    await nameOutputs(page, graph, "discountCap", "tier");
    await addRows(page, graph, DISCOUNT.length);
    for (const [i, [band, cap, tier]] of DISCOUNT.entries()) {
      await typeCell(page, graph, i, 1, band);
      await typeCell(page, graph, i, 2, cap);
      await typeCell(page, graph, i, 3, tier);
    }
    await expect(graph.editor.locator("tbody tr >> visible=true").first()).toContainText(">= 500000");
    await expect(graph.editor.locator("tbody tr >> visible=true").nth(7)).toContainText("none");
    await snap("discount-table-eight-bands");
    await graph.openTab("Graph");
  });

  await test.step("Function: the deal is scored four ways (rules 15–18)", async () => {
    await graph.node("function1").getByText("Edit Function").click();
    await expect(graph.editor.locator(".monaco-editor >> visible=true").first()).toBeVisible({ timeout: 60_000 });
    await graph.typeIntoCodeBox(SCORE);
    await expect.poll(() => graph.codeBoxes()).toContainEqual(expect.stringContaining("score -= 25"));
    await snap("function-scores-the-deal");
    await graph.openTab("Graph");
  });

  await test.step("Switch: three branches skip the review, the fourth goes on (rules 19–22)", async () => {
    const node = graph.node("switch1");
    for (let i = 0; i < 3; i++) {
      await node.getByText("Add Condition").click();
      await page.waitForTimeout(300);
    }
    const conditions = node.locator("input, textarea, .cm-content");
    console.log("switch conditions", await conditions.count(), "branches", await node.locator(".react-flow__handle-right").count());
    for (const [i, text] of ROUTE.entries()) {
      await conditions.nth(i).click();
      await page.keyboard.insertText(text);
      await page.keyboard.press("Escape");
    }
    for (const text of ROUTE) await expect(node).toContainText(text);
    await expect(node.locator(".react-flow__handle-right")).toHaveCount(4);
    await graph.fitView();
    await graph.link("switch1", "response", 0, 5);
    await graph.link("switch1", "response", 1, 6);
    await graph.link("switch1", "response", 2, 7);
    await graph.link("switch1", "decisionTable2", 3, 8);
    await graph.link("decisionTable2", "response", 0, 9);
    await snap("switch-four-branches-joined");
  });

  await test.step("Decision table: eight verdicts, four refusals and four ways through (rules 23–30)", async () => {
    await graph.node("decisionTable2").getByText("Edit Table").click();
    await nameOutputs(page, graph, "action", "message");
    await addRows(page, graph, VERDICT.length);
    for (const [i, [check, action, message]] of VERDICT.entries()) {
      await typeCell(page, graph, i, 1, check);
      await typeCell(page, graph, i, 2, action);
      await typeCell(page, graph, i, 3, message);
    }
    await expect(graph.editor.locator("tbody tr >> visible=true").first()).toContainText("isStrategic");
    await expect(graph.editor.locator("tbody tr >> visible=true").nth(7)).toContainText("Standard deal");
    // Every name the verdict table reads is either the record's or worked out before it:
    // the editor must not call `score` or `discountCap` "not a field of this entity".
    await expect(page.getByText(/is not a field of this entity/)).toHaveCount(0);
    await expect(page.getByText(/is not an existing action/)).toHaveCount(0);
    await snap("verdict-table-eight-rows");
    await graph.openTab("Graph");
    await graph.fitView();
    await snap("the-whole-flow");
  });

  await test.step("run it in the Simulator", async () => {
    // The Simulator's ▷ sits at the foot of the editor's left rail, beside the canvas.
    const canvas = (await graph.editor.locator(".react-flow").first().boundingBox())!;
    await page.mouse.click(canvas.x - 24, canvas.y + canvas.height - 24);
    await expect(graph.editor.getByText("Simulator")).toBeVisible();
    await graph.typeIntoCodeBox(JSON.stringify(SAMPLES[4]!.record, null, 2));
    await graph.editor.getByRole("button", { name: /Run/ }).first().click();
    // The output panel is a code editor, which splits its text into spans: read its model.
    await expect
      .poll(async () => (await graph.codeBoxes()).join("\n"), { timeout: 60_000 })
      .toContain("A platinum deal must name its next step");
    const output = (await graph.codeBoxes()).join("\n");
    for (const expected of ["prevent", "tier: 'platinum'", "discountCap: 25", "score: 65", "isStrategic: true"]) {
      expect(output, expected).toContain(expected);
    }
    await snap("simulator-platinum-no-next-step");
  });

  const results: string[] = [];
  await test.step("Try it: fifteen deals, one for every path", async () => {
    const tryIt = page.getByLabel("Try the rule");
    await tryIt.scrollIntoViewIfNeeded();
    const sample = tryIt.getByLabel(/Sample/);
    for (const [i, s] of SAMPLES.entries()) {
      await sample.fill(JSON.stringify(s.record, null, 2));
      const ran = page.waitForResponse(
        (r) => r.request().method() === "POST" && /simulate|dry-run|evaluate/.test(r.url()),
        { timeout: 60_000 }
      );
      await tryIt.getByRole("button", { name: "Run the rule" }).click();
      const reply = await (await ran).text();
      // "Goes through" has two wordings: an allow row says so, and a branch that reaches the
      // Response with no action is reported as returning values the application does nothing with.
      const verdict = s.blocks
        ? /Blocks the write/
        : /Lets the write through|no action, so the application does nothing/;
      await expect(tryIt.getByText(verdict).first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(300);
      const answer = (await tryIt.innerText()).replace(/\s+/g, " ");
      if (s.blocks) expect(answer, s.name).not.toMatch(/Lets the write through/);
      else expect(answer, s.name).not.toMatch(/Blocks the write/);
      // A refusal's message is on the panel; a way through is shown only as "Lets the write
      // through", so its message is read from the answer the page itself was given.
      if (s.says) expect(s.blocks ? answer : reply, s.name).toContain(s.says);
      results.push(`${s.blocks ? "BLOCKS" : "allows"} | ${s.name}${s.says ? ` | ${s.says}` : ""}`);
      await tryIt.screenshot({ path: `${SHOTS}/try-${String(i + 1).padStart(2, "0")}.png` });
      // The panel keeps the previous answer until the next run; clear it by running nothing new.
      await page.waitForTimeout(300);
    }
    console.log(results.join("\n"));
  });

  await test.step("save it, and open it again: the same thirty rules", async () => {
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/rules") && r.request().method() === "POST");
    await page.getByRole("button", { name: /Create Rule/ }).click();
    const response = await saved;
    expect(response.status(), await response.text()).toBe(201);
    const id = (await response.json()).id;
    await expect(page).toHaveURL(/\/admin\/rules$/);
    await expect(page.getByText(ruleTitle)).toBeVisible({ timeout: 60_000 });
    await snap("saved-in-the-rules-list");
    await page.goto(`/admin/rules/${id}/edit`, { waitUntil: "networkidle" });
    await graph.waitReady();
    await expect(graph.nodes).toHaveCount(7);
    await graph.fitView();
    await snap("reopened");
    await graph.node("decisionTable2").getByText("Edit Table").click();
    await expect(graph.editor.locator("tbody tr >> visible=true")).toHaveCount(8);
    await snap("reopened-verdict-table");
    console.log("rule id", id);
  });

  expect(cdn, "no CDN request").toEqual([]);
  expect(pageErrors, "no page error").toEqual([]);
});
