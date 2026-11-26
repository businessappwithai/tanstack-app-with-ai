/**
 * Help text, and the three ways a model has none.
 *
 * `%%entity … help:` and `%%field … help:` are the only explanation a generated
 * application ever has: they become `sys_table.description` and
 * `sys_column.description`, what a field's `?` shows, and the whole of the
 * "what it is for" column of `manual.html`. There is no second source — no
 * hand-written tooltip, no README beside the form — so a model that skips help
 * produces an application whose manual is a table of dashes.
 *
 * Coverage alone was not enough, which is why `EML151` exists. A published
 * model carried help on all 91 of its entities and all 551 of its columns, and
 * 699 of those lines were the column's own name in a sentence — `Household id
 * for HouseholdMember.` Every coverage check passed and the manual read as a
 * list of labels printed twice.
 *
 * The three codes are held here together because the interesting property is
 * the boundary between them: `EML151` has to fire on a template and stay quiet
 * on real help that happens to be short, or it becomes a warning nobody reads.
 */

import { describe, expect, it } from "vitest";
import { checkSource } from "../../../../../language/checker";

/** A small model with help worth having on every entity and every column. */
const DOCUMENTED = `%%meta name: Lending
erDiagram
    Borrower {
        string id PK
        string full_name
        string credit_score
    }
    Loan {
        string id PK
        string borrower_id FK
        money principal
        date maturity_date
    }
    Borrower ||--o{ Loan : "holds"
    %%entity Borrower help: Somebody who has borrowed, or applied to borrow. The record outlives every loan on it, because a repayment history is the main thing a second application is judged on.
    %%field Borrower.full_name help: Legal name as it appears on the identity document the application was verified against. A mismatch here is the commonest reason a disbursal is held up.
    %%field Borrower.credit_score help: The bureau score at the last pull, 300-900. It sets the rate band the borrower qualifies for, and a score pulled more than 90 days ago has to be refreshed before approval.
    %%entity Loan help: One advance of money and the obligation to repay it. A loan is created on approval rather than on application, so an application that was refused leaves no loan behind.
    %%field Loan.borrower_id help: Who owes the money. It decides whose repayment history the loan affects and who is pursued on default.
    %%field Loan.principal help: The amount advanced, before interest. Repayment schedules are derived from it, so correcting it after disbursal means reissuing the schedule.
    %%field Loan.maturity_date help: When the last instalment falls due. Past it, an unpaid loan moves to recovery, which is a different process with different authority.
`;

function codes(source: string): string[] {
  return checkSource(source).issues.map((issue) => issue.code);
}

function messagesFor(source: string, code: string): string[] {
  return checkSource(source)
    .issues.filter((issue) => issue.code === code)
    .map((issue) => issue.message);
}

describe("a model that documents itself", () => {
  it("reports none of the three help codes", () => {
    const found = codes(DOCUMENTED);
    expect(found).not.toContain("EML151");
    expect(found).not.toContain("EML152");
    expect(found).not.toContain("EML153");
  });

  it("does not ask for help on the primary key", () => {
    // Nothing above documents `id`, deliberately: it is a generated uuid,
    // read-only on every form, and the only available sentence restates it.
    expect(messagesFor(DOCUMENTED, "EML153")).toEqual([]);
  });
});

describe("EML152 — an entity nobody described", () => {
  it("names the entity", () => {
    const source = DOCUMENTED.replace(/^ {4}%%entity Loan help:.*$/m, "");
    const found = messagesFor(source, "EML152");
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("Loan");
  });

  it("is a warning, so the model still passes", () => {
    const source = DOCUMENTED.replace(/^ {4}%%entity Loan help:.*$/m, "");
    const report = checkSource(source);
    expect(report.errors).toBe(0);
    expect(report.ok).toBe(true);
  });
});

describe("EML153 — the columns nobody described", () => {
  it("reports once per entity and names the columns", () => {
    const source = DOCUMENTED.replace(
      /^ {4}%%field Loan\.(principal|maturity_date) help:.*$/gm,
      ""
    );
    const found = messagesFor(source, "EML153");

    // One diagnostic, not two: a model that skipped help entirely would
    // otherwise bury every other finding under one line per column.
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("Loan");
    expect(found[0]).toContain("2 columns");

    const hint = checkSource(source).issues.find((issue) => issue.code === "EML153")?.hint ?? "";
    expect(hint).toContain("principal");
    expect(hint).toContain("maturity_date");
  });
});

describe("EML151 — help that restates its own subject", () => {
  const cases: Array<[string, string]> = [
    ["the key restated", "%%field Loan.principal help: Unique identifier for Loan."],
    ["the column name in prose", "%%field Loan.principal help: Principal for Loan."],
    ["the column name alone", "%%field Loan.principal help: The principal."],
    [
      "a template sentence",
      "%%entity Loan help: Loan is a business record in the lending platform.",
    ],
  ];

  for (const [name, line] of cases) {
    it(`fires on ${name}`, () => {
      const target = line.startsWith("%%entity")
        ? /^ {4}%%entity Loan help:.*$/m
        : /^ {4}%%field Loan\.principal help:.*$/m;
      const source = DOCUMENTED.replace(target, `    ${line}`);
      expect(codes(source)).toContain("EML151");
    });
  }

  it("stays quiet on real help that happens to be short", () => {
    // The reason the rule is a set of shapes rather than a length: a short
    // sentence that says something is help, and a warning that fires on it is
    // a warning nobody reads.
    const source = DOCUMENTED.replace(
      /^ {4}%%field Loan\.maturity_date help:.*$/m,
      "    %%field Loan.maturity_date help: The day the last instalment falls due."
    );
    expect(codes(source)).not.toContain("EML151");
  });

  it("stays quiet on help that begins with the column's words and goes on", () => {
    const source = DOCUMENTED.replace(
      /^ {4}%%field Loan\.principal help:.*$/m,
      "    %%field Loan.principal help: Principal advanced, before interest and before any fee that is capitalised into the loan."
    );
    expect(codes(source)).not.toContain("EML151");
  });

  it("is a warning rather than an error", () => {
    const source = DOCUMENTED.replace(
      /^ {4}%%field Loan\.principal help:.*$/m,
      "    %%field Loan.principal help: Principal for Loan."
    );
    const report = checkSource(source);
    expect(report.errors).toBe(0);
    expect(report.warnings).toBeGreaterThan(0);
  });
});

describe("EML154 — a %%category the parser will skip", () => {
  /*
   * `category.parser.ts` requires a `name:` key and continues without one, so
   * the shorthand below declares nothing: the grouping is lost and its entities
   * fall into the default General category. Nothing reported it, because the
   * directive is a comment Mermaid ignores and a directive the generator
   * ignores too — and one published model carried four of them.
   */
  const MODEL = `%%meta name: Reporting
erDiagram
    DataSource {
        string id PK
        string host
    }
    %%entity DataSource help: An external database this workspace can query, with its credentials stored encrypted.
    %%field DataSource.host help: The address the database answers on, reachable from the platform rather than from the analyst's own machine.
`;

  it("reports the shorthand and offers the line that works", () => {
    const source = `${MODEL}    %%category Sources: DataSource\n`;
    const issue = checkSource(source).issues.find((candidate) => candidate.code === "EML154");

    expect(issue?.severity).toBe("warning");
    expect(issue?.hint).toContain("name: Sources");
    expect(issue?.hint).toContain("entities: DataSource");
  });

  it("stays quiet on the documented form", () => {
    const source = `${MODEL}    %%category name: Sources; entities: DataSource\n`;
    expect(codes(source)).not.toContain("EML154");
  });
});
