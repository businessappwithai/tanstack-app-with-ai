/**
 * Run what spec 14 built, in the application generated from it.
 *
 * Generate from the model 14 stored (QA_MODEL_OUT) and point this at the app:
 *
 *   bun scripts/e2e-rules-workflows/run.ts --generated --no-server --model <qa-model.eml.mmd> \
 *     -- specs/15-qa-generated-run.spec.ts
 *
 * A local echo server on 4799 stands in for the web service the process calls, so every
 * "Call a web service" step is observable. One update to an invoice starts the 56-step
 * process; its run is read back from /api/workflows, and the records it created, updated
 * and deleted are read back from the API. The rules attached to the lifecycle hooks are
 * then driven with writes they should refuse or change.
 */

import { createServer, type Server } from "node:http";
import { type APIRequestContext, expect, test } from "@playwright/test";

const APP = process.env.GENERATED_APP_URL;
const ECHO_PORT = 4799;
const PROCESS = "QA Every Step Invoice Run";

interface Hit {
  method: string;
  url: string;
  body: string;
}

test.describe.configure({ mode: "serial" });
test.describe("the QA process and rules, run in the generated application", () => {
  test.skip(!APP, "needs --generated with the model spec 14 stored");

  let api: APIRequestContext;
  let echo: Server;
  const hits: Hit[] = [];
  let invoice: Record<string, unknown>;

  test.beforeAll(async ({ playwright }) => {
    echo = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        hits.push({ method: req.method ?? "", url: req.url ?? "", body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, method: req.method, seen: hits.length }));
      });
    });
    await new Promise<void>((resolve) => echo.listen(ECHO_PORT, "127.0.0.1", resolve));

    api = await playwright.request.newContext({
      baseURL: APP,
      extraHTTPHeaders: { Origin: APP ?? "" },
    });
    const signIn = await api.post("/api/auth/sign-in/email", {
      data: {
        email: process.env.GENERATED_ADMIN_EMAIL,
        password: process.env.GENERATED_ADMIN_PASSWORD,
      },
    });
    expect(signIn.ok(), `signing in answered ${signIn.status()}`).toBe(true);
    const list = await api.get("/api/bus/fee_invoice?limit=50");
    expect(list.ok(), await list.text()).toBe(true);
    const rows = ((await list.json()) as { data: Array<Record<string, unknown>> }).data;
    // An invoice the rules let through: not cancelled, a number, a modest total.
    const pick = rows.find((r) => r.status !== "cancelled" && Number(r.total_amount) < 1000000);
    expect(pick, "a seeded invoice to work on").toBeTruthy();
    invoice = pick as Record<string, unknown>;
    console.log(`invoice ${invoice.id} status=${invoice.status} total=${invoice.total_amount}`);
  });

  test.afterAll(async () => {
    await api?.dispose();
    await new Promise((resolve) => echo?.close(resolve));
  });

  const runsFor = async (id: string) => {
    const response = await api.get(`/api/workflows/entity/bus_fee_invoice/${id}?limit=50`);
    expect(response.ok(), await response.text()).toBe(true);
    const body = (await response.json()) as unknown;
    return (Array.isArray(body) ? body : ((body as { data?: unknown[] }).data ?? [])) as Array<
      Record<string, unknown>
    >;
  };

  test("an update starts the 56-step process, and it runs to the end", async () => {
    test.setTimeout(180_000);
    const id = invoice.id as string;
    const before = (await runsFor(id)).length;
    const update = await api.patch(`/api/bus/fee_invoice/${id}`, {
      data: { due_on: "2026-12-31" },
      failOnStatusCode: false,
    });
    expect(update.status()).toBeLessThan(300);
    // The workflows run inside the record's promotion, all or nothing: a failed run is
    // rolled back with everything else and leaves no run row, only this verdict.
    const promotion = ((await update.json()) as { promotion?: Record<string, unknown> }).promotion;
    console.log(
      `PATCH due_on → ${update.status()} · promoted=${promotion?.promoted} · ran ${JSON.stringify(
        promotion?.ranWorkflows
      )}${promotion?.error ? ` · ${promotion.error}` : ""}`
    );
    expect(promotion?.error, "the workflows ran without failing").toBeUndefined();
    expect(promotion?.promoted, "the record was promoted").toBe(true);

    let runs: Array<Record<string, unknown>> = [];
    await expect
      .poll(
        async () => {
          runs = await runsFor(id);
          const mine = runs.filter((r) =>
            String(r.workflowName ?? r.workflow_name ?? "")
              .replace(/\s+/g, "")
              .toLowerCase()
              .includes("qaeverystepinvoicerun")
          );
          return mine.find((r) => r.status !== "draft") ? mine.length : 0;
        },
        { timeout: 120_000, intervals: [1000] }
      )
      .toBeGreaterThan(0);
    console.log(`runs on the invoice: ${before} before, ${runs.length} after`);
    for (const run of runs) {
      console.log(
        `  ${run.workflowName ?? run.workflow_name} · ${run.operation} · ${run.status}` +
          (run.error ? ` · ${String(run.error).slice(0, 400)}` : "") +
          (run.durationMs ? ` · ${run.durationMs}ms` : "")
      );
    }
    const mega = runs.find((r) =>
      String(r.workflowName ?? r.workflow_name ?? "")
        .replace(/\s+/g, "")
        .toLowerCase()
        .includes("qaeverystepinvoicerun")
    );
    console.log(`web service calls received: ${hits.length}`);
    for (const hit of hits) console.log(`  ${hit.method} ${hit.url} ${hit.body.slice(0, 120)}`);
    expect.soft(mega?.status, `${PROCESS} ran to success`).toBe("success");
    expect
      .soft(hits.length, "seven web service steps reached the service")
      .toBeGreaterThanOrEqual(7);
  });

  test("the process's own writes are on the record and its lines", async () => {
    const id = invoice.id as string;
    const now = (await (await api.get(`/api/bus/fee_invoice/${id}`)).json()) as Record<
      string,
      unknown
    > & { data?: Record<string, unknown> };
    const row = (now.data ?? now) as Record<string, unknown>;
    console.log(`invoice now: cancellation_reason=${JSON.stringify(row.cancellation_reason)}`);
    expect.soft(String(row.cancellation_reason ?? "")).toMatch(/qa round|loop pass/);

    const lines = await api.get(`/api/bus/fee_invoice_line?limit=200`);
    const all = ((await lines.json()) as { data: Array<Record<string, unknown>> }).data;
    const qa = all.filter((l) => String(l.description ?? "").startsWith("QA line"));
    console.log(
      `QA lines still visible after the process (each was created then deleted): ${qa.length}`
    );
    expect.soft(qa.length, "every line the process created, it also deleted").toBe(0);
  });

  const write = async (data: Record<string, unknown>) => {
    const response = await api.patch(`/api/bus/fee_invoice/${invoice.id}`, {
      data,
      failOnStatusCode: false,
    });
    const text = await response.text();
    console.log(`PATCH ${JSON.stringify(data)} → ${response.status()} ${text.slice(0, 240)}`);
    return { status: response.status(), text };
  };

  test("the rules attached to the hooks decide writes", async () => {
    test.setTimeout(120_000);
    // beforeUpdate: QA cancelled invoice frozen.
    const cancelled = await write({ status: "cancelled", cancellation_reason: "qa probe" });
    expect.soft(cancelled.status, "a cancelled write is refused").toBeGreaterThanOrEqual(400);
    // customValidate: QA graph function cap (a function node).
    const huge = await write({ total_amount: 2000000 });
    expect.soft(huge.status, "an invoice over the cap is refused").toBeGreaterThanOrEqual(400);
    // afterUpdate: QA settled invoice note (transform) — balance 0 stamps the reason.
    const settled = await write({ balance_due: 0 });
    expect.soft(settled.status).toBeLessThan(300);
    const after = (await (await api.get(`/api/bus/fee_invoice/${invoice.id}`)).json()) as Record<
      string,
      unknown
    > & { data?: Record<string, unknown> };
    const row = (after.data ?? after) as Record<string, unknown>;
    console.log(`after balance 0: cancellation_reason=${JSON.stringify(row.cancellation_reason)}`);
  });
});
