/**
 * Sagas through the automation ladder.
 *
 * A saga is the ordered steps an automation already had, started by a business
 * rule rather than by a lifecycle event. That start lives on the `%%workflow`
 * directive as `trigger:` and `operation:` — nowhere in the diagram — and the
 * single-trigger shape had nowhere to put it. Reading one mapped `operation`
 * onto the nearest lifecycle event and dropped both, so a `trigger: rule` saga
 * came back as "runs when created" and saving said so in the model.
 *
 * The property worth holding is that a saga survives the trip: parse it,
 * write it, parse it again, and nothing about how it starts has changed.
 */

import { describe, expect, it } from "vitest";
import {
  type Automation,
  emptyAutomation,
  parseAutomation,
  serializeAutomation,
  validateAutomation,
} from "../model";

const doc = (header: string, ...body: string[]) => [header, "flowchart TD", ...body].join("\n");

/** The five shapes the CRM model actually uses. */
const HEADERS = [
  "%%workflow LeadConversion entity: Lead kind: saga trigger: rule",
  "%%workflow QuoteApprovalEscalation entity: Quote kind: saga trigger: rule",
  "%%workflow ClosedWonHandoff entity: Opportunity kind: saga trigger: automatic operation: UPDATE",
  "%%workflow RenewalPlaybook entity: Contract kind: saga trigger: automatic operation: UPDATE",
  "%%workflow CriticalCaseEscalation entity: SupportCase kind: saga",
];

describe("reading a saga", () => {
  it("marks the kind and keeps how the run starts", () => {
    const a = parseAutomation(doc(HEADERS[0] as string, "    A --> B"), "Record");
    expect(a.kind).toBe("saga");
    expect(a.sagaTrigger).toBe("rule");
    expect(a.trigger.entity).toBe("Lead");
  });

  it("reads the operation when the lifecycle starts it", () => {
    const a = parseAutomation(doc(HEADERS[2] as string, "    A --> B"), "Record");
    expect(a.sagaTrigger).toBe("automatic");
    expect(a.sagaOperation).toBe("UPDATE");
  });

  it("treats an absent trigger as automatic, because only `rule` is ever written", () => {
    // language/composer.ts omits the token unless it is `rule`, so defaulting
    // the other way turned every automatic saga into a rule-triggered one.
    const a = parseAutomation(doc(HEADERS[4] as string, "    A --> B"), "Record");
    expect(a.sagaTrigger).toBe("automatic");
  });

  it("leaves a hook workflow alone", () => {
    const a = parseAutomation(
      ["flowchart TD", "    %%hook beforeCreate normalizeName on Account"].join("\n"),
      "Account"
    );
    expect(a.kind).toBe("hook");
    expect(a.sagaTrigger).toBeUndefined();
  });
});

/**
 * The education model's InvoiceSettlement writes the payment's invoice — another
 * record type — and names the row by the column pointing at it. Reading dropped
 * `targetField`, so all four of that model's update-another-record sagas opened
 * as "does not say which one": a working process the editor called broken.
 */
describe("an update aimed by a column", () => {
  const settlement = doc(
    "%%workflow InvoiceSettlement entity: Payment kind: saga trigger: rule",
    "    A[Start] --> B[Mark paid]",
    "    %%step B UpdateEntity entity: FeeInvoice targetField: fee_invoice_id field: status value: paid"
  );

  it("reads the column as Which record, and finds nothing missing", () => {
    const a = parseAutomation(settlement, "Payment");
    const step = a.steps[0];
    expect(step?.props.target).toBe("fee_invoice_id");
    expect(validateAutomation(a).filter((p) => p.target === step?.id)).toEqual([]);
  });

  it("reads it from the one-property-per-line form the editor saves", () => {
    const a = parseAutomation(
      doc(
        "%%workflow InvoiceSettlement entity: Payment kind: saga trigger: rule",
        "  s1[Set FeeInvoice.status to paid]",
        "%%step s1 type: UpdateEntity",
        "%%step s1 entity: FeeInvoice",
        "%%step s1 targetField: fee_invoice_id",
        "%%step s1 field: status",
        "%%step s1 value: paid"
      ),
      "Payment"
    );
    const step = a.steps[0];
    expect(step?.props.target).toBe("fee_invoice_id");
    expect(step?.props.targetField).toBeUndefined();
    expect(validateAutomation(a).filter((p) => p.target === step?.id)).toEqual([]);
  });

  it("writes it back as the same column", () => {
    const again = parseAutomation(serializeAutomation(parseAutomation(settlement, "Payment")));
    expect(again.steps[0]?.props.target).toBe("fee_invoice_id");
  });
});

describe("writing a saga", () => {
  it("round-trips every header the CRM model uses", () => {
    for (const header of HEADERS) {
      const first = parseAutomation(doc(header, "    A --> B"), "Record");
      const again = parseAutomation(serializeAutomation(first), "Record");

      expect(again.kind).toBe("saga");
      expect(again.sagaTrigger).toBe(first.sagaTrigger);
      expect(again.sagaOperation).toBe(first.sagaOperation);
      expect(again.trigger.entity).toBe(first.trigger.entity);
    }
  });

  it("writes the positional directive, not the automation form", () => {
    const a: Automation = {
      ...emptyAutomation("Opportunity", "saga"),
      name: "Closed Won Handoff",
      sagaTrigger: "automatic",
      sagaOperation: "UPDATE",
    };
    const directive = serializeAutomation(a)
      .split("\n")
      .find((l) => l.startsWith("%%workflow"));

    // Named as an identifier, and `trigger:` omitted because automatic is the
    // value the composer leaves out.
    expect(directive).toBe(
      "%%workflow ClosedWonHandoff entity: Opportunity kind: saga operation: UPDATE"
    );
  });

  it("omits the operation when it is the default", () => {
    const a: Automation = {
      ...emptyAutomation("Lead", "saga"),
      name: "LeadConversion",
      sagaTrigger: "rule",
      sagaOperation: "CREATE",
    };
    const directive = serializeAutomation(a)
      .split("\n")
      .find((l) => l.startsWith("%%workflow"));
    expect(directive).toBe("%%workflow LeadConversion entity: Lead kind: saga trigger: rule");
  });

  it("leaves the directive out when the caller owns it", () => {
    // The wizard stores trigger and operation as columns and lets the composer
    // write the header, so emitting it here too would produce it twice.
    const a = { ...emptyAutomation("Lead", "saga"), name: "LeadConversion" };
    const body = serializeAutomation(a, { header: false });

    expect(body).not.toContain("%%workflow");
    expect(body).not.toContain("%%meta");
    expect(body.split("\n")[0]).toBe("flowchart TD");
  });

  it("says what actually starts the run on the start node", () => {
    const byRule = serializeAutomation({
      ...emptyAutomation("Lead", "saga"),
      sagaTrigger: "rule",
    });
    expect(byRule).toContain("start([Lead — a rule decides])");

    const byUpdate = serializeAutomation({
      ...emptyAutomation("Opportunity", "saga"),
      sagaTrigger: "automatic",
      sagaOperation: "UPDATE",
    });
    // Not "is created", which is what trigger.event still holds.
    expect(byUpdate).toContain("start([Opportunity is updated])");
  });
});
