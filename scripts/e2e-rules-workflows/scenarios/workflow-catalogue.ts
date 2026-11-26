/**
 * Fifty workflows, each built in the Logic step's own editors: sixteen
 * lifecycle workflows (every hook the editor offers), twelve status machines
 * (two to six states, branching, loops back, several end states, labelled and
 * unlabelled moves) and twenty-two processes (every step type, every test, a
 * repeat, both ways to start, every write that can start one).
 */

import type { WorkflowScenario } from "../lib/logic-page";

const hook = (when: string, handler: string, field?: string) => ({
  when,
  handler,
  ...(field ? { field } : {}),
});

const LIFECYCLES: WorkflowScenario[] = [
  {
    kind: "lifecycle",
    name: "Student Intake Hooks",
    entity: "Student",
    hooks: [hook("beforeCreate", "normaliseStudentName")],
  },
  {
    kind: "lifecycle",
    name: "Student Welcome Hooks",
    entity: "Student",
    hooks: [hook("afterCreate", "sendWelcomePack")],
  },
  {
    kind: "lifecycle",
    name: "Student Change Hooks",
    entity: "Student",
    hooks: [
      hook("beforeUpdate", "checkStatusMove", "status"),
      hook("afterUpdate", "auditStudentChange"),
    ],
  },
  {
    kind: "lifecycle",
    name: "Staff Removal Hooks",
    entity: "Staff",
    hooks: [hook("beforeDelete", "guardLastAdministrator")],
  },
  {
    kind: "lifecycle",
    name: "Course Cleanup Hooks",
    entity: "Course",
    hooks: [hook("afterDelete", "cleanupSections")],
  },
  {
    kind: "lifecycle",
    name: "Room Read Guard Hooks",
    entity: "Room",
    hooks: [hook("beforeRead", "redactBuilding")],
  },
  {
    kind: "lifecycle",
    name: "Room Read Enrich Hooks",
    entity: "Room",
    hooks: [hook("afterRead", "enrichRoomUsage")],
  },
  {
    kind: "lifecycle",
    name: "Department Scope Hooks",
    entity: "Department",
    hooks: [hook("beforeQuery", "scopeDepartments")],
  },
  {
    kind: "lifecycle",
    name: "Department Trim Hooks",
    entity: "Department",
    hooks: [hook("afterQuery", "trimDepartmentRows")],
  },
  {
    kind: "lifecycle",
    name: "Guardian List Order Hooks",
    entity: "Guardian",
    hooks: [hook("beforeList", "defaultGuardianSort")],
  },
  {
    kind: "lifecycle",
    name: "Guardian List Mask Hooks",
    entity: "Guardian",
    hooks: [hook("afterList", "maskGuardianPhones")],
  },
  {
    kind: "lifecycle",
    name: "Payment Validation Hooks",
    entity: "Payment",
    hooks: [hook("customValidate", "crossCheckAmounts")],
  },
  {
    kind: "lifecycle",
    name: "Invoice Full Cycle Hooks",
    entity: "FeeInvoice",
    hooks: [
      hook("beforeCreate", "numberInvoice"),
      hook("afterCreate", "queueInvoiceEmail"),
      hook("beforeUpdate", "lockPaidInvoice", "status"),
      hook("afterDelete", "releaseInvoiceLines"),
    ],
  },
  {
    kind: "lifecycle",
    name: "Enrolment Status Hooks",
    entity: "Enrollment",
    hooks: [hook("beforeUpdate", "guardDropRules", "status")],
  },
  {
    kind: "lifecycle",
    name: "Session Time Hooks",
    entity: "ClassSession",
    hooks: [hook("afterUpdate", "notifyTimeChange", "starts_at")],
  },
  {
    kind: "lifecycle",
    name: "Result Marking Hooks",
    entity: "AssessmentResult",
    hooks: [
      hook("beforeCreate", "stampMarker"),
      hook("customValidate", "checkScoreBounds", "score"),
      hook("afterCreate", "refreshGradebook"),
    ],
  },
];

const state = (
  name: string,
  entity: string,
  states: string[],
  transitions: Array<[string, string, string?]>,
  end: string[]
): WorkflowScenario => ({
  kind: "status",
  name,
  entity,
  states,
  transitions: transitions.map(([from, to, trigger]) => ({
    from,
    to,
    ...(trigger ? { trigger } : {}),
  })),
  end,
});

const STATUSES: WorkflowScenario[] = [
  state(
    "Two State Switch",
    "Room",
    ["closed", "opened"],
    [["closed", "opened", "open"]],
    ["opened"]
  ),
  state(
    "Room Booking Cycle",
    "Room",
    ["free", "held", "booked", "released"],
    [
      ["free", "held", "hold"],
      ["held", "booked", "confirm"],
      ["booked", "released"],
    ],
    ["released"]
  ),
  state(
    "Payment Clearing",
    "Payment",
    ["received", "cleared", "bounced"],
    [
      ["received", "cleared", "clear"],
      ["received", "bounced", "bounce"],
    ],
    ["cleared", "bounced"]
  ),
  state(
    "Course Approval",
    "Course",
    ["draft", "review", "approved", "rejected"],
    [
      ["draft", "review", "submit"],
      ["review", "approved", "approve"],
      ["review", "rejected", "reject"],
      ["rejected", "draft", "rework"],
    ],
    ["approved"]
  ),
  state(
    "Guardian Contact Check",
    "Guardian",
    ["unverified", "verified"],
    [
      ["unverified", "verified", "verify"],
      ["verified", "unverified", "expire"],
    ],
    ["verified"]
  ),
  state(
    "Department Lifecycle Loop",
    "Department",
    ["planning", "active", "paused", "closed"],
    [
      ["planning", "active"],
      ["active", "paused", "pause"],
      ["paused", "active", "resume"],
      ["active", "closed", "close"],
    ],
    ["closed"]
  ),
  state(
    "Invoice Line Review",
    "FeeInvoiceLine",
    ["new", "checked", "disputed", "settled"],
    [
      ["new", "checked", "check"],
      ["checked", "disputed", "dispute"],
      ["disputed", "checked", "resolve"],
      ["checked", "settled"],
    ],
    ["settled"]
  ),
  state(
    "Guardian Link Flow",
    "StudentGuardian",
    ["proposed", "confirmed", "retired"],
    [
      ["proposed", "confirmed"],
      ["confirmed", "retired"],
    ],
    ["retired"]
  ),
  state(
    "Attendance Marking Flow",
    "AttendanceRecord",
    ["unmarked", "present", "absent", "excused", "late"],
    [
      ["unmarked", "present", "mark_present"],
      ["unmarked", "absent", "mark_absent"],
      ["unmarked", "late", "mark_late"],
      ["absent", "excused", "excuse"],
    ],
    ["present", "excused", "late"]
  ),
  state(
    "Incident Escalation Ladder",
    "DisciplineIncident",
    ["reported", "triaged", "investigating", "sanctioned", "appealed", "closed"],
    [
      ["reported", "triaged", "triage"],
      ["triaged", "investigating", "investigate"],
      ["investigating", "sanctioned", "sanction"],
      ["sanctioned", "appealed", "appeal"],
      ["appealed", "investigating", "reopen"],
      ["sanctioned", "closed", "close"],
    ],
    ["closed"]
  ),
  state("Single End Only", "Department", ["only", "done"], [["only", "done"]], ["done"]),
  state(
    "Term Rollover",
    "AcademicTerm",
    ["upcoming", "current", "census", "ended"],
    [
      ["upcoming", "current", "start"],
      ["current", "census", "take_census"],
      ["census", "ended", "finish"],
    ],
    ["ended"]
  ),
];

const check = (field: string, test: string, value?: string) => ({
  type: "A check" as const,
  field,
  test,
  ...(value !== undefined ? { value } : {}),
});

const process = (
  name: string,
  entity: string,
  startsFrom: "automatic" | "rule",
  operation: "CREATE" | "UPDATE" | "DELETE" | "ALL" | undefined,
  steps: Extract<WorkflowScenario, { kind: "process" }>["steps"]
): WorkflowScenario => ({
  kind: "process",
  name,
  entity,
  startsFrom,
  ...(operation ? { operation } : {}),
  steps,
});

const PROCESSES: WorkflowScenario[] = [
  process("Rule Started Notice", "FeeInvoice", "rule", undefined, [
    {
      type: "Call a web service",
      method: "POST",
      url: "https://example.com/hooks/notice",
      saveAs: "noticeReply",
    },
  ]),
  process("Created Welcome Record", "Student", "automatic", "CREATE", [
    {
      type: "Create a record",
      entity: "StudentGuardian",
      values: "student_id: {{student_id}}\nrelationship: parent",
      saveAs: "linkId",
    },
  ]),
  process("Updated Invoice Flag", "FeeInvoice", "automatic", "UPDATE", [
    { type: "Update a field", field: "status", value: "overdue" },
  ]),
  process("Deleted Payment Cleanup", "Payment", "automatic", "DELETE", [
    { type: "Delete a record", entity: "FeeInvoiceLine", target: "{{fee_invoice_id}}" },
  ]),
  process("Any Write Audit", "Student", "automatic", "ALL", [
    { type: "Work out a value", operation: "set", left: "audited", saveAs: "auditFlag" },
  ]),
  process("Check Equals", "FeeInvoice", "rule", undefined, [
    check("feeinvoice.status", "eq", "issued"),
    { type: "Update a field", field: "status", value: "overdue" },
  ]),
  process("Check Not Equals", "FeeInvoice", "rule", undefined, [
    check("feeinvoice.status", "neq", "paid"),
    { type: "Update a field", field: "status", value: "chased" },
  ]),
  process("Check Greater Than", "FeeInvoice", "rule", undefined, [
    check("feeinvoice.balance_due", "gt", "100"),
    { type: "Update a field", field: "status", value: "escalated" },
  ]),
  process("Check Greater Or Equal", "Payment", "rule", undefined, [
    check("payment.amount", "gte", "5000"),
    { type: "Call a web service", method: "POST", url: "https://example.com/hooks/large-payment" },
  ]),
  process("Check Less Than", "Payment", "rule", undefined, [
    check("payment.amount", "lt", "10"),
    { type: "Update a field", field: "method", value: "petty-cash" },
  ]),
  process("Check Less Or Equal", "ClassSection", "rule", undefined, [
    check("classsection.capacity", "lte", "5"),
    { type: "Update a field", field: "status", value: "small" },
  ]),
  process("Check Contains", "AdmissionApplication", "rule", undefined, [
    check("admissionapplication.decision_notes", "contains", "sibling"),
    { type: "Update a field", field: "has_sibling_enrolled", value: "true" },
  ]),
  process("Check Starts With", "AdmissionApplication", "rule", undefined, [
    check("admissionapplication.reference", "startsWith", "ADM-"),
    { type: "Update a field", field: "status", value: "registered" },
  ]),
  process("Check Is Empty", "Student", "rule", undefined, [
    check("student.withdrawal_reason", "isEmpty"),
    { type: "Update a field", field: "withdrawal_reason", value: "not given" },
  ]),
  process("Check Is Not Empty And Changed", "Student", "automatic", "UPDATE", [
    check("student.school_email", "isNotEmpty"),
    check("student.status", "changed"),
    { type: "Call a web service", method: "PUT", url: "https://example.com/hooks/status-change" },
  ]),
  process("Look Up And Create", "AttendanceRecord", "automatic", "CREATE", [
    { type: "Look up a rule table", rule: "attendanceMarking" },
    {
      type: "Create a record",
      entity: "DisciplineIncident",
      values: "student_id: {{student_id}}\nstatus: reported",
      saveAs: "incidentId",
    },
  ]),
  process("Formula Arithmetic", "FeeInvoice", "automatic", "UPDATE", [
    {
      type: "Work out a value",
      operation: "add",
      left: "{{feeinvoice.balance_due}}",
      right: "25",
      saveAs: "withFee",
    },
    {
      type: "Work out a value",
      operation: "subtract",
      left: "{{withFee}}",
      right: "5",
      saveAs: "lessDiscount",
    },
    {
      type: "Work out a value",
      operation: "multiply",
      left: "{{lessDiscount}}",
      right: "2",
      saveAs: "doubled",
    },
    {
      type: "Work out a value",
      operation: "divide",
      left: "{{doubled}}",
      right: "4",
      saveAs: "quartered",
    },
    { type: "Work out a value", operation: "copy", left: "{{quartered}}", saveAs: "copied" },
  ]),
  process("Web Service Methods", "Payment", "rule", undefined, [
    {
      type: "Call a web service",
      method: "GET",
      url: "https://example.com/api/rates",
      saveAs: "rates",
    },
    {
      type: "Call a web service",
      method: "PATCH",
      url: "https://example.com/api/ledger",
      body: '{ "payment": "{{payment.id}}" }',
      saveAs: "patched",
    },
    {
      type: "Call a web service",
      method: "DELETE",
      url: "https://example.com/api/holds",
      saveAs: "released",
    },
  ]),
  process("Update Another Record", "Payment", "automatic", "CREATE", [
    {
      type: "Update a field",
      entity: "FeeInvoice",
      target: "{{fee_invoice_id}}",
      field: "amount_paid",
      value: "{{payment.amount}}",
    },
  ]),
  process("Repeat Until Paid", "FeeInvoice", "automatic", "UPDATE", [
    {
      type: "A repeat",
      field: "feeinvoice.status",
      test: "neq",
      value: "paid",
      max: "3",
      inside: { entity: "FeeInvoice", field: "amount_paid", value: "{{feeinvoice.balance_due}}" },
    },
  ]),
  process("Chase Pipeline", "FeeInvoice", "automatic", "UPDATE", [
    check("feeinvoice.balance_due", "gt", "0"),
    { type: "Look up a rule table", rule: "invoiceControl" },
    {
      type: "Create a record",
      entity: "DisciplineIncident",
      values: "status: reported\nseverity: 2",
      saveAs: "chaseId",
    },
    { type: "Update a field", field: "status", value: "overdue" },
    {
      type: "Work out a value",
      operation: "add",
      left: "{{feeinvoice.balance_due}}",
      right: "25",
      saveAs: "newBalance",
    },
    {
      type: "Call a web service",
      method: "POST",
      url: "https://example.com/hooks/overdue",
      body: '{ "invoice": "{{feeinvoice.id}}" }',
      saveAs: "chaseResponse",
    },
    { type: "Delete a record", entity: "FeeInvoiceLine", target: "{{chaseId}}" },
  ]),
  process("Delete Own Record", "DisciplineIncident", "rule", undefined, [
    { type: "Delete a record" },
  ]),
];

export const WORKFLOWS: WorkflowScenario[] = [...LIFECYCLES, ...STATUSES, ...PROCESSES];
