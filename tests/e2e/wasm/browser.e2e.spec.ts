/**
 * The hosted generator page, and the application it produces, in a real browser.
 *
 * This is the half no unit test can reach. Everything interesting here is a
 * browser behaviour rather than a code path: a Service Worker that never sees a
 * `Cookie` header, a Node-API shim that must not claim to be Node, an IndexedDB
 * name that has to differ per application, a page embedded in an iframe that
 * cross-origin isolation would refuse to render. Each of those was a bug found
 * by opening the page, and each is asserted below.
 *
 * The suite runs the page the way a reader does — choose a model, generate, run,
 * sign in, use the application — because that sequence is the product. Splitting
 * it into isolated tests would mean booting PostgreSQL-on-WebAssembly once per
 * test, which is ten seconds each; instead the phases share a page through
 * `test.describe.serial`, and a failure early stops the ones that depend on it.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, type FrameLocator, type Page, test } from "@playwright/test";

/**
 * Where the run leaves pictures of what it saw.
 *
 * Playwright keeps screenshots only for failures, which is the wrong way round
 * for a suite whose subject is a user interface: the interesting artefact is
 * what a passing run looked like. These are what a QA write-up is assembled
 * from, and what makes "the application works" checkable by someone who was not
 * watching.
 */
const SHOTS = new URL("../../../pics/wasm-e2e/", import.meta.url).pathname;

async function shoot(page: Page, name: string) {
  await mkdir(SHOTS, { recursive: true });
  // Named for what they show rather than numbered by order: Playwright may
  // restart a worker, and a counter that resets mid-run silently overwrites the
  // earlier picture with a later one under the same number.
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}

/** The generated application lives in an iframe; everything about it is in there. */
const app = (page: Page): FrameLocator => page.frameLocator("#frame");

/** Console errors that are the page's own fault, as opposed to the noise below. */
const IGNORED_CONSOLE = [
  // The page probes for the PGlite served beside it with a HEAD request; a 404
  // there is the probe working (and the run step then says what is missing).
  /assets\/vendor\/pglite/,
  // `/api/auth/me` before sign-in is how the application discovers it has no
  // session. A 401 is the answer, not a failure.
  /401/,
  // The guide ships no favicon. Adding a binary file to quiet a test would be a
  // worse trade than saying so here.
  /favicon\.ico/,
];

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // A failed request logs "Failed to load resource: … 404" with the URL in the
    // location rather than the text, so filtering on the text alone cannot tell
    // a missing favicon from a broken application.
    const text = `${message.text()} ${message.location()?.url ?? ""}`;
    if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) return;
    problems.push(text.trim());
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/**
 * Fill in enough of a dictionary-driven form for the write to be accepted.
 *
 * Which fields are mandatory comes from `sys_field`, seeded from the model — so
 * a test that filled a fixed list of columns would be testing the CRM rather
 * than the mechanism, and would break on the next model. Every required control
 * is found by its own marker and given something of the right shape instead.
 */
async function fillMandatoryFields(frame: FrameLocator, name?: string) {
  // Not every entity has a `name`: a person is a first name and a last name,
  // and the loop below fills those like any other required text column.
  if (name !== undefined) await frame.locator("#field-name").fill(name);

  for (const field of await frame.locator(".field:has(.field__required)").all()) {
    const select = field.locator("select.field__input");
    if (await select.count()) {
      // A mandatory list column needs one of its own values, which makes this a
      // check of the enum seed as well as of the write path.
      const options = await select.locator("option").all();
      let chosen = false;
      for (const option of options) {
        const value = await option.getAttribute("value");
        if (value) {
          await select.selectOption(value);
          chosen = true;
          break;
        }
      }
      // A mandatory reference whose parent table is empty has nothing to offer,
      // and the control says so and disables itself rather than inviting someone
      // to type a uuid. Failing here names the missing record, because the
      // alternative — a silent skip — reappears as an unexplained 422 on save.
      if (!chosen) {
        const label = await field.locator(".field__label").innerText();
        const note = await select.locator("option").first().innerText();
        throw new Error(`Required field "${label}" has nothing to select: ${note}`);
      }
      continue;
    }

    const input = field.locator("input.field__input, textarea.field__input");
    if (!(await input.count())) continue;
    if (await input.isDisabled()) continue;
    if ((await input.inputValue()) !== "") continue;

    const type = await input.getAttribute("type");
    await input.fill(type === "number" ? "1" : type === "date" ? "2026-01-01" : "E2E");
  }
}

async function signIn(page: Page, email = "admin@admin.com", password = "admin") {
  await expect(app(page).locator(".login__form")).toBeVisible({ timeout: 180_000 });
  await app(page).locator("#email").fill(email);
  await app(page).locator("#password").fill(password);
  await app(page).locator(".login__form button[type=submit]").click();
  await expect(app(page).locator(".masthead")).toBeVisible({ timeout: 60_000 });
}

/**
 * Read a set of labels, comparably.
 *
 * `innerText` returns text as it is *rendered*, and several of these labels are
 * uppercased by CSS. Asserting on the rendered casing would tie the test to a
 * styling decision it has no opinion about.
 */
async function labelsOf(frame: FrameLocator, selector: string): Promise<string[]> {
  await expect(frame.locator(selector).first()).toBeVisible();
  return (await frame.locator(selector).allInnerTexts()).map((text) =>
    text.trim().toLocaleLowerCase()
  );
}

test.describe
  .serial("@browser generating and running the CRM", () => {
    let page: Page;
    let problems: string[];

    test.beforeAll(async ({ browser }) => {
      page = await browser.newPage();
      problems = watchConsole(page);
    });

    test.afterAll(async () => {
      await page.close();
    });

    test("the page opens on the CRM example", async () => {
      await page.goto("/run-in-browser.html");
      await expect(page.locator("#choice-crm")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#model-summary")).toContainText("crm.eml.mmd");
      await expect(page.locator("#app-name")).toHaveValue("Acme CRM");
      await shoot(page, "model-chosen");
    });

    test("the build monitor appears with the model and reports the check", async () => {
      // The bar is about the whole build, so it exists from the moment there is
      // something to build — and the first phase it reports is the checker, which
      // runs before anything is generated.
      await expect(page.locator("#build")).toBeVisible();
      await expect(page.locator("#build-phases .build__phase").first()).toHaveAttribute(
        "data-state",
        "done"
      );

      const check = page.locator('#build-phases [data-phase="check"]');
      await expect(check).toHaveAttribute("data-state", "done");
      // A clean model reports nothing louder than a count.
      await expect(page.locator("#diagnostics")).toBeHidden();
    });

    test("generating compiles the whole model", async () => {
      await page.locator("#generate").click();
      await expect(page.locator("#result.is-shown .tally")).toBeVisible({ timeout: 120_000 });

      const tally: Record<string, string> = {};
      for (const cell of await page.locator(".tally__cell").all()) {
        tally[(await cell.locator(".tally__label").innerText()).trim()] = (
          await cell.locator(".tally__value").innerText()
        ).trim();
      }

      expect(tally.Entities).toBe("17");
      // 9 and 10: a record moves by its action buttons, so no rule or saga
      // moves it; the ninth rule starts the closed-won handoff when a deal is
      // won. The processes are the five status flows and the five sagas.
      expect(tally.Rules).toBe("9");
      expect(tally.Processes).toBe("10");
      // 72: the CRM model declares a `%%rbac … .read` rule per entity on top of
      // its write restrictions, which is what gives each seeded role its own
      // set of windows, and 48 moves, each the button of the roles it names.
      // html/models/crm.eml.mmd is the copy this page loads and it must stay identical to
      // language/examples/crm.eml.mmd — they had drifted, and this number is
      // what noticed.
      expect(tally["Access rules"]).toBe("72");

      await expect(page.locator("#build-phases .build__phase").nth(2)).toHaveAttribute(
        "data-state",
        "done"
      );
      await shoot(page, "generated");
    });

    test("running it boots PostgreSQL and reaches sign-in", async () => {
      await page.locator("#run").click();
      await expect(page.locator("#stage.is-shown")).toBeVisible({ timeout: 60_000 });
      await expect(app(page).locator(".login__form")).toBeVisible({ timeout: 180_000 });
    });

    test("the progress bar tracks the boot from inside the frame", async () => {
      // The application posts its own boot phases to whoever embedded it, so this
      // is the real thing rather than a timer: without it the bar could only
      // report "started the iframe" and then guess for ten seconds.
      await expect(page.locator("#build-phases .build__phase").nth(4)).toHaveAttribute(
        "data-state",
        "done",
        { timeout: 180_000 }
      );
      await expect(page.locator("#build")).toHaveAttribute("data-state", "done");
      await expect(page.locator("#build-pct")).toHaveText("100%");
      await expect(page.locator("#build-label")).toContainText("running");
      await shoot(page, "progress-complete");
    });

    test("the seeded administrator can sign in", async () => {
      await signIn(page);
      await expect(app(page).locator(".masthead")).toContainText("Acme CRM");
      await shoot(page, "signed-in");
    });

    test("the dashboard groups entities by the categories the model declared", async () => {
      const groups = await labelsOf(app(page), ".category__name");
      expect(groups).toContain("accounts and contacts");
      expect(groups).toContain("sales pipeline");
      // The dictionary is a group of its own, and is what every screen reads from.
      expect(groups).toContain("application dictionary");
      await shoot(page, "dashboard");
    });

    test("an entity grid and its form are built from the dictionary", async () => {
      await app(page).locator(".card__name", { hasText: "Account" }).first().click();
      await expect(app(page).locator(".listbar")).toBeVisible();

      await app(page).locator(".actionbar button:nth-of-type(2)").click();
      await expect(app(page).locator("#field-name")).toBeVisible();

      const labels = await labelsOf(app(page), ".field__label");
      // These come from `sys_field`, seeded from the model — not from a template
      // that happens to know what an account is.
      expect(labels).toContain("name");
      expect(labels).toContain("account type");
      await shoot(page, "record-form");
    });

    /**
     * Account requires an owner, and an owner is a User.
     *
     * A generated application starts with every business table empty, so the
     * first Account cannot be created until a User exists — which is exactly
     * what the model says, and what the form now enforces: `owner_id` is a
     * lookup on `bus_user`, and a lookup with nothing to offer is disabled.
     * Creating the parent first is the user's real path through this, so it is
     * the test's path too.
     */
    test("a user can be created, so an account has an owner to point at", async () => {
      await app(page).locator(".masthead__name").click();
      await app(page).locator(".card__name", { hasText: "User" }).first().click();
      await expect(app(page).locator(".listbar")).toBeVisible();

      await app(page).locator(".actionbar button:nth-of-type(2)").click();
      await expect(app(page).locator(".field__label").first()).toBeVisible();
      await fillMandatoryFields(app(page));

      await app(page).locator(".actionbar .btn--primary").first().click();
      await expect(app(page).locator(".table")).toBeVisible({ timeout: 30_000 });
    });

    test("a record can be created and comes back in the grid", async () => {
      await app(page).locator(".masthead__name").click();
      await app(page).locator(".card__name", { hasText: "Account" }).first().click();
      await expect(app(page).locator(".listbar")).toBeVisible();
      await app(page).locator(".actionbar button:nth-of-type(2)").click();
      await expect(app(page).locator("#field-name")).toBeVisible();

      await fillMandatoryFields(app(page), "E2E Account");

      // The owner lookup is a real select over `bus_user` now, so this asserts
      // the row created above is what got chosen — not that a uuid was typed
      // into a text box, which is what this step used to prove.
      const owner = app(page).locator('select[name="owner_id"]');
      await expect(owner).toBeEnabled();
      expect(await owner.inputValue()).not.toBe("");

      await app(page).locator(".actionbar .btn--primary").first().click();

      // Landing back on the grid is the success signal: the record panel replaces
      // itself with the listing once the write goes through.
      await expect(app(page).locator(".table")).toBeVisible({ timeout: 30_000 });
      await expect(app(page).locator(".table")).toContainText("E2E Account");
    });

    /**
     * The grid's CSV download, exercised where it actually runs.
     *
     * The rows are fetched rather than read off the screen, cells go through
     * the same formatter and the same server-resolved labels the table renders
     * with, and the file leads with a byte order mark so Excel reads it as
     * UTF-8. The account created above is what the file has to contain — an
     * export that downloads an empty document would look like working software
     * from the outside.
     */
    test("the grid downloads its rows as CSV", async () => {
      await app(page).locator(".masthead__name").click();
      await app(page).locator(".card__name", { hasText: "Account" }).first().click();
      await expect(app(page).locator(".listbar")).toBeVisible();

      const button = app(page).locator('[data-testid="export-csv"]');
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();

      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 60_000 }),
        button.click(),
      ]);

      expect(download.suggestedFilename()).toMatch(/^account-\d{4}-\d{2}-\d{2}\.csv$/);

      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString("utf8");

      // The BOM, then a header row of the grid's own column names, then the
      // record. `\r\n` because RFC 4180 says so and because a reader that
      // splits on it must find whole rows.
      expect(text.charCodeAt(0)).toBe(0xfeff);
      const [header, ...rows] = text.slice(1).split("\r\n");
      expect(header.toLowerCase()).toContain("name");
      expect(rows.join("\n")).toContain("E2E Account");
      await shoot(page, "csv-export");
    });

    test("the audit trail recorded the write", async () => {
      // Reached the way a person reaches it: the Application Dictionary group on
      // the dashboard carries an Audit Log card. Navigating the outer page instead
      // would tear the frame down and take the database with it.
      await app(page).locator(".masthead__name").click();
      await app(page).locator(".card__name", { hasText: "Audit Log" }).first().click();
      await expect(app(page).locator(".table")).toContainText(/CREATE/i, { timeout: 30_000 });
      await shoot(page, "audit-trail");
    });

    test("the admin screens read the model back", async () => {
      // The three screens that show what the generator made of the model, rather
      // than what the application has since done with it. Between them they are
      // the whole compile step, readable: what each rule decided, what processes
      // the state machines became, and the EML the application was built from.
      await app(page).locator(".masthead__name").click();

      // The cards are named as the application names them — "Business Rules", not
      // "Rules" — because that is what a person clicking would look for.
      await app(page).locator(".card__name", { hasText: "Business Rules" }).first().click();
      const rules = await labelsOf(app(page), ".rule__name");
      expect(rules).toContain("opportunityclosegate");
      // Every decision is either read as an expression or reported as assumed —
      // the one thing this runtime must never do is guess silently.
      await expect(app(page).locator(".decision__reading").first()).toBeVisible();
      await shoot(page, "rules");

      await app(page).locator(".masthead__name").click();
      await app(page).locator(".card__name", { hasText: "Processes" }).first().click();
      const processes = await labelsOf(app(page), ".rule__name");
      expect(processes.join(" ")).toMatch(/opportunitypipeline|leadlifecycle/);

      await app(page).locator(".masthead__name").click();
      await app(page).locator(".card__name", { hasText: "The Model" }).first().click();
      await expect(app(page).locator(".source")).toContainText("erDiagram");
    });

    /**
     * The model's own `%%report` questions, answered in the tab.
     *
     * The directive was read by the checker and dropped by the generator, so
     * the published models' reports produced an application with none. This is
     * the end of that path: the question is on screen, pressing it runs the
     * query against the WebAssembly PostgreSQL this test has been writing to,
     * and rows come back.
     *
     * It is also what holds the foreign-key column type. Every one of these
     * queries joins `parent.id = child.parent_id`, which fails outright while
     * one side is UUID and the other VARCHAR — 20 of the CRM model's 33
     * reports did exactly that before the schema was corrected.
     */
    test("the model's reports run against the database in the tab", async () => {
      await app(page).locator(".masthead__name").click();
      await app(page).locator(".card__name", { hasText: "Reports" }).first().click();

      // Grouped by the entity each report is about, so the headings are entity
      // names rather than a flat list of thirty-three.
      const questions = app(page).locator(".report-list .link");
      // `count()` does not auto-wait, and the list is fetched — asserting on it
      // without waiting for the first entry reads the spinner and sees zero.
      await expect(questions.first()).toBeVisible({ timeout: 30_000 });
      expect(await questions.count()).toBeGreaterThan(20);

      await questions.first().click();
      const panel = app(page).locator(".report-panel");

      // The title and the help text both come off the directive; the help is
      // what says who asks the question, and is the part a table cannot show.
      await expect(panel.locator("h2")).toBeVisible();
      // "N rows in Nms" — the query ran. A failure renders `.empty` instead,
      // which is why this asserts the timing line rather than the absence of
      // an error: a report that returns nothing is still a report that ran.
      await expect(panel).toContainText(/\d+ rows? in \d+ms/);

      await shoot(page, "reports");
    });

    /**
     * The second application: Enterprise Reporting, drawn in the platform's
     * own shell, with its own sign-in and a working Administration section.
     *
     * What this holds: the platform's sidebar is there; a report runs; the
     * administrator can narrow a role's tables and the narrowing is enforced on
     * the next request, not on the next boot; the log records it; and a
     * reporting role that is not an administrator never sees the section.
     */
    test("the reporting application signs in separately and is administered", async () => {
      await app(page).locator(".masthead__name").click();
      await app(page).locator(".card--reporting").first().click();

      const frame = app(page);
      // The frame on this page is narrower than 1024px, so the preview is in
      // the platform's small-screen layout: the sidebar is a slide-over behind
      // the menu button, exactly as the platform's own is at that width.
      const nav = async (label: string) => {
        const toggle = frame.getByRole("button", { name: "Toggle menu" });
        if (await toggle.isVisible()) {
          // The slide-over stays open after a selection, so toggling on every
          // visit closes it and leaves the item translated out of the viewport.
          const open = await frame
            .locator(".er-sidebar-mobile")
            .evaluate((el) => el.classList.contains("is-open"));
          if (!open) await toggle.click();
          // The preview frame sits below the fold of the host page, and the
          // drawer's scroller is nested under a fixed slide-over — Playwright's
          // auto-scroll reaches neither, so bring both into view first.
          await page.locator("#frame").evaluate((el) => el.scrollIntoView({ block: "center" }));
          const item = frame.locator(".er-sidebar-mobile .er-nav__item", { hasText: label });
          await item.evaluate((el) => el.scrollIntoView({ block: "center" }));
          await item.click();
        } else {
          await frame.locator(".er-sidebar-desktop .er-nav__item", { hasText: label }).click();
        }
      };
      const adminHeading = frame.locator(".er-sidebar-mobile .er-nav__heading", {
        hasText: "Administration",
      });

      await expect(frame.locator(".er-login__title")).toHaveText("Welcome back", {
        timeout: 30_000,
      });
      await frame.locator("button[type=submit]").click(); // the administrator is prefilled
      await expect(frame.locator(".er-pageheader__title")).toHaveText("Dashboard");
      await expect(frame.locator(".er-sidebar-mobile .er-sidebar__logo")).toContainText(
        "Enterprise Reports"
      );
      await expect(adminHeading).toHaveCount(1);

      // A report runs against the database in the tab.
      await nav("Reports");
      await frame.locator(".er-table tbody tr").first().click();
      await expect(frame.locator(".er-card__description").first()).toContainText(
        /\d+ rows? in \d+ms/
      );

      // Take one table away from the Support Agent, and it is refused at once.
      await nav("Permissions");
      await frame.locator(".er-select--inline").selectOption({ label: "Support Agent" });
      const account = frame.locator(".er-grant", { hasText: "bus_account ·" });
      await expect(account.locator("input")).toBeChecked();
      await account.locator("input").uncheck();
      await frame.getByRole("button", { name: "Save Permissions" }).click();
      await expect(
        frame.locator(".er-grant", { hasText: "bus_account ·" }).locator("input")
      ).not.toBeChecked();

      await nav("System Logs");
      await expect(frame.locator(".er-table")).toContainText("update permissions");
      await expect(frame.locator(".er-table")).toContainText("run report");
      await shoot(page, "reporting-admin");

      // As the Support Agent: no Administration, and the table it lost is gone.
      await frame.locator(".er-avatar").click();
      await frame.getByRole("button", { name: "Log out" }).click();
      await frame.locator(".er-accounts__row", { hasText: "Support Agent" }).click();
      await frame.locator("button[type=submit]").click();
      await expect(frame.locator(".er-kpi").first()).toBeVisible();
      await expect(adminHeading).toHaveCount(0);
      await expect(frame.locator(".er-card", { hasText: "Data access" })).not.toContainText(
        "bus_account"
      );

      // Leave the way a reader would, so the next test finds the application.
      await frame.locator(".er-avatar").click();
      await frame.getByRole("button", { name: /Back to/ }).click();
    });

    test("nothing in the console was the page's own fault", async () => {
      expect(problems).toEqual([]);
    });
  });

test.describe
  .serial("@browser an uploaded model", () => {
    let page: Page;

    test.beforeAll(async ({ browser }) => {
      page = await browser.newPage();
    });

    test.afterAll(async () => {
      await page.close();
    });

    test("switching to Upload clears the model and offers a drop zone", async () => {
      await page.goto("/run-in-browser.html");
      await page.locator("#choice-upload").click();
      await expect(page.locator("#dropzone")).toBeVisible();
      await expect(page.locator("#model-summary")).toBeHidden();
      await expect(page.locator("#build")).toBeHidden();
    });

    test("a chosen file is read in the tab and named from its filename", async () => {
      await page
        .locator("#file")
        .setInputFiles(
          new URL("../../../examples/drug-discovery.eml.mmd", import.meta.url).pathname
        );
      await expect(page.locator("#model-summary")).toContainText("drug-discovery.eml.mmd");
      await expect(page.locator("#app-name")).toHaveValue("Drug Discovery");
    });

    test("its own entities are what the application shows", async () => {
      await page.locator("#generate").click();
      await expect(page.locator("#result.is-shown .tally")).toBeVisible({ timeout: 120_000 });
      await page.locator("#run").click();
      await signIn(page);

      const cards = await labelsOf(app(page), ".card__name");
      expect(cards).toContain("compound");
      expect(cards).toContain("experiment");
      // Not the CRM's — two applications generated in one browser share an origin,
      // and the second used to find the first's seed marker and skip its own.
      expect(cards).not.toContain("opportunity");
    });

    test("a business rule refuses a write the model says it should", async () => {
      await app(page).locator(".card__name", { hasText: "Experiment" }).first().click();
      await app(page).locator(".actionbar button:nth-of-type(2)").click();
      await expect(app(page).locator(".field__label").first()).toBeVisible();

      // `experimentSubmitGate` rejects an untitled draft. Saving with the title
      // empty is the shortest path to proving the rules engine is not decoration.
      await app(page).locator(".actionbar .btn--primary").first().click();
      await expect(app(page).locator(".violations:not([hidden])")).toBeVisible({ timeout: 30_000 });
    });
  });

test.describe("@browser the checker refuses a broken model", () => {
  test("shows every finding, with its code and line, and generates nothing", async ({ page }) => {
    await page.goto("/run-in-browser.html");
    await page.locator("#choice-upload").click();

    await page.locator("#file").setInputFiles({
      name: "bad-rbac.eml.mmd",
      mimeType: "text/plain",
      buffer: Buffer.from(
        [
          "%%meta name: Bad RBAC",
          "%%rbac role:admin on Ghost.delete",
          "erDiagram",
          "    Customer {",
          "        string id PK",
          "        string name",
          "    }",
          "",
        ].join("\n")
      ),
    });

    const diagnostics = page.locator("#diagnostics");
    await expect(diagnostics).toBeVisible();
    await expect(diagnostics).toHaveAttribute("data-state", "failed");
    await expect(diagnostics).toContainText("EML213");
    await expect(diagnostics).toContainText("Ghost");
    await expect(diagnostics.locator(".diag--error").first()).toContainText("line 2");

    // The bar stops where the failure is, rather than running on to a phase
    // that never happened.
    await expect(page.locator("#build")).toHaveAttribute("data-state", "failed");
    await expect(page.locator('#build-phases [data-phase="check"]')).toHaveAttribute(
      "data-state",
      "failed"
    );
    await shoot(page, "checker-refused");

    // And there is nothing to press: the generate step stays closed on a model
    // the checker refused, so the failure cannot be clicked past.
    await expect(page.locator("#step-generate")).toHaveAttribute("data-state", "idle");
    await expect(page.locator("#generate")).toBeHidden();
    await expect(page.locator("#download")).toBeDisabled();
  });

  test("reports a repair rather than making it silently", async ({ page }) => {
    await page.goto("/run-in-browser.html");
    await page.locator("#choice-upload").click();
    await page.locator("#file").setInputFiles({
      name: "no-name.eml.mmd",
      mimeType: "text/plain",
      buffer: Buffer.from(
        [
          "erDiagram",
          "    Customer {",
          "        string id PK",
          "        string name",
          "    }",
          "",
        ].join("\n")
      ),
    });

    const diagnostics = page.locator("#diagnostics");
    await expect(diagnostics).toBeVisible();
    await expect(diagnostics).toHaveAttribute("data-state", "ok");
    await expect(diagnostics.locator(".diag--fixed")).toContainText("EML001");
    await shoot(page, "checker-repaired");
    // Repaired, so the build carries on.
    await expect(page.locator("#build")).not.toHaveAttribute("data-state", "failed");
  });

  test("re-checks a corrected model chosen under the same filename", async ({ page }) => {
    await page.goto("/run-in-browser.html");
    await page.locator("#choice-upload").click();

    /* Help on the entity and the column, because the corrected half of this
       fixture has to be a model the checker finds *nothing* to say about:
       EML152 and EML153 report an entity and columns with none, EML170 an
       entity with no %%section, and the page
       shows its diagnostics panel for a warning as readily as for an error. */
    const model = (entity: string) =>
      [
        "%%meta name: Bad RBAC",
        `%%rbac role:administrator on ${entity}.delete`,
        "erDiagram",
        "    Customer {",
        "        string id PK",
        "        string name",
        "    }",
        "",
        "%%entity Customer help: A person or organisation that buys from us. Created when a lead converts, and never deleted while an unpaid invoice stands against it.",
        "%%field Customer.name help: The trading name to address on correspondence and to print on an invoice. Not necessarily the registered legal entity.",
        "%%section entity: Customer; name: Details; help: The customer's trading name, as it appears on correspondence and invoices.; rows: name",
        "",
      ].join("\n");

    const pick = (source: string) =>
      page.locator("#file").setInputFiles({
        name: "bad-rbac.eml.mmd",
        mimeType: "text/plain",
        buffer: Buffer.from(source),
      });

    await pick(model("Ghost"));
    const diagnostics = page.locator("#diagnostics");
    await expect(diagnostics).toHaveAttribute("data-state", "failed");
    // The findings say what to do next, not only what is wrong.
    await expect(diagnostics).toContainText("choose it again");

    // The same filename, corrected — which is exactly how someone fixes the file
    // the page just refused. A file input fires no `change` when the same name is
    // picked twice, so without the page resetting its value this would leave the
    // reader staring at findings for a document they had already repaired.
    await pick(model("Customer"));
    await expect(diagnostics).toBeHidden();
    await expect(page.locator("#step-generate")).toHaveAttribute("data-state", "active");
    await expect(page.locator("#generate")).toBeVisible();
  });
});

test.describe("@browser assembling the real stack in a tab", () => {
  // The generation half of run-real-stack.html, which is the half that can be
  // checked: the same pipeline the CLI runs, over a filesystem that is a Map.
  // Booting the WebContainer needs StackBlitz's hosts and cross-origin
  // isolation, and is not exercised anywhere — the page says so too.
  test("produces the real application, four hundred files of it", async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto("/run-real-stack.html");

    await expect(page.locator("#model-summary")).toContainText("crm.eml.mmd");
    await page.locator("#generate").click();

    // Fetching 1.8MB of templates and running the whole NestJS + TanStack
    // pipeline, in the tab.
    await expect(page.locator("#result.is-shown .tally")).toBeVisible({ timeout: 180_000 });

    const tally: Record<string, string> = {};
    for (const cell of await page.locator(".tally__cell").all()) {
      tally[(await cell.locator(".tally__label").innerText()).trim()] = (
        await cell.locator(".tally__value").innerText()
      ).trim();
    }
    expect(tally.Entities).toBe("17");
    expect(tally.Rules).toBe("9");
    // The CLI writes 416 files for this model; the browser writes the same but
    // for the nine binary fonts, which do not survive a JSON transport.
    expect(Number(tally.Files)).toBeGreaterThan(400);

    // And the overlay stayed the size it is on disk.
    await expect(page.locator(".result__note")).toContainText("added");
    await expect(page.locator('#build-phases [data-phase="assemble"]')).toHaveAttribute(
      "data-state",
      "done"
    );
    await shoot(page, "real-stack-assembled");
    expect(problems).toEqual([]);
  });

  test("refuses a model the checker refuses, before assembling anything", async ({ page }) => {
    await page.goto("/run-real-stack.html");
    await page.locator("#choice-upload").click();
    await page.locator("#file").setInputFiles({
      name: "bad-rbac.eml.mmd",
      mimeType: "text/plain",
      buffer: Buffer.from(
        [
          "%%meta name: Bad RBAC",
          "%%rbac role:admin on Ghost.delete",
          "erDiagram",
          "    Customer {",
          "        string id PK",
          "        string name",
          "    }",
          "",
        ].join("\n")
      ),
    });

    // No Assemble press: this page checks the moment a model is chosen, so the
    // refusal arrives while the reader is still looking at the model rather than
    // after they have asked for an application they were never going to get.
    const diagnostics = page.locator("#diagnostics");
    await expect(diagnostics).toBeVisible({ timeout: 180_000 });
    await expect(diagnostics).toHaveAttribute("data-state", "failed");
    await expect(diagnostics).toContainText("EML213");
    await expect(diagnostics).toContainText("Ghost");
    await expect(page.locator("#build")).toHaveAttribute("data-state", "failed");

    // And the step stays shut, so the refusal cannot be clicked past.
    await expect(page.locator("#step-generate")).toHaveAttribute("data-state", "idle");
    await expect(page.locator("#generate")).toBeHidden();
  });

  test("re-checks a corrected model chosen under the same filename", async ({ page }) => {
    await page.goto("/run-real-stack.html");
    await page.locator("#choice-upload").click();

    /* Help on the entity and the column, because the corrected half of this
       fixture has to be a model the checker finds *nothing* to say about:
       EML152 and EML153 report an entity and columns with none, EML170 an
       entity with no %%section, and the page
       shows its diagnostics panel for a warning as readily as for an error. */
    const model = (entity: string) =>
      [
        "%%meta name: Bad RBAC",
        `%%rbac role:administrator on ${entity}.delete`,
        "erDiagram",
        "    Customer {",
        "        string id PK",
        "        string name",
        "    }",
        "",
        "%%entity Customer help: A person or organisation that buys from us. Created when a lead converts, and never deleted while an unpaid invoice stands against it.",
        "%%field Customer.name help: The trading name to address on correspondence and to print on an invoice. Not necessarily the registered legal entity.",
        "%%section entity: Customer; name: Details; help: The customer's trading name, as it appears on correspondence and invoices.; rows: name",
        "",
      ].join("\n");

    const pick = (source: string) =>
      page.locator("#file").setInputFiles({
        name: "bad-rbac.eml.mmd",
        mimeType: "text/plain",
        buffer: Buffer.from(source),
      });

    await pick(model("Ghost"));
    await expect(page.locator("#diagnostics")).toHaveAttribute("data-state", "failed");

    // The same filename, corrected. A file input fires no `change` when the same
    // name is picked twice, so without the reset in the page this would leave the
    // reader staring at findings for a document they had already fixed.
    await pick(model("Customer"));
    await expect(page.locator("#diagnostics")).toBeHidden();
    await expect(page.locator("#step-generate")).toHaveAttribute("data-state", "active");
  });
});
