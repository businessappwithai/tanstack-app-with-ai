/**
 * "Update a field" on another record type, and which row it writes.
 *
 * The step had no way to say which row: `STEP_FIELDS` gave it entity, field and
 * value, so choosing another record type wrote `entity: Invoice` and nothing
 * else. The checker refuses that (EML265) and the executor skips it rather than
 * guess a row, so such a step could never run — and the builder called it
 * finished. It now takes `target`, which the generator already read: a
 * `{{reference}}` becomes the row id, a bare column a foreign key to match.
 *
 * Both readers are real here: the builder's validation and the published
 * checker, which must agree on when a target is needed.
 */

import { describe, expect, it } from "vitest";
import { checkSource } from "../../../../../../language/checker";
import {
  type Automation,
  emptyAutomation,
  newStep,
  STEP_FIELDS,
  serializeAutomation,
  validateAutomation,
} from "../model";

const ERD = `%%meta name: Probe
%%meta kind: erd
erDiagram
    Order {
        string id PK
        string status
    }
    Invoice {
        string id PK
        string order_id FK
        string status
    }
    Order ||--o{ Invoice : has
    %%entity Order help: An order.
    %%entity Invoice help: An invoice raised against an order.
    %%field Order.status help: Where the order is.
    %%field Invoice.status help: Where the invoice is.
    %%field Invoice.order_id help: The order this invoice bills.

`;

function process(update: Record<string, string>): Automation {
  const a = emptyAutomation("Order", "saga");
  a.name = "Bill order";
  a.sagaTrigger = "automatic";
  a.sagaOperation = "UPDATE";
  const create = newStep("CreateEntity");
  create.resultName = "invoiceId";
  create.props = { entity: "Invoice", values: "status: draft" };
  const write = newStep("UpdateEntity");
  write.props = update;
  a.steps = [create, write];
  return a;
}

const problemsOf = (a: Automation) => validateAutomation(a).map((p) => p.message);
const checkerErrors = (a: Automation) =>
  checkSource(ERD + serializeAutomation(a))
    .issues.filter((issue) => issue.severity === "error")
    .map((issue) => issue.code);

describe("an Update step that writes another record type", () => {
  it("offers Which record", () => {
    expect(STEP_FIELDS.UpdateEntity).toContain("target");
  });

  it("is unfinished without saying which row, in the builder and the checker alike", () => {
    const a = process({ entity: "Invoice", field: "status", value: "sent" });
    expect(problemsOf(a)).toContain(
      "Step 2 writes a Invoice but does not say which one. Set Which record."
    );
    expect(checkerErrors(a)).toContain("EML265");
  });

  it("is finished with a reference to a row an earlier step published", () => {
    const a = process({
      entity: "Invoice",
      target: "{{invoiceId}}",
      field: "status",
      value: "sent",
    });
    expect(problemsOf(a)).toEqual([]);
    expect(checkerErrors(a)).toEqual([]);
  });

  it("is finished with the column that points back to this record", () => {
    const a = process({ entity: "Invoice", target: "order_id", field: "status", value: "sent" });
    expect(problemsOf(a)).toEqual([]);
    expect(checkerErrors(a)).toEqual([]);
  });

  it("needs no target to write the record the process runs on", () => {
    expect(problemsOf(process({ field: "status", value: "billed" }))).toEqual([]);
    expect(problemsOf(process({ entity: "Order", field: "status", value: "billed" }))).toEqual([]);
  });
});
