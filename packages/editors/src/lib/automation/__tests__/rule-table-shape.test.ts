/**
 * Regression: ISSUE-007 — every rule table opened as an empty one.
 * Found by /qa on 2026-09-01.
 * Report: .gstack/qa-reports/qa-report-dance-studio-qa-2026-09-01.md
 *
 * The generated /admin/automations screen defined its own private
 * `asDecisionTable` next to the complete one already sitting in
 * `lib/automation/rule-content.ts`. The private copy accepted only a decision
 * table passed as a live object — not the JSON string the rules endpoint
 * actually returns, and not the JDM node graph that `%%action` compiles to. So
 * every rule fell through to `emptyDecisionTable()`, and the screen listed all
 * eighteen of them as "1 inputs · 1 rows" while `packOpeningBalance` had 2 rows,
 * `bookingGate` 3 and `bus_class_session_validation` 7.
 *
 * The count was the visible half. The editor beside it opened the same empty
 * table, so saving would have replaced a real rule with a blank one.
 *
 * The two ends belong to different packages and are edited apart, so the
 * property worth holding is the round trip: what the generator compiles from
 * `%%action`, the reader that opens it reports at full size.
 */

import { describe, expect, it } from "vitest";
import { buildActionDecisionTable, parseRuleActions } from "../../../../../generator/src/rules";
import { asDecisionTable } from "../rule-content";

const THREE_ACTIONS = [
  '%%action requireCardReference validation-error when: method == "card" and reference == null message: A card payment needs its authorisation code.',
  '%%action requireTransferReference validation-error when: method == "bank_transfer" and reference == null message: A bank transfer needs its bank reference.',
  '%%action stampCashReference transform when: method == "cash" field: reference value: counted-into-till',
].join("\n");

const graph = buildActionDecisionTable("paymentRecording", parseRuleActions(THREE_ACTIONS));

describe("reading back what %%action compiled", () => {
  it("finds the table inside the JDM node graph, at its real size", () => {
    const table = asDecisionTable(graph);
    expect(table.rules).toHaveLength(3);
    expect(table.inputs).toHaveLength(1);
    expect(table.outputs.map((o) => o.field)).toContain("transformData");
  });

  it("finds it just the same when the endpoint hands back a JSON string", () => {
    // This is the shape that actually reached the screen: jdm_content is text.
    const table = asDecisionTable(JSON.stringify(graph));
    expect(table.rules).toHaveLength(3);
    expect(table.rules.map((r) => r._id)).toEqual([
      "paymentRecording-requireCardReference",
      "paymentRecording-requireTransferReference",
      "paymentRecording-stampCashReference",
    ]);
  });

  it("does not quietly hand back the one-row placeholder", () => {
    // The failure this test exists for was silent precisely because an empty
    // table is a valid table. A real rule must never read back as 1 × 1.
    const table = asDecisionTable(JSON.stringify(graph));
    expect(`${table.inputs.length} inputs · ${table.rules.length} rows`).not.toBe(
      "1 inputs · 1 rows"
    );
  });

  it("still falls back to an empty table for content that is neither shape", () => {
    expect(asDecisionTable(null).rules).toHaveLength(1);
    expect(asDecisionTable("not json at all").rules).toHaveLength(1);
    expect(asDecisionTable({ nodes: [] }).rules).toHaveLength(1);
  });
});
