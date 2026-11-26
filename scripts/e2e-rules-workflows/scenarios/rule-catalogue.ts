/**
 * Forty-one business rules, each built in the Logic step's decision table
 * through its own controls, tried with sample records in "Try it", saved and
 * reopened. Between them they use every operator the table offers — Text,
 * Number, Boolean and Date — every answer (validation-error, transform, allow),
 * one to three input columns, one to three rows, and a spread of priorities.
 *
 * An input is written `Tab:operator[:value]`, exactly as the operator palette
 * words it ("Number:greater than:60", "Text:is one of:a,b", "Number:between:7,13").
 * Outputs beginning "@" are picked from the column's list; others are typed.
 */

import type { TableRuleScenario } from "../lib/rule-table";

const block = (message: string) => ({
  action: "validation-error" as const,
  answers: [`"${message}"`],
});
const allow = { action: "allow" as const };
const ANY = "Text:any";
const NUM_ANY = "Number:any";

export const TABLE_RULES: TableRuleScenario[] = [
  {
    name: "Withdrawn student frozen",
    entity: "Student",
    inputs: ["status"],
    rows: [
      { when: ["Text:equals:withdrawn"], ...block("Withdrawn students cannot be changed") },
      { when: [ANY], ...allow },
    ],
    tryIt: [
      {
        sample: { status: "withdrawn" },
        expect: "blocks",
        message: "Withdrawn students cannot be changed",
      },
      { sample: { status: "enrolled" }, expect: "allows" },
    ],
  },
  {
    name: "Only enrolled students",
    entity: "Student",
    inputs: ["status"],
    rows: [{ when: ["Text:not equals:enrolled"], ...block("Only enrolled students may change") }],
    tryIt: [
      { sample: { status: "graduated" }, expect: "blocks" },
      { sample: { status: "enrolled" }, expect: "nomatch" },
    ],
  },
  {
    name: "Year group allowed",
    entity: "Student",
    inputs: ["year_group"],
    rows: [
      { when: ["Number:is one of:7,8,9"], ...allow },
      { when: [NUM_ANY], ...block("Year group out of range") },
    ],
    tryIt: [
      { sample: { year_group: 8 }, expect: "allows" },
      { sample: { year_group: 12 }, expect: "blocks", message: "Year group out of range" },
    ],
  },
  {
    name: "Closed sections locked",
    entity: "ClassSection",
    inputs: ["status"],
    rows: [{ when: ["Text:is one of:cancelled,completed"], ...block("This section is closed") }],
    tryIt: [
      { sample: { status: "cancelled" }, expect: "blocks" },
      { sample: { status: "completed" }, expect: "blocks" },
      { sample: { status: "open" }, expect: "nomatch" },
    ],
  },
  {
    name: "Section must be open or planned",
    entity: "ClassSection",
    inputs: ["status"],
    rows: [
      { when: ["Text:is not one of:open,planned"], ...block("Section must be open or planned") },
    ],
    tryIt: [
      { sample: { status: "open" }, expect: "nomatch" },
      { sample: { status: "cancelled" }, expect: "blocks" },
    ],
  },
  {
    name: "Admission reference format",
    entity: "AdmissionApplication",
    inputs: ["reference"],
    rows: [
      { when: ["Text:starts with:ADM-"], ...allow },
      { when: [ANY], ...block("References start with ADM-") },
    ],
    tryIt: [
      { sample: { reference: "ADM-0001" }, expect: "allows" },
      { sample: { reference: "XYZ-1" }, expect: "blocks" },
    ],
  },
  {
    name: "School email domain",
    entity: "Student",
    inputs: ["school_email"],
    rows: [
      { when: ["Text:ends with:@school.edu"], ...allow },
      { when: [ANY], ...block("Use a school.edu address") },
    ],
    tryIt: [
      { sample: { school_email: "ann@school.edu" }, expect: "allows" },
      { sample: { school_email: "ann@gmail.com" }, expect: "blocks" },
    ],
  },
  {
    name: "Rejection note guard",
    entity: "AdmissionApplication",
    inputs: ["decision_notes"],
    rows: [{ when: ["Text:contains:reject"], ...block("Rejections need a second reviewer") }],
    tryIt: [
      { sample: { decision_notes: "Please reject this application" }, expect: "blocks" },
      { sample: { decision_notes: "Looks fine" }, expect: "nomatch" },
    ],
  },
  {
    name: "Withdrawal needs a reason",
    entity: "Student",
    inputs: ["status", "withdrawal_reason"],
    rows: [
      { when: ["Text:equals:withdrawn", "Text:is empty"], ...block("Give a withdrawal reason") },
      { when: [ANY, ANY], ...allow },
    ],
    tryIt: [
      { sample: { status: "withdrawn", withdrawal_reason: null }, expect: "blocks" },
      // A cleared text box arrives as a blank string, which is just as empty.
      { sample: { status: "withdrawn", withdrawal_reason: "" }, expect: "blocks" },
      { sample: { status: "withdrawn", withdrawal_reason: "moved away" }, expect: "allows" },
      { sample: { status: "enrolled", withdrawal_reason: null }, expect: "allows" },
    ],
  },
  {
    name: "Reason present",
    entity: "Student",
    inputs: ["withdrawal_reason"],
    rows: [
      { when: ["Text:is not empty"], ...allow },
      { when: [ANY], ...block("A reason is required") },
    ],
    tryIt: [
      { sample: { withdrawal_reason: "family move" }, expect: "allows" },
      { sample: { withdrawal_reason: null }, expect: "blocks" },
      { sample: { withdrawal_reason: "" }, expect: "blocks" },
    ],
  },
  {
    name: "Payments frozen",
    entity: "Payment",
    inputs: ["method"],
    rows: [{ when: [ANY], ...block("Payments are frozen") }],
    tryIt: [{ sample: { method: "cash" }, expect: "blocks", message: "Payments are frozen" }],
  },
  {
    name: "Closed record custom test",
    entity: "Student",
    inputs: ["status"],
    rows: [
      { when: ['Text:custom:$ == "withdrawn" or $ == "graduated"'], ...block("Closed record") },
    ],
    tryIt: [
      { sample: { status: "graduated" }, expect: "blocks" },
      { sample: { status: "enrolled" }, expect: "nomatch" },
    ],
  },
  {
    name: "Reserved capacity",
    entity: "ClassSection",
    inputs: ["capacity"],
    rows: [{ when: ["Number:equals:30"], ...block("Capacity 30 is reserved") }],
    tryIt: [
      { sample: { capacity: 30 }, expect: "blocks" },
      { sample: { capacity: 25 }, expect: "nomatch" },
    ],
  },
  {
    name: "Capacity not zero",
    entity: "ClassSection",
    inputs: ["capacity"],
    rows: [
      { when: ["Number:not equals:0"], ...allow },
      { when: [NUM_ANY], ...block("Capacity cannot be zero") },
    ],
    tryIt: [
      { sample: { capacity: 0 }, expect: "blocks" },
      { sample: { capacity: 20 }, expect: "allows" },
    ],
  },
  {
    name: "Cash limit",
    entity: "Payment",
    inputs: ["amount"],
    rows: [{ when: ["Number:greater than:10000"], ...block("Over the limit") }],
    tryIt: [
      { sample: { amount: 20000 }, expect: "blocks" },
      { sample: { amount: 10000 }, expect: "nomatch" },
      { sample: { amount: 50 }, expect: "nomatch" },
    ],
  },
  {
    name: "Late flag at fifteen",
    entity: "AttendanceRecord",
    inputs: ["minutes_late"],
    extraOutputs: ["field", "value"],
    rows: [
      { when: ["Number:greater or equal:15"], action: "transform", answers: ["@status", '"late"'] },
    ],
    tryIt: [
      { sample: { minutes_late: 20 }, expect: "changes" },
      { sample: { minutes_late: 15 }, expect: "changes" },
      { sample: { minutes_late: 5 }, expect: "nomatch" },
    ],
  },
  {
    name: "Positive payment",
    entity: "Payment",
    inputs: ["amount"],
    rows: [{ when: ["Number:less than:1"], ...block("Payment must be positive") }],
    tryIt: [
      { sample: { amount: 0 }, expect: "blocks" },
      { sample: { amount: 5 }, expect: "nomatch" },
    ],
  },
  {
    name: "Settled invoice only",
    entity: "FeeInvoice",
    inputs: ["balance_due"],
    rows: [
      { when: ["Number:less or equal:0"], ...allow },
      { when: [NUM_ANY], ...block("Outstanding balance") },
    ],
    tryIt: [
      { sample: { balance_due: 0 }, expect: "allows" },
      { sample: { balance_due: 40 }, expect: "blocks" },
    ],
  },
  {
    name: "Year group range",
    entity: "Student",
    inputs: ["year_group"],
    rows: [
      { when: ["Number:between:7,13"], ...allow },
      { when: [NUM_ANY], ...block("Years 7 to 13 only") },
    ],
    tryIt: [
      { sample: { year_group: 10 }, expect: "allows" },
      { sample: { year_group: 13 }, expect: "allows" },
      { sample: { year_group: 3 }, expect: "blocks" },
    ],
  },
  {
    name: "Attendance rate missing",
    entity: "Enrollment",
    inputs: ["attendance_rate"],
    rows: [{ when: ["Number:is empty"], ...block("Attendance rate missing") }],
    tryIt: [
      { sample: { attendance_rate: null }, expect: "blocks" },
      { sample: { attendance_rate: 0.9 }, expect: "nomatch" },
    ],
  },
  {
    name: "Score required",
    entity: "AssessmentResult",
    inputs: ["score"],
    rows: [
      { when: ["Number:is not empty"], ...allow },
      { when: [NUM_ANY], ...block("A score is required") },
    ],
    tryIt: [
      { sample: { score: 55 }, expect: "allows" },
      { sample: { score: null }, expect: "blocks" },
    ],
  },
  {
    name: "Not reception years",
    entity: "Student",
    inputs: ["year_group"],
    rows: [
      { when: ["Number:is not one of:1,2,3"], ...allow },
      { when: [NUM_ANY], ...block("Reception years are managed elsewhere") },
    ],
    tryIt: [
      { sample: { year_group: 5 }, expect: "allows" },
      { sample: { year_group: 2 }, expect: "blocks" },
    ],
  },
  {
    name: "Score out of range",
    entity: "AssessmentResult",
    inputs: ["score"],
    rows: [{ when: ["Number:custom:> 100 or < 0"], ...block("Score out of range") }],
    tryIt: [
      { sample: { score: 120 }, expect: "blocks" },
      { sample: { score: -1 }, expect: "blocks" },
      { sample: { score: 50 }, expect: "nomatch" },
    ],
  },
  {
    name: "Support plan review",
    entity: "Student",
    inputs: ["has_support_plan"],
    rows: [{ when: ["Boolean:equals:true"], ...block("Plan review required") }],
    tryIt: [
      { sample: { has_support_plan: true }, expect: "blocks" },
      { sample: { has_support_plan: false }, expect: "nomatch" },
    ],
  },
  {
    name: "Guardian may not collect",
    entity: "StudentGuardian",
    inputs: ["may_collect"],
    rows: [{ when: ["Boolean:equals:false"], ...block("This guardian may not collect") }],
    tryIt: [
      { sample: { may_collect: false }, expect: "blocks" },
      { sample: { may_collect: true }, expect: "nomatch" },
    ],
  },
  {
    name: "Room flag unset",
    entity: "Room",
    inputs: ["is_active"],
    rows: [{ when: ["Boolean:is empty"], ...block("Room needs an active flag") }],
    tryIt: [
      { sample: { is_active: null }, expect: "blocks" },
      { sample: { is_active: true }, expect: "nomatch" },
    ],
  },
  {
    name: "Room flag set",
    entity: "Room",
    inputs: ["is_active"],
    rows: [
      { when: ["Boolean:is not empty"], ...allow },
      { when: ["Boolean:any"], ...block("Set the active flag") },
    ],
    tryIt: [
      { sample: { is_active: false }, expect: "allows" },
      { sample: { is_active: null }, expect: "blocks" },
    ],
  },
  {
    name: "Inactive course",
    entity: "Course",
    inputs: ["is_active"],
    rows: [{ when: ["Boolean:custom:$ == false"], ...block("Course is inactive") }],
    tryIt: [
      { sample: { is_active: false }, expect: "blocks" },
      { sample: { is_active: true }, expect: "nomatch" },
    ],
  },
  {
    name: "Someone must collect",
    entity: "StudentGuardian",
    inputs: ["may_collect", "is_primary_contact"],
    rows: [
      {
        when: ["Boolean:equals:false", "Boolean:equals:false"],
        ...block("Someone must be able to collect"),
      },
      { when: ["Boolean:any", "Boolean:any"], ...allow },
    ],
    tryIt: [
      { sample: { may_collect: false, is_primary_contact: false }, expect: "blocks" },
      { sample: { may_collect: true, is_primary_contact: false }, expect: "allows" },
    ],
  },
  {
    name: "Term too far ahead",
    entity: "AcademicTerm",
    inputs: ["starts_on"],
    rows: [{ when: ["Date:after:2030-01-01"], ...block("Term starts too far ahead") }],
    tryIt: [
      { sample: { starts_on: "2031-05-01" }, expect: "blocks" },
      { sample: { starts_on: "2025-01-01" }, expect: "nomatch" },
    ],
  },
  {
    name: "Impossible end date",
    entity: "AcademicTerm",
    inputs: ["ends_on"],
    rows: [{ when: ["Date:before:2000-01-01"], ...block("End date is impossible") }],
    tryIt: [
      { sample: { ends_on: "1999-12-31" }, expect: "blocks" },
      { sample: { ends_on: "2026-01-01" }, expect: "nomatch" },
    ],
  },
  {
    name: "No census on the fifteenth",
    entity: "AcademicTerm",
    inputs: ["census_on"],
    rows: [{ when: ["Date:same day:2030-06-15"], ...block("No census on this day") }],
    tryIt: [
      { sample: { census_on: "2030-06-15" }, expect: "blocks" },
      { sample: { census_on: "2030-06-16" }, expect: "nomatch" },
    ],
  },
  {
    name: "Start date in future",
    entity: "Staff",
    inputs: ["started_on"],
    rows: [{ when: ["Date:same or after:2030-01-01"], ...block("Start date is in the future") }],
    tryIt: [
      { sample: { started_on: "2030-01-01" }, expect: "blocks" },
      { sample: { started_on: "2029-12-31" }, expect: "nomatch" },
    ],
  },
  {
    name: "Too old for the register",
    entity: "Student",
    inputs: ["date_of_birth"],
    rows: [{ when: ["Date:same or before:2005-01-01"], ...block("Too old for this register") }],
    tryIt: [
      { sample: { date_of_birth: "2005-01-01" }, expect: "blocks" },
      { sample: { date_of_birth: "2010-01-01" }, expect: "nomatch" },
    ],
  },
  {
    name: "Cash needs a reference",
    entity: "Payment",
    inputs: ["method", "amount", "reference"],
    rows: [
      {
        when: ["Text:equals:cash", "Number:greater than:5000", "Text:is empty"],
        ...block("Large cash payments need a reference"),
      },
      { when: [ANY, NUM_ANY, ANY], ...allow },
    ],
    tryIt: [
      { sample: { method: "cash", amount: 6000, reference: null }, expect: "blocks" },
      { sample: { method: "cash", amount: 6000, reference: "" }, expect: "blocks" },
      { sample: { method: "cash", amount: 6000, reference: "R-1" }, expect: "allows" },
      { sample: { method: "card", amount: 6000, reference: null }, expect: "allows" },
    ],
  },
  {
    name: "Cancelled invoice balance",
    entity: "FeeInvoice",
    inputs: ["status", "balance_due"],
    rows: [
      {
        when: ["Text:equals:cancelled", "Number:greater than:0"],
        ...block("An invoice with a balance cannot be cancelled"),
      },
      { when: [ANY, NUM_ANY], ...allow },
    ],
    tryIt: [
      { sample: { status: "cancelled", balance_due: 50 }, expect: "blocks" },
      { sample: { status: "cancelled", balance_due: 0 }, expect: "allows" },
      { sample: { status: "issued", balance_due: 50 }, expect: "allows" },
    ],
  },
  {
    name: "Lateness ladder",
    entity: "AttendanceRecord",
    inputs: ["minutes_late"],
    extraOutputs: ["message", "field", "value"],
    rows: [
      {
        when: ["Number:greater or equal:60"],
        action: "validation-error",
        answers: ['"Far too late to register"'],
      },
      {
        when: ["Number:greater or equal:30"],
        action: "transform",
        answers: ["", "@status", '"late"'],
      },
      { when: [NUM_ANY], ...allow },
    ],
    tryIt: [
      { sample: { minutes_late: 90 }, expect: "blocks", message: "Far too late to register" },
      { sample: { minutes_late: 45 }, expect: "changes" },
      { sample: { minutes_late: 2 }, expect: "allows" },
    ],
  },
  {
    name: "Failed enrolments frozen",
    entity: "Enrollment",
    priority: 1,
    inputs: ["status"],
    rows: [{ when: ["Text:equals:failed"], ...block("Failed enrolments are frozen") }],
    tryIt: [
      { sample: { status: "failed" }, expect: "blocks" },
      { sample: { status: "enrolled" }, expect: "nomatch" },
    ],
  },
  {
    name: "Escalate high severity",
    entity: "DisciplineIncident",
    priority: 999,
    inputs: ["severity"],
    rows: [{ when: ["Text:equals:critical"], ...block("Escalate to the head teacher") }],
    tryIt: [
      { sample: { severity: "critical" }, expect: "blocks" },
      { sample: { severity: "minor" }, expect: "nomatch" },
    ],
  },
  {
    name: "Passing grades only",
    entity: "Enrollment",
    priority: 50,
    inputs: ["final_grade"],
    rows: [
      { when: ["Text:is one of:distinction,merit,pass"], ...allow },
      { when: [ANY], ...block("Grade below C needs moderation") },
    ],
    tryIt: [
      { sample: { final_grade: "merit" }, expect: "allows" },
      { sample: { final_grade: "fail" }, expect: "blocks" },
    ],
  },
  {
    name: "Assessment not past due",
    entity: "Assessment",
    priority: 20,
    inputs: ["status", "due_on"],
    rows: [
      {
        when: ["Text:equals:cancelled", "Date:before:2020-01-01"],
        ...block("Long-closed assessments are archived"),
      },
      { when: [ANY, "Date:any"], ...allow },
    ],
    tryIt: [
      { sample: { status: "cancelled", due_on: "2019-05-05" }, expect: "blocks" },
      { sample: { status: "draft", due_on: "2019-05-05" }, expect: "allows" },
    ],
  },
];
