/**
 * Parent and child, from the one directive that declares it to the dictionary
 * rows the running application reads.
 *
 * `%%entity <Child> parent: <Parent>` is the only place a model can say that an
 * entity has no life away from its owner — the ERD cannot, because
 * `InvoiceLine.invoice_id` and `Invoice.customer_id` are the same shape. What
 * the directive buys is an arrangement: no window and no dashboard card for the
 * child, a tab inside the parent's window instead, linked on the foreign key the
 * child already declared. Every assertion below is about one step of that, and
 * each of them has been silently wrong at some point:
 *
 *  - the child kept a window, so it got a dashboard card as well as a tab;
 *  - the tab was created but `link_column_id` was never set, so the detail list
 *    showed every row of the child table under every parent record;
 *  - the column was never marked `is_parent`, which is what the browser bundle
 *    and the NestJS seed both read to find the link.
 *
 * The checker half is here for the same reason: EML149 is the only thing that
 * notices an entity shaped like a line item that never says so, and a model that
 * never says so generates the arrangement this file exists to prevent.
 */

import { describe, expect, it } from "vitest";
import { checkSource } from "../../../../../language/checker";
import { parseModel } from "../../pipeline/parse-model";
import { DictionaryGenerator } from "../dictionary.generator";

/**
 * An invoice with lines, and a customer the invoice merely references.
 *
 * The two foreign keys are deliberately identical in shape — that is the whole
 * point of the directive, and a fixture where they differed would test nothing.
 */
const MODEL = `%%meta name: Billing
erDiagram
    Customer {
        string id PK
        string name
    }
    Invoice {
        string id PK
        string reference
        string customer_id FK
    }
    InvoiceLine {
        string id PK
        string invoice_id FK
        string description
        decimal amount
    }
    Customer ||--o{ Invoice : "billed"
    Invoice ||--o{ InvoiceLine : "contains"
    %%entity Customer help: An organisation the business bills. The account outlives every invoice on it, which is why a customer is never deleted while an unpaid one stands.
    %%field Customer.name help: The trading name to address on correspondence and to print on the invoice. Not necessarily the registered entity.
    %%entity Invoice help: A demand for payment issued to a customer, and the record the money is chased against. Created when work is signed off, and never edited once issued: a correction is a credit note.
    %%field Invoice.reference help: The number the customer quotes when paying. It is what a remittance is matched on, so it is issued once and never reused.
    %%field Invoice.customer_id help: The organisation being billed. It decides which payment terms apply and where the invoice is sent, and it is fixed once the invoice is issued.
    %%entity InvoiceLine parent: Invoice
    %%entity InvoiceLine help: One charge on an invoice. A line has no meaning away from its invoice — line 2 of invoice 4417, not line 2 — which is why it is a line item rather than a screen of its own.
    %%field InvoiceLine.invoice_id help: The invoice this charge belongs to. It is what the invoice's own screen lists the lines by.
    %%field InvoiceLine.description help: What is being charged for, in the words the customer will read on the document. Specific enough that they can approve it without asking.
    %%field InvoiceLine.amount help: What this line adds to the invoice, before tax. The invoice total is what these come to, so a line changed after issue changes what is owed.
    %%category name: Billing; entities: Customer, Invoice
    %%section entity: Customer; name: Customer; help: Who is billed, under the name the invoice is addressed to.; rows: name
    %%section entity: Invoice; name: Invoice; help: Which demand this is and whom it is made of.; rows: reference, customer_id
    %%section entity: InvoiceLine; name: Charge; help: What one line of the invoice charges for, and how much.; rows: invoice_id | description, amount
`;

function dictionaryFor(source: string) {
  const model = parseModel(source);
  const generator = new DictionaryGenerator({ projectName: "billing" });
  return {
    model,
    dictionary: generator.generateDictionaryContext(model.entities, model.relationships),
  };
}

describe("%%entity parent: — the dictionary arrangement", () => {
  const { model, dictionary } = dictionaryFor(MODEL);

  it("hangs the parent on the child at parse time, with the column to link on", () => {
    const line = model.entities.find((entity) => entity.name === "InvoiceLine");
    expect(line?.parentEntity).toBe("Invoice");
    expect(line?.parentLinkColumn).toBe("invoice_id");

    // The reference is untouched: an invoice still points at a customer who
    // exists independently, and nothing about that is master-detail.
    expect(
      model.entities.find((entity) => entity.name === "Invoice")?.parentEntity
    ).toBeUndefined();
  });

  it("gives the child no window of its own", () => {
    const windowTables = new Set(dictionary.sysWindows.map((window) => window._tableRef));
    const tableIdOf = (name: string) =>
      dictionary.sysTables.find((table) => table.table_name === name)?._tempId;

    expect(windowTables.has(tableIdOf("bus_invoice") as string)).toBe(true);
    expect(windowTables.has(tableIdOf("bus_customer") as string)).toBe(true);
    expect(windowTables.has(tableIdOf("bus_invoice_line") as string)).toBe(false);
  });

  it("puts the child's tab inside the parent's window, one level down", () => {
    const tableIdOf = (name: string) =>
      dictionary.sysTables.find((table) => table.table_name === name)?._tempId;
    const tabFor = (name: string) =>
      dictionary.sysTabs.find((tab) => tab._tableRef === tableIdOf(name));

    const invoiceTab = tabFor("bus_invoice");
    const lineTab = tabFor("bus_invoice_line");

    expect(invoiceTab?.tab_level).toBe(0);
    expect(lineTab?.tab_level).toBe(1);
    expect(lineTab?.sys_window_id).toBe(invoiceTab?.sys_window_id);
    // Sequenced after the master tab, never before it.
    expect(Number(lineTab?.seq_no)).toBeGreaterThan(Number(invoiceTab?.seq_no));
  });

  it("links the tab on the child's own foreign key, and marks that column", () => {
    const lineTable = dictionary.sysTables.find((table) => table.table_name === "bus_invoice_line");
    const lineTab = dictionary.sysTabs.find((tab) => tab._tableRef === lineTable?._tempId);
    const linkColumn = dictionary.sysColumns.find(
      (column) => column._tempId === lineTab?.link_column_id
    );

    expect(linkColumn?.column_name).toBe("invoice_id");
    expect(linkColumn?.is_parent).toBe(true);

    // Nothing else is marked: `Invoice.customer_id` is a reference, and marking
    // it would put invoices in a tab under the customer.
    const marked = dictionary.sysColumns
      .filter((column) => column.is_parent)
      .map((column) => column.column_name);
    expect(marked).toEqual(["invoice_id"]);
  });

  it("points the child's table at the window its records are reached through", () => {
    const invoiceTable = dictionary.sysTables.find((table) => table.table_name === "bus_invoice");
    const lineTable = dictionary.sysTables.find((table) => table.table_name === "bus_invoice_line");
    const invoiceTab = dictionary.sysTabs.find((tab) => tab._tableRef === invoiceTable?._tempId);

    expect(lineTable?.sys_window_id).toBe(invoiceTab?.sys_window_id);
  });

  it("links a parent whose name begins with an acronym", () => {
    /*
     * `KYCRecord` snake-cases to `kyc_record`, which is the column the
     * migration emits and the name a model writes — but the parser carried its
     * own snake-caser without the acronym rule, so it looked for `kycrecord_id`,
     * found nothing, and left the child unlinked. It kept its own window and
     * gained no tab, and nothing reported it: the checker's EML148 had the same
     * bug, so the two agreed with each other and both were wrong.
     */
    const source = `%%meta name: Onboarding
erDiagram
    KYCRecord {
        string id PK
        string reference
    }
    KYCVerification {
        string id PK
        string kyc_record_id FK
        string outcome
    }
    KYCRecord ||--o{ KYCVerification : "evidenced by"
    %%entity KYCRecord help: The file establishing a client's identity, and the gate on every transaction.
    %%field KYCRecord.reference help: The registry's own reference for this file, quoted when another intermediary confirms the client is already verified.
    %%entity KYCVerification parent: KYCRecord
    %%entity KYCVerification help: One check performed as part of a KYC file — an identity document validated, a sanctions list searched.
    %%field KYCVerification.kyc_record_id help: The file this check belongs to. Read inside it, where the checks together are the evidence for its status.
    %%field KYCVerification.outcome help: passed or failed. One failed check holds the whole file, whatever the others say.
`;

    const { model, dictionary } = dictionaryFor(source);
    const child = model.entities.find((entity) => entity.name === "KYCVerification");
    expect(child?.parentEntity).toBe("KYCRecord");
    expect(child?.parentLinkColumn).toBe("kyc_record_id");

    const childTable = dictionary.sysTables.find(
      (table) => table.table_name === "bus_kyc_verification"
    );
    const childTab = dictionary.sysTabs.find((tab) => tab._tableRef === childTable?._tempId);
    expect(childTab?.tab_level).toBe(1);
    expect(childTab?.link_column_id).toBeTruthy();

    // And the checker agrees rather than reporting a key that is plainly there.
    expect(checkSource(source).issues.map((issue) => issue.code)).not.toContain("EML148");
  });

  it("arranges the same way when the child is declared before its parent", () => {
    const reordered = MODEL.replace(
      / {4}Invoice \{[\s\S]*?\n {4}\}\n( {4}InvoiceLine \{[\s\S]*?\n {4}\}\n)/,
      (_match, line: string) =>
        `${line}    Invoice {\n        string id PK\n        string reference\n        string customer_id FK\n    }\n`
    );
    const { dictionary: out } = dictionaryFor(reordered);

    const tableIdOf = (name: string) =>
      out.sysTables.find((table) => table.table_name === name)?._tempId;
    const lineTab = out.sysTabs.find((tab) => tab._tableRef === tableIdOf("bus_invoice_line"));
    const invoiceTab = out.sysTabs.find((tab) => tab._tableRef === tableIdOf("bus_invoice"));

    expect(lineTab?.tab_level).toBe(1);
    expect(lineTab?.sys_window_id).toBe(invoiceTab?.sys_window_id);
  });
});

describe("EML149 — an entity shaped like a line item that never says so", () => {
  it("stays quiet on a model that declares its parent", () => {
    const codes = checkSource(MODEL).issues.map((issue) => issue.code);
    expect(codes).not.toContain("EML149");
    expect(codes).not.toContain("EML150");
  });

  it("names the candidate and its parent when the directive is missing", () => {
    const source = MODEL.replace("    %%entity InvoiceLine parent: Invoice\n", "");
    const report = checkSource(source);
    const found = report.issues.filter((issue) => issue.code === "EML149");

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("info");
    expect(found[0]?.message).toContain("InvoiceLine");
    expect(found[0]?.message).toContain("Invoice");
    // Never an error: whether a list of these away from their owner is useful
    // is a question about the business, not about the document.
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(0);
  });

  it("does not fire on a plain reference", () => {
    // Invoice references Customer and is named nothing like it, which is what
    // most foreign keys look like.
    const source = MODEL.replace("    %%entity InvoiceLine parent: Invoice\n", "");
    const found = checkSource(source)
      .issues.filter((issue) => issue.code === "EML149")
      .map((issue) => issue.message);
    expect(found.join(" ")).not.toContain("Customer");
  });

  it("finds a line item whose parent's name is not a prefix of its own", () => {
    const source = `%%meta name: Advice
erDiagram
    Recommendation {
        string id PK
        string name
    }
    InvestmentRecommendation {
        string id PK
        string name
    }
    RecommendationItem {
        string id PK
        string investment_recommendation_id FK
        decimal weight
    }
    InvestmentRecommendation ||--o{ RecommendationItem : "proposes"
`;
    const found = checkSource(source).issues.filter((issue) => issue.code === "EML149");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("RecommendationItem");
    expect(found[0]?.message).toContain("InvestmentRecommendation");
  });
});

describe("EML150 — a child on the dashboard it cannot appear on", () => {
  it("reports a declared child that is still named in a %%category", () => {
    const source = MODEL.replace(
      "%%category name: Billing; entities: Customer, Invoice",
      "%%category name: Billing; entities: Customer, Invoice, InvoiceLine"
    );
    const report = checkSource(source);
    const found = report.issues.filter((issue) => issue.code === "EML150");

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.message).toContain("InvoiceLine");
  });
});
