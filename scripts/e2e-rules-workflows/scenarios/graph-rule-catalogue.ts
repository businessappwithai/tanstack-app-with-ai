/**
 * Rules drawn node by node in the graph editor — the Expression, Function and
 * Switch nodes the decision table cannot express, singly and chained. Spec 03
 * builds and tries them; spec 14 also updates and deletes them.
 */

import { fn, type GraphRuleScenario } from "../lib/graph-rule";

export const GRAPH_RULES: GraphRuleScenario[] = [
  {
    name: "Graph expression only",
    entity: "AttendanceRecord",
    chain: [{ kind: "Expression", rows: [["isLate", "minutes_late >= 15"]] }],
    // An expression gives a value but no action, so the application does nothing with it.
    tryIt: [{ sample: { minutes_late: 20 }, expect: "nothing" }],
  },
  {
    name: "Graph function blocks",
    entity: "Payment",
    chain: [
      fn([
        'if (input.amount > 10000) return { action: "validation-error", message: "Too large for one payment" };',
        'return { action: "allow" };',
      ]),
    ],
    tryIt: [
      { sample: { amount: 20000 }, expect: "blocks", message: "Too large for one payment" },
      { sample: { amount: 20 }, expect: "allows" },
    ],
  },
  {
    name: "Graph function transforms",
    entity: "AttendanceRecord",
    chain: [
      fn([
        'if (input.minutes_late >= 15) return { action: "transform", transformData: { status: "late" } };',
        'return { action: "allow" };',
      ]),
    ],
    tryIt: [
      { sample: { minutes_late: 30 }, expect: "changes" },
      { sample: { minutes_late: 1 }, expect: "allows" },
    ],
  },
  {
    name: "Graph function string check",
    entity: "Student",
    chain: [
      fn([
        'if ((input.school_email || "").endsWith("@gmail.com")) return { action: "validation-error", message: "Use the school address" };',
        'return { action: "allow" };',
      ]),
    ],
    tryIt: [
      {
        sample: { school_email: "a@gmail.com" },
        expect: "blocks",
        message: "Use the school address",
      },
      { sample: { school_email: "a@school.edu" }, expect: "allows" },
    ],
  },
  {
    name: "Graph expression then function",
    entity: "FeeInvoice",
    chain: [
      { kind: "Expression", rows: [["owing", "balance_due > 0"]] },
      fn([
        'if (input.owing && input.status === "cancelled") return { action: "validation-error", message: "Settle the balance first" };',
        'return { action: "allow" };',
      ]),
    ],
    tryIt: [
      {
        sample: { status: "cancelled", balance_due: 10 },
        expect: "blocks",
        message: "Settle the balance first",
      },
      { sample: { status: "issued", balance_due: 10 }, expect: "allows" },
    ],
  },
  {
    name: "Graph switch passes through",
    entity: "Student",
    chain: [{ kind: "Switch", condition: "status != null" }],
    tryIt: [{ sample: { status: "enrolled" }, expect: "nothing" }],
  },
  {
    name: "Graph function reads dates",
    entity: "AcademicTerm",
    chain: [
      fn([
        'if (input.starts_on && input.ends_on && input.starts_on > input.ends_on) return { action: "validation-error", message: "A term cannot end before it starts" };',
        'return { action: "allow" };',
      ]),
    ],
    tryIt: [
      { sample: { starts_on: "2026-09-01", ends_on: "2026-01-01" }, expect: "blocks" },
      { sample: { starts_on: "2026-01-01", ends_on: "2026-09-01" }, expect: "allows" },
    ],
  },
  {
    name: "Graph function booleans",
    entity: "StudentGuardian",
    chain: [
      fn([
        'if (!input.may_collect && !input.is_primary_contact) return { action: "validation-error", message: "Someone must collect" };',
        'return { action: "allow" };',
      ]),
    ],
    tryIt: [
      { sample: { may_collect: false, is_primary_contact: false }, expect: "blocks" },
      { sample: { may_collect: true, is_primary_contact: false }, expect: "allows" },
    ],
  },
  {
    name: "Graph switch then function",
    entity: "Enrollment",
    chain: [
      { kind: "Switch", condition: "status != null" },
      fn([
        'if (input.status === "failed") return { action: "validation-error", message: "Failed enrolments are closed" };',
        'return { action: "allow" };',
      ]),
    ],
    tryIt: [
      { sample: { status: "failed" }, expect: "blocks", message: "Failed enrolments are closed" },
      { sample: { status: "enrolled" }, expect: "allows" },
    ],
  },
  {
    name: "Graph expression switch function",
    entity: "Payment",
    chain: [
      { kind: "Expression", rows: [["large", "amount > 5000"]] },
      { kind: "Switch", condition: "large != null" },
      fn([
        'if (input.large) return { action: "validation-error", message: "Large payments need approval" };',
        'return { action: "allow" };',
      ]),
    ],
    tryIt: [
      { sample: { amount: 9000 }, expect: "blocks", message: "Large payments need approval" },
      { sample: { amount: 90 }, expect: "allows" },
    ],
  },
  {
    name: "Graph two functions",
    entity: "FeeInvoice",
    chain: [
      fn(["return { ...input, overdue: (input.balance_due || 0) > 100 };"]),
      fn([
        'if (input.overdue) return { action: "validation-error", message: "Overdue invoices are held" };',
        'return { action: "allow" };',
      ]),
    ],
    tryIt: [
      { sample: { balance_due: 500 }, expect: "blocks", message: "Overdue invoices are held" },
      { sample: { balance_due: 5 }, expect: "allows" },
    ],
  },
];
