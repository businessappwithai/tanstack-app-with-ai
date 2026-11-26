/**
 * Sixty workflows, built with the builder's own model — triggers, conditions,
 * steps of every type, loops, hook ladders, processes — and the writes that
 * must set each one off, with what must be true afterwards.
 *
 * Every workflow is guarded by a marker in the entity's first text column, so
 * a run's workflows cannot act on anyone else's records.
 */

import {
  type Automation,
  type AutomationStep,
  emptyAutomation,
  newCondition,
  newHook,
  newLoop,
  newStep,
  type OperatorId,
  type StepType,
  type TriggerEvent,
} from "@/lib/automation/model";

export const TABLE_OF: Record<string, string> = {
  Lead: "bus_lead",
  Account: "bus_account",
  Contact: "bus_contact",
  Opportunity: "bus_opportunity",
  Quote: "bus_quote",
  SupportCase: "bus_support_case",
  Contract: "bus_contract",
  Campaign: "bus_campaign",
  Activity: "bus_activity",
  Product: "bus_product",
  Territory: "bus_territory",
};

export const MARKER_COLUMN: Record<string, string> = {
  Lead: "company_name",
  Account: "name",
  Contact: "last_name",
  Opportunity: "name",
  Quote: "name",
  SupportCase: "subject",
  Contract: "contract_number",
  Campaign: "name",
  Activity: "subject",
  Product: "name",
  Territory: "name",
};

/** What must hold once the write has happened. */
export type Expectation =
  | { record: Record<string, unknown> }
  | { recordGone: true }
  | { runs: number }
  | { mutations: string[] }
  /** Rows made in another table, found by the marker in their `subject` or `name`. */
  | { made: { table: string; column: string; count: number; fields?: Record<string, unknown> } }
  | { runStatus: "success" | "error" };

export type Act =
  | { create: Record<string, unknown> }
  | { update: Record<string, unknown> }
  | { delete: true };

export interface Scenario {
  label: string;
  /** For `update`/`delete`: the record that exists first (made while the workflow is not yet live). */
  arrange?: Record<string, unknown>;
  act: Act;
  expect: Expectation[];
}

export interface WorkflowSpec {
  id: string;
  group: string;
  title: string;
  entity: string;
  build: (marker: string) => Automation;
  scenarios: Scenario[];
  /** Extra setup, such as a rule a Decision step names; returns a cleanup. */
  setup?: (env: {
    post: (path: string, body: unknown) => Promise<any>;
    del: (path: string) => Promise<any>;
    marker: string;
  }) => Promise<() => Promise<void>>;
}

// ── Building blocks ───────────────────────────────────────────────────────────

type StepSpec = [type: StepType, props: Record<string, string>, as?: string, loop?: string];

function steps(list: StepSpec[]): AutomationStep[] {
  return list.map(([type, props, as, loop]) => {
    const step = newStep(type);
    step.props = props;
    if (as !== undefined) step.resultName = as;
    if (loop) step.loopId = loop;
    return step;
  });
}

interface Guard {
  field: string;
  op: OperatorId;
  value?: string;
}

interface Build {
  entity: string;
  kind?: "automation" | "hook" | "saga";
  /** The moment, for an automation. */
  on?: TriggerEvent;
  /** The rungs, for a hook workflow. */
  hooks?: Array<Parameters<typeof newHook>[0]>;
  /** A saga's write, and what starts it. */
  sagaOperation?: "CREATE" | "UPDATE" | "DELETE" | "ALL";
  sagaTrigger?: "automatic" | "rule";
  guards?: Guard[];
  steps: StepSpec[];
  loops?: Array<{ field: string; op: OperatorId; value: string; max: string }>;
  name: string;
}

export let ownerId = "";
export const setOwner = (id: string) => {
  ownerId = id;
};

function automation(b: Build, marker: string): Automation {
  const base = emptyAutomation(b.entity, b.kind ?? "automation");
  // A step may name something made for this run, such as a rule table: `{M}` is the marker.
  b = {
    ...b,
    steps: b.steps.map(
      ([type, props, as, loop]) =>
        [
          type,
          Object.fromEntries(
            Object.entries(props).map(([k, v]) => [
              k,
              v.replaceAll("{M}", marker).replaceAll("{OWNER}", ownerId),
            ])
          ),
          as,
          loop,
        ] as StepSpec
    ),
  };
  const markerGuard: Guard = { field: MARKER_COLUMN[b.entity] as string, op: "eq", value: marker };
  const conditions = [markerGuard, ...(b.guards ?? [])].map((g) => ({
    ...newCondition(),
    field: g.field,
    operator: g.op,
    value: g.value ?? "",
  }));
  const loops = (b.loops ?? []).map((l, i) => ({
    ...newLoop([]),
    id: `L${i + 1}`,
    condition: { ...newCondition(), field: l.field, operator: l.op, value: l.value },
    maxPasses: l.max,
  }));
  return {
    ...base,
    name: `QA ${b.name} ${marker}`,
    trigger: { entity: b.entity, event: b.on ?? "created" },
    conditions,
    loops,
    steps: steps(b.steps),
    hooks:
      (b.kind ?? "automation") === "hook"
        ? (b.hooks ?? ["afterCreate"]).map((event, i) => ({
            ...newHook(event),
            handler: `qa${b.entity}${i}${event}`,
          }))
        : [],
    ...(b.kind === "saga"
      ? { sagaTrigger: b.sagaTrigger ?? "automatic", sagaOperation: b.sagaOperation ?? "CREATE" }
      : {}),
    status: "live",
  } as Automation;
}

/** The record each entity needs, in the words the application accepts. */
const LEAD = (x: Record<string, unknown> = {}) => ({
  first_name: "Wen",
  last_name: "Park",
  email: "wen@example.com",
  lead_source: "web",
  rating: "cold",
  status: "new",
  ...x,
});
const ACCOUNT = (x: Record<string, unknown> = {}) => ({
  account_type: "customer",
  tier: "smb",
  industry: "technology",
  status: "active",
  employee_count: 10,
  annual_revenue: 1000,
  health_score: 50,
  ...x,
});
const CONTACT = (x: Record<string, unknown> = {}) => ({
  first_name: "Bo",
  email: "bo{U}@example.com",
  lead_source: "web",
  status: "active",
  ...x,
});
const OPP = (x: Record<string, unknown> = {}) => ({
  stage: "prospecting",
  amount: 1000,
  probability: 10,
  forecast_category: "pipeline",
  expected_close_date: "2031-01-01",
  ...x,
});
const QUOTE = (x: Record<string, unknown> = {}) => ({
  status: "draft",
  version_number: 1,
  valid_until: "2031-01-01",
  subtotal: 100,
  discount_percent: 0,
  discount_amount: 0,
  tax_amount: 0,
  grand_total: 100,
  ...x,
});
const CASE = (x: Record<string, unknown> = {}) => ({
  case_type: "incident",
  priority: "low",
  origin: "web",
  status: "new",
  ...x,
});
const CONTRACT = (x: Record<string, unknown> = {}) => ({
  status: "draft",
  start_date: "2031-01-01",
  end_date: "2032-01-01",
  term_months: 12,
  annual_value: 1000,
  auto_renew: false,
  renewal_notice_days: 30,
  ...x,
});
const CAMP = (x: Record<string, unknown> = {}) => ({
  campaign_type: "email",
  status: "planning",
  start_date: "2031-01-01",
  end_date: "2031-02-01",
  budgeted_cost: 100,
  actual_cost: 50,
  ...x,
});
const ACT = (x: Record<string, unknown> = {}) => ({
  activity_type: "call",
  status: "planned",
  priority: "low",
  ...x,
});
const PROD = (x: Record<string, unknown> = {}) => ({
  family: "platform",
  list_price: 100,
  unit_cost: 50,
  billing_frequency: "monthly",
  is_active: true,
  ...x,
});
const TERR = (x: Record<string, unknown> = {}) => ({
  region: "EMEA",
  country_code: "GB",
  employee_count_floor: 10,
  employee_count_ceiling: 100,
  is_active: true,
  ...x,
});

/** `{M}` is the run's marker, in whichever column the entity keeps it. */
const marked = (entity: string, x: Record<string, unknown>) => ({
  [MARKER_COLUMN[entity] as string]: "{M}",
  ...x,
});

function wf(
  id: string,
  group: string,
  title: string,
  b: Omit<Build, "name">,
  scenarios: Scenario[],
  setup?: WorkflowSpec["setup"]
): WorkflowSpec {
  return {
    id,
    group,
    title,
    entity: b.entity,
    build: (marker) => automation({ ...b, name: `${id} ${title}` }, marker),
    scenarios,
    setup,
  };
}

const hot = { rating: "hot" };

export const WORKFLOWS: WorkflowSpec[] = [
  // ── One step, one trigger ────────────────────────────────────────────────────
  wf(
    "W01",
    "update a field",
    "A new lead is rated hot",
    { entity: "Lead", steps: [["UpdateEntity", { field: "rating", value: "hot" }, ""]] },
    [
      {
        label: "create",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: hot }, { mutations: ["UpdateEntity"] }],
      },
    ]
  ),
  wf(
    "W02",
    "guard: equals",
    "Referrals are rated hot",
    {
      entity: "Lead",
      guards: [{ field: "lead_source", op: "eq", value: "referral" }],
      steps: [["UpdateEntity", { field: "rating", value: "hot" }, ""]],
    },
    [
      {
        label: "referral",
        act: { create: marked("Lead", LEAD({ lead_source: "referral" })) },
        expect: [{ record: hot }],
      },
      {
        label: "web",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { rating: "cold" } }, { runs: 0 }],
      },
    ]
  ),
  wf(
    "W03",
    "guard: greater than",
    "A scored lead is rated warm",
    {
      entity: "Lead",
      guards: [{ field: "score", op: "gt", value: "50" }],
      steps: [["UpdateEntity", { field: "rating", value: "warm" }, ""]],
    },
    [
      {
        label: "high score",
        act: { create: marked("Lead", LEAD({ score: 80 })) },
        expect: [{ record: { rating: "warm" } }],
      },
      {
        label: "low score",
        act: { create: marked("Lead", LEAD({ score: 20 })) },
        expect: [{ record: { rating: "cold" } }, { runs: 0 }],
      },
    ]
  ),
  wf(
    "W04",
    "guard: not equals",
    "Anything but web is warm",
    {
      entity: "Lead",
      guards: [{ field: "lead_source", op: "neq", value: "web" }],
      steps: [["UpdateEntity", { field: "rating", value: "warm" }, ""]],
    },
    [
      {
        label: "event",
        act: { create: marked("Lead", LEAD({ lead_source: "event" })) },
        expect: [{ record: { rating: "warm" } }],
      },
      {
        label: "web",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { rating: "cold" } }],
      },
    ]
  ),
  wf(
    "W05",
    "guard: contains",
    "Gmail leads are warm",
    {
      entity: "Lead",
      guards: [{ field: "email", op: "contains", value: "@gmail." }],
      steps: [["UpdateEntity", { field: "rating", value: "warm" }, ""]],
    },
    [
      {
        label: "gmail",
        act: { create: marked("Lead", LEAD({ email: "x@gmail.com" })) },
        expect: [{ record: { rating: "warm" } }],
      },
      {
        label: "other",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { rating: "cold" } }],
      },
    ]
  ),
  wf(
    "W06",
    "guard: starts with",
    "Support addresses are cold",
    {
      entity: "Lead",
      guards: [{ field: "email", op: "startsWith", value: "support@" }],
      steps: [["UpdateEntity", { field: "rating", value: "warm" }, ""]],
    },
    [
      {
        label: "support",
        act: { create: marked("Lead", LEAD({ email: "support@acme.io" })) },
        expect: [{ record: { rating: "warm" } }],
      },
      {
        label: "person",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { rating: "cold" } }],
      },
    ]
  ),
  wf(
    "W07",
    "guard: is not empty",
    "A lead with a title is warm",
    {
      entity: "Lead",
      guards: [{ field: "job_title", op: "isNotEmpty" }],
      steps: [["UpdateEntity", { field: "rating", value: "warm" }, ""]],
    },
    [
      {
        label: "titled",
        act: { create: marked("Lead", LEAD({ job_title: "CTO" })) },
        expect: [{ record: { rating: "warm" } }],
      },
      {
        label: "untitled",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { rating: "cold" } }],
      },
    ]
  ),
  wf(
    "W08",
    "guard: is empty",
    "A lead with no title is flagged",
    {
      entity: "Lead",
      guards: [{ field: "job_title", op: "isEmpty" }],
      steps: [["UpdateEntity", { field: "disqualification_reason", value: "no title" }, ""]],
    },
    [
      {
        label: "untitled",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { disqualification_reason: "no title" } }],
      },
      {
        label: "titled",
        act: { create: marked("Lead", LEAD({ job_title: "CTO" })) },
        expect: [{ record: { disqualification_reason: null } }],
      },
    ]
  ),
  wf(
    "W09",
    "guard: several",
    "Big referrals",
    {
      entity: "Lead",
      guards: [
        { field: "lead_source", op: "eq", value: "referral" },
        { field: "employee_count", op: "gte", value: "500" },
        { field: "annual_revenue", op: "lt", value: "1000000000" },
      ],
      steps: [["UpdateEntity", { field: "rating", value: "hot" }, ""]],
    },
    [
      {
        label: "all three",
        act: {
          create: marked(
            "Lead",
            LEAD({ lead_source: "referral", employee_count: 900, annual_revenue: 5000 })
          ),
        },
        expect: [{ record: hot }],
      },
      {
        label: "one short",
        act: {
          create: marked(
            "Lead",
            LEAD({ lead_source: "referral", employee_count: 9, annual_revenue: 5000 })
          ),
        },
        expect: [{ record: { rating: "cold" } }],
      },
    ]
  ),
  wf(
    "W10",
    "guard: at most",
    "A cheap product is flagged",
    {
      entity: "Product",
      guards: [{ field: "list_price", op: "lte", value: "10" }],
      steps: [["UpdateEntity", { field: "description", value: "budget line" }, ""]],
    },
    [
      {
        label: "cheap",
        act: { create: marked("Product", PROD({ list_price: 10 })) },
        expect: [{ record: { description: "budget line" } }],
      },
      {
        label: "dear",
        act: { create: marked("Product", PROD()) },
        expect: [{ record: { description: null } }],
      },
    ]
  ),

  // ── Formula steps pass values between steps ───────────────────────────────────
  wf(
    "W11",
    "formula: set",
    "Stage a literal, then write it",
    {
      entity: "Lead",
      steps: [
        ["Formula", { operation: "set", left: "warm" }, "tone"],
        ["UpdateEntity", { field: "rating", value: "{{tone}}" }, ""],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { rating: "warm" } }, { mutations: ["Formula", "UpdateEntity"] }],
      },
    ]
  ),
  wf(
    "W12",
    "formula: multiply",
    "Double the score",
    {
      entity: "Lead",
      steps: [
        ["Formula", { operation: "multiply", left: "{{score}}", right: "2" }, "doubled"],
        ["UpdateEntity", { field: "employee_count", value: "{{doubled}}" }, ""],
      ],
    },
    [
      {
        label: "score 21",
        act: { create: marked("Lead", LEAD({ score: 21 })) },
        expect: [{ record: { employee_count: 42 } }],
      },
    ]
  ),
  wf(
    "W13",
    "formula: add",
    "Add a bonus to the revenue",
    {
      entity: "Account",
      steps: [
        ["Formula", { operation: "add", left: "{{annual_revenue}}", right: "500" }, "total"],
        ["UpdateEntity", { field: "annual_revenue", value: "{{total}}" }, ""],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Account", ACCOUNT({ annual_revenue: 1000 })) },
        expect: [{ record: { annual_revenue: "1500.000000" } }],
      },
    ]
  ),
  wf(
    "W14",
    "formula: subtract",
    "Net of a discount",
    {
      entity: "Quote",
      steps: [
        ["Formula", { operation: "subtract", left: "{{subtotal}}", right: "15" }, "net"],
        ["UpdateEntity", { field: "grand_total", value: "{{net}}" }, ""],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Quote", QUOTE({ subtotal: 100 })) },
        expect: [{ record: { grand_total: "85.000000" } }],
      },
    ]
  ),
  wf(
    "W15",
    "formula: divide",
    "Per-seat price",
    {
      entity: "Product",
      steps: [
        ["Formula", { operation: "divide", left: "{{list_price}}", right: "4" }, "seat"],
        ["UpdateEntity", { field: "unit_cost", value: "{{seat}}" }, ""],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Product", PROD({ list_price: 100 })) },
        expect: [{ record: { unit_cost: "25.000000" } }],
      },
    ]
  ),
  wf(
    "W16",
    "formula: copy",
    "Copy the company onto the title",
    {
      entity: "Lead",
      steps: [
        ["Formula", { operation: "copy", left: "{{company_name}}" }, "company"],
        ["UpdateEntity", { field: "job_title", value: "{{company}}" }, ""],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { job_title: "{M}" } }],
      },
    ]
  ),
  wf(
    "W17",
    "formula chain",
    "Three formulas in a row",
    {
      entity: "Opportunity",
      steps: [
        ["Formula", { operation: "multiply", left: "{{amount}}", right: "3" }, "scaled"],
        ["Formula", { operation: "add", left: "{{scaled}}", right: "10" }, "padded"],
        ["Formula", { operation: "subtract", left: "{{padded}}", right: "1" }, "final"],
        ["UpdateEntity", { field: "next_step", value: "{{final}}" }, ""],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Opportunity", OPP({ amount: 2000 })) },
        expect: [
          { record: { next_step: "6009" } },
          { mutations: ["Formula", "Formula", "Formula", "UpdateEntity"] },
        ],
      },
    ]
  ),
  wf(
    "W18",
    "formula: non-numeric",
    "A formula on a word is skipped, not fatal",
    {
      entity: "Lead",
      steps: [
        ["Formula", { operation: "multiply", left: "{{company_name}}", right: "2" }, "oops"],
        ["UpdateEntity", { field: "rating", value: "warm" }, ""],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { rating: "warm" } }, { runStatus: "success" }],
      },
    ]
  ),

  // ── Create, then reach the new record ─────────────────────────────────────────
  wf(
    "W19",
    "create a record",
    "A new lead gets a follow-up task",
    {
      entity: "Lead",
      steps: [
        [
          "CreateEntity",
          {
            entity: "Activity",
            values:
              "subject: {{company_name}}\nowner_id: {OWNER}\nactivity_type: task\nstatus: planned\npriority: medium",
          },
          "followUp",
        ],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Lead", LEAD()) },
        expect: [
          {
            made: {
              table: "bus_activity",
              column: "subject",
              count: 1,
              fields: { activity_type: "task", priority: "medium" },
            },
          },
        ],
      },
    ]
  ),
  wf(
    "W20",
    "create a record",
    "Two tasks for a hot lead",
    {
      entity: "Lead",
      guards: [{ field: "rating", op: "eq", value: "hot" }],
      steps: [
        [
          "CreateEntity",
          {
            entity: "Activity",
            values:
              "subject: {{company_name}}\nowner_id: {OWNER}\nactivity_type: call\nstatus: planned\npriority: high",
          },
          "first",
        ],
        [
          "CreateEntity",
          {
            entity: "Activity",
            values:
              "subject: {{company_name}}\nowner_id: {OWNER}\nactivity_type: email\nstatus: planned\npriority: high",
          },
          "second",
        ],
      ],
    },
    [
      {
        label: "hot",
        act: { create: marked("Lead", LEAD({ rating: "hot" })) },
        expect: [{ made: { table: "bus_activity", column: "subject", count: 2 } }],
      },
      {
        label: "cold",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ made: { table: "bus_activity", column: "subject", count: 0 } }],
      },
    ]
  ),
  wf(
    "W21",
    "create then update",
    "Create a task, then raise its priority",
    {
      entity: "Lead",
      steps: [
        [
          "CreateEntity",
          {
            entity: "Activity",
            values:
              "subject: {{company_name}}\nowner_id: {OWNER}\nactivity_type: task\nstatus: planned\npriority: low",
          },
          "taskId",
        ],
        [
          "UpdateEntity",
          { entity: "Activity", target: "{{taskId}}", field: "priority", value: "urgent" },
          "",
        ],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Lead", LEAD()) },
        expect: [
          {
            made: {
              table: "bus_activity",
              column: "subject",
              count: 1,
              fields: { priority: "urgent" },
            },
          },
          { mutations: ["CreateEntity", "UpdateEntity"] },
        ],
      },
    ]
  ),
  wf(
    "W22",
    "create then delete",
    "A scratch task is created and removed",
    {
      entity: "Lead",
      steps: [
        [
          "CreateEntity",
          {
            entity: "Activity",
            values:
              "subject: {{company_name}}\nowner_id: {OWNER}\nactivity_type: note\nstatus: planned\npriority: low",
          },
          "scratch",
        ],
        ["DeleteEntity", { entity: "Activity", target: "{{scratch}}" }, ""],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Lead", LEAD()) },
        expect: [
          { made: { table: "bus_activity", column: "subject", count: 0 } },
          { mutations: ["CreateEntity", "DeleteEntity"] },
        ],
      },
    ]
  ),
  wf(
    "W23",
    "create from variables",
    "A formula's result becomes a column",
    {
      entity: "Opportunity",
      steps: [
        ["Formula", { operation: "multiply", left: "{{amount}}", right: "0.1" }, "fee"],
        [
          "CreateEntity",
          {
            entity: "Activity",
            values:
              "subject: {{name}}\nowner_id: {OWNER}\nactivity_type: task\nstatus: planned\npriority: low\nduration_minutes: {{fee}}",
          },
          "task",
        ],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Opportunity", OPP({ amount: 1000 })) },
        expect: [
          {
            made: {
              table: "bus_activity",
              column: "subject",
              count: 1,
              fields: { duration_minutes: 100 },
            },
          },
        ],
      },
    ]
  ),
  wf(
    "W24",
    "create in a related table",
    "A won deal opens a task",
    {
      entity: "Opportunity",
      on: "updated",
      guards: [{ field: "stage", op: "eq", value: "closed_won" }],
      steps: [
        [
          "CreateEntity",
          {
            entity: "Activity",
            values:
              "subject: {{name}}\nowner_id: {OWNER}\nactivity_type: task\nstatus: planned\npriority: high",
          },
          "handoff",
        ],
      ],
    },
    [
      {
        label: "win it",
        arrange: marked("Opportunity", OPP()),
        act: { update: { stage: "closed_won", actual_close_date: "2031-01-02" } },
        expect: [{ made: { table: "bus_activity", column: "subject", count: 1 } }],
      },
    ]
  ),

  // ── Update another record, by a reference ─────────────────────────────────────
  wf(
    "W25",
    "update a related record",
    "A new contact refreshes its account",
    {
      entity: "Contact",
      steps: [
        [
          "UpdateEntity",
          { entity: "Account", target: "{{account_id}}", field: "status", value: "active" },
          "",
        ],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Contact", CONTACT()) },
        expect: [{ mutations: ["UpdateEntity"] }, { runStatus: "success" }],
      },
    ]
  ),
  wf(
    "W26",
    "update a related record",
    "A new quote notes its opportunity",
    {
      entity: "Quote",
      steps: [
        [
          "UpdateEntity",
          {
            entity: "Opportunity",
            target: "{{opportunity_id}}",
            field: "next_step",
            value: "Quote sent",
          },
          "",
        ],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Quote", QUOTE()) },
        expect: [{ mutations: ["UpdateEntity"] }],
      },
    ]
  ),
  wf(
    "W27",
    "update a related record",
    "A new case puts the account on watch",
    {
      entity: "SupportCase",
      guards: [{ field: "priority", op: "eq", value: "critical" }],
      steps: [
        [
          "UpdateEntity",
          { entity: "Account", target: "{{account_id}}", field: "health_score", value: "10" },
          "",
        ],
      ],
    },
    [
      {
        label: "critical",
        act: { create: marked("SupportCase", CASE({ priority: "critical", description: "down" })) },
        expect: [{ mutations: ["UpdateEntity"] }],
      },
      { label: "low", act: { create: marked("SupportCase", CASE()) }, expect: [{ runs: 0 }] },
    ]
  ),
  wf(
    "W28",
    "update a related record",
    "A signed contract renews the account",
    {
      entity: "Contract",
      steps: [
        [
          "UpdateEntity",
          { entity: "Account", target: "{{account_id}}", field: "account_type", value: "customer" },
          "",
        ],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Contract", CONTRACT()) },
        expect: [{ mutations: ["UpdateEntity"] }],
      },
    ]
  ),

  // ── Decisions ────────────────────────────────────────────────────────────────
  wf(
    "W29",
    "decision: a table of its own",
    "Bucket a lead by score",
    {
      entity: "Lead",
      steps: [
        [
          "Decision",
          {
            decisionTable: JSON.stringify({
              hitPolicy: "first",
              inputs: [{ id: "i1", name: "score", field: "score" }],
              outputs: [{ id: "o1", name: "bucket", field: "bucket" }],
              rules: [
                { _id: "r1", i1: ">= 80", o1: '"A"' },
                { _id: "r2", i1: ">= 40", o1: '"B"' },
                { _id: "r3", i1: "", o1: '"C"' },
              ],
            }),
          },
          "decision",
        ],
        ["UpdateEntity", { field: "job_title", value: "{{bucket}}" }, ""],
      ],
    },
    [
      {
        label: "A",
        act: { create: marked("Lead", LEAD({ score: 90 })) },
        expect: [{ record: { job_title: "A" } }],
      },
      {
        label: "B",
        act: { create: marked("Lead", LEAD({ score: 50 })) },
        expect: [{ record: { job_title: "B" } }],
      },
      {
        label: "C",
        act: { create: marked("Lead", LEAD({ score: 5 })) },
        expect: [{ record: { job_title: "C" } }],
      },
    ]
  ),
  wf(
    "W30",
    "decision: two outputs",
    "A decision publishes a rating and a reason",
    {
      entity: "Lead",
      steps: [
        [
          "Decision",
          {
            decisionTable: JSON.stringify({
              hitPolicy: "first",
              inputs: [{ id: "i1", name: "employee_count", field: "employee_count" }],
              outputs: [
                { id: "o1", name: "tone", field: "tone" },
                { id: "o2", name: "why", field: "why" },
              ],
              rules: [
                { _id: "r1", i1: ">= 1000", o1: '"hot"', o2: '"enterprise size"' },
                { _id: "r2", i1: "", o1: '"cold"', o2: '"small"' },
              ],
            }),
          },
          "decision",
        ],
        ["UpdateEntity", { field: "rating", value: "{{tone}}" }, ""],
        ["UpdateEntity", { field: "disqualification_reason", value: "{{why}}" }, ""],
      ],
    },
    [
      {
        label: "enterprise",
        act: { create: marked("Lead", LEAD({ employee_count: 5000 })) },
        expect: [{ record: { rating: "hot", disqualification_reason: "enterprise size" } }],
      },
      {
        label: "small",
        act: { create: marked("Lead", LEAD({ employee_count: 5 })) },
        expect: [{ record: { rating: "cold", disqualification_reason: "small" } }],
      },
    ]
  ),
  wf(
    "W31",
    "decision: no match",
    "A decision that matches nothing leaves things alone",
    {
      entity: "Lead",
      steps: [
        [
          "Decision",
          {
            decisionTable: JSON.stringify({
              hitPolicy: "first",
              inputs: [{ id: "i1", name: "score", field: "score" }],
              outputs: [{ id: "o1", name: "tone", field: "tone" }],
              rules: [{ _id: "r1", i1: "> 1000", o1: '"hot"' }],
            }),
          },
          "decision",
        ],
        ["UpdateEntity", { field: "rating", value: "{{tone}}" }, ""],
      ],
    },
    [
      {
        label: "no match",
        act: { create: marked("Lead", LEAD({ score: 5 })) },
        expect: [{ record: { rating: "cold" } }, { runStatus: "success" }],
      },
    ]
  ),
  wf(
    "W32",
    "decision: a saved rule",
    "Use the rule table named by the step",
    {
      entity: "Lead",
      steps: [
        ["Decision", { ruleTable: "QA tone table {M}" }, "decision"],
        ["UpdateEntity", { field: "rating", value: "{{tone}}" }, ""],
      ],
    },
    [
      {
        label: "strong",
        act: { create: marked("Lead", LEAD({ score: 90 })) },
        expect: [{ record: { rating: "hot" } }],
      },
      {
        label: "weak",
        act: { create: marked("Lead", LEAD({ score: 3 })) },
        expect: [{ record: { rating: "cold" } }],
      },
    ],
    async ({ post, del, marker }) => {
      const table = {
        hitPolicy: "first",
        inputs: [{ id: "i1", name: "score", field: "score" }],
        outputs: [{ id: "o1", name: "tone", field: "tone" }],
        rules: [
          { _id: "r1", i1: ">= 50", o1: "hot" },
          { _id: "r2", i1: "", o1: "cold" },
        ],
      };
      const made = await post("/rules", {
        entityName: "bus_lead",
        ruleName: `QA tone table ${marker}`,
        operation: "ALL",
        jdmContent: JSON.stringify(table),
      });
      return async () => {
        if (made?.body?.id) {
          await del(`/rules/${made.body.id}`);
          await del(`/rules/${made.body.id}?permanent=true`);
        }
      };
    }
  ),
  wf(
    "W33",
    "decision: a graph rule",
    "Use a graph rule with an expression and a function",
    {
      entity: "Lead",
      steps: [
        ["Decision", { ruleTable: "QA graph tone {M}" }, "decision"],
        ["UpdateEntity", { field: "rating", value: "{{tone}}" }, ""],
      ],
    },
    [
      {
        label: "large",
        act: { create: marked("Lead", LEAD({ employee_count: 2000 })) },
        expect: [{ record: { rating: "hot" } }],
      },
      {
        label: "small",
        act: { create: marked("Lead", LEAD({ employee_count: 2 })) },
        expect: [{ record: { rating: "cold" } }],
      },
    ],
    async ({ post, del, marker }) => {
      const graph = {
        nodes: [
          { id: "in", type: "inputNode", name: "Record", position: { x: 0, y: 0 } },
          {
            id: "ex",
            type: "expressionNode",
            name: "Size",
            position: { x: 200, y: 0 },
            content: {
              expressions: [{ id: "e1", key: "size", value: "employee_count" }],
              passThrough: true,
              inputField: null,
              outputPath: null,
              executionMode: "single",
            },
          },
          {
            id: "fn",
            type: "functionNode",
            name: "Tone",
            position: { x: 400, y: 0 },
            content:
              "export const handler = async (input) => ({ tone: Number(input.size) >= 1000 ? 'hot' : 'cold' });",
          },
          { id: "out", type: "outputNode", name: "Response", position: { x: 600, y: 0 } },
        ],
        edges: [
          { id: "a", sourceId: "in", targetId: "ex", type: "edge" },
          { id: "b", sourceId: "ex", targetId: "fn", type: "edge" },
          { id: "c", sourceId: "fn", targetId: "out", type: "edge" },
        ],
      };
      const made = await post("/rules", {
        entityName: "bus_lead",
        ruleName: `QA graph tone ${marker}`,
        operation: "ALL",
        jdmContent: JSON.stringify(graph),
      });
      return async () => {
        if (made?.body?.id) {
          await del(`/rules/${made.body.id}`);
          await del(`/rules/${made.body.id}?permanent=true`);
        }
      };
    }
  ),

  // ── REST ─────────────────────────────────────────────────────────────────────
  wf(
    "W34",
    "REST call",
    "Ping the application on create",
    {
      entity: "Lead",
      steps: [
        ["REST", { method: "GET", url: "http://127.0.0.1:4001/api/rules/entities" }, "response"],
        ["UpdateEntity", { field: "rating", value: "warm" }, ""],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ mutations: ["REST", "UpdateEntity"] }, { record: { rating: "warm" } }],
      },
    ]
  ),
  wf(
    "W35",
    "REST call",
    "Post the record to a webhook",
    {
      entity: "Opportunity",
      steps: [
        [
          "REST",
          {
            method: "POST",
            url: "http://127.0.0.1:4001/api/hooks/none",
            body: '{"name":"{{name}}","amount":{{amount}}}',
          },
          "response",
        ],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Opportunity", OPP()) },
        expect: [{ mutations: ["REST"] }, { runStatus: "success" }],
      },
    ]
  ),
  wf(
    "W36",
    "REST call",
    "An unreachable webhook does not fail the write",
    {
      entity: "Lead",
      steps: [
        ["REST", { method: "POST", url: "http://127.0.0.1:9/never", body: "{}" }, "response"],
        ["UpdateEntity", { field: "rating", value: "warm" }, ""],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { rating: "warm" } }, { runStatus: "success" }],
      },
    ]
  ),

  // ── Loops ────────────────────────────────────────────────────────────────────
  wf(
    "W37",
    "loop",
    "Raise the score until it reaches 50",
    {
      entity: "Lead",
      loops: [{ field: "score", op: "lt", value: "50", max: "20" }],
      steps: [
        ["Formula", { operation: "add", left: "{{score}}", right: "10" }, "next", "L1"],
        ["UpdateEntity", { field: "score", value: "{{next}}" }, "", "L1"],
      ],
    },
    [
      {
        label: "from 15",
        act: { create: marked("Lead", LEAD({ score: 15 })) },
        expect: [{ record: { score: 55 } }],
      },
      {
        label: "already enough",
        act: { create: marked("Lead", LEAD({ score: 70 })) },
        expect: [{ record: { score: 70 } }],
      },
    ]
  ),
  wf(
    "W38",
    "loop",
    "Halve the revenue until under 1000",
    {
      entity: "Account",
      loops: [{ field: "annual_revenue", op: "gte", value: "1000", max: "30" }],
      steps: [
        ["Formula", { operation: "divide", left: "{{annual_revenue}}", right: "2" }, "half", "L1"],
        ["UpdateEntity", { field: "annual_revenue", value: "{{half}}" }, "", "L1"],
      ],
    },
    [
      {
        label: "from 5000",
        act: { create: marked("Account", ACCOUNT({ annual_revenue: 5000 })) },
        expect: [{ record: { annual_revenue: "625.000000" } }],
      },
    ]
  ),
  wf(
    "W39",
    "loop then step",
    "A loop, then a step after it",
    {
      entity: "Lead",
      loops: [{ field: "score", op: "lt", value: "30", max: "10" }],
      steps: [
        ["Formula", { operation: "add", left: "{{score}}", right: "10" }, "next", "L1"],
        ["UpdateEntity", { field: "score", value: "{{next}}" }, "", "L1"],
        ["UpdateEntity", { field: "rating", value: "warm" }, ""],
      ],
    },
    [
      {
        label: "from 0",
        act: { create: marked("Lead", LEAD({ score: 0 })) },
        expect: [{ record: { score: 30, rating: "warm" } }],
      },
    ]
  ),
  wf(
    "W40",
    "loop: gives up",
    "A loop that never ends is reported, not left running",
    {
      entity: "Lead",
      loops: [{ field: "score", op: "lt", value: "1000", max: "3" }],
      steps: [
        ["Formula", { operation: "add", left: "{{score}}", right: "1" }, "next", "L1"],
        ["UpdateEntity", { field: "score", value: "{{next}}" }, "", "L1"],
      ],
    },
    [
      // The run is rolled back with its write's second transaction; what is left is the record, kept as a draft, saying why.
      {
        label: "too slow",
        act: { create: marked("Lead", LEAD({ score: 0 })) },
        expect: [
          {
            record: {
              doc_status: "draft",
              doc_status_message: "This record could not be finalised",
            },
          },
        ],
      },
    ]
  ),

  // ── Other triggers ───────────────────────────────────────────────────────────
  wf(
    "W41",
    "trigger: updated",
    "A converted lead is dated",
    {
      entity: "Lead",
      on: "updated",
      guards: [{ field: "status", op: "eq", value: "working" }],
      steps: [["UpdateEntity", { field: "converted_at", value: "2031-03-04" }, ""]],
    },
    [
      {
        label: "update",
        arrange: marked("Lead", LEAD()),
        act: { update: { status: "working" } },
        expect: [{ record: { converted_at: "2031-03-04T00:00:00.000Z" } }],
      },
    ]
  ),
  wf(
    "W42",
    "trigger: updated",
    "An update that does not match is ignored",
    {
      entity: "Lead",
      on: "updated",
      guards: [{ field: "status", op: "eq", value: "disqualified" }],
      steps: [["UpdateEntity", { field: "rating", value: "cold" }, ""]],
    },
    [
      {
        label: "other update",
        arrange: marked("Lead", LEAD({ rating: "warm" })),
        act: { update: { status: "working" } },
        expect: [{ record: { rating: "warm" } }],
      },
    ]
  ),
  wf(
    "W43",
    "trigger: deleted",
    "Deleting a lead leaves a note",
    {
      entity: "Lead",
      on: "deleted",
      steps: [
        [
          "CreateEntity",
          {
            entity: "Activity",
            values:
              "subject: {{company_name}}\nowner_id: {OWNER}\nactivity_type: note\nstatus: completed\npriority: low",
          },
          "audit",
        ],
      ],
    },
    [
      {
        label: "delete",
        arrange: marked("Lead", LEAD()),
        act: { delete: true },
        expect: [
          { recordGone: true },
          { made: { table: "bus_activity", column: "subject", count: 1 } },
        ],
      },
    ]
  ),
  wf(
    "W44",
    "trigger: deleted",
    "Deleting a lead removes its tasks",
    {
      entity: "Lead",
      on: "deleted",
      steps: [["DeleteEntity", { entity: "Activity", target: "lead_id" }, ""]],
    },
    [
      {
        label: "delete",
        arrange: marked("Lead", LEAD()),
        act: { delete: true },
        expect: [{ recordGone: true }, { mutations: ["DeleteEntity"] }],
      },
    ]
  ),
  wf(
    "W45",
    "trigger: before create",
    "A before-create automation still runs once",
    {
      entity: "Lead",
      on: "beforeCreated",
      steps: [["UpdateEntity", { field: "rating", value: "warm" }, ""]],
    },
    [
      {
        label: "create",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { rating: "warm" } }, { runs: 1 }],
      },
    ]
  ),
  wf(
    "W46",
    "trigger: before update",
    "A before-update automation runs on an update only",
    {
      entity: "Lead",
      on: "beforeUpdated",
      steps: [["UpdateEntity", { field: "rating", value: "warm" }, ""]],
    },
    [
      {
        label: "create does not run it",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { rating: "cold" } }, { runs: 0 }],
      },
      {
        label: "update runs it",
        arrange: marked("Lead", LEAD()),
        act: { update: { job_title: "VP" } },
        expect: [{ record: { rating: "warm" } }],
      },
    ]
  ),
  wf(
    "W47",
    "other record types",
    "A product launch task",
    {
      entity: "Product",
      steps: [
        [
          "CreateEntity",
          {
            entity: "Activity",
            values:
              "subject: {{name}}\nowner_id: {OWNER}\nactivity_type: task\nstatus: planned\npriority: medium",
          },
          "launch",
        ],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Product", PROD()) },
        expect: [{ made: { table: "bus_activity", column: "subject", count: 1 } }],
      },
    ]
  ),
  wf(
    "W48",
    "other record types",
    "A territory is activated",
    { entity: "Territory", steps: [["UpdateEntity", { field: "is_active", value: "true" }, ""]] },
    [
      {
        label: "create",
        act: { create: marked("Territory", TERR({ is_active: false })) },
        expect: [{ record: { is_active: true } }],
      },
    ]
  ),
  wf(
    "W49",
    "other record types",
    "A campaign is activated",
    {
      entity: "Campaign",
      guards: [{ field: "budgeted_cost", op: "gt", value: "50" }],
      steps: [["UpdateEntity", { field: "target_audience", value: "everyone" }, ""]],
    },
    [
      {
        label: "funded",
        act: { create: marked("Campaign", CAMP({ budgeted_cost: 500 })) },
        expect: [{ record: { target_audience: "everyone" } }],
      },
      {
        label: "unfunded",
        act: { create: marked("Campaign", CAMP({ budgeted_cost: 5 })) },
        expect: [{ record: { target_audience: null } }],
      },
    ]
  ),
  wf(
    "W50",
    "other record types",
    "A case acknowledges itself",
    {
      entity: "SupportCase",
      steps: [["UpdateEntity", { field: "resolution_notes", value: "Received" }, ""]],
    },
    [
      {
        label: "create",
        act: { create: marked("SupportCase", CASE()) },
        expect: [{ record: { resolution_notes: "Received" } }],
      },
    ]
  ),

  // ── Hook ladders ─────────────────────────────────────────────────────────────
  wf(
    "W51",
    "hook workflow",
    "After create, mark the lead",
    {
      entity: "Lead",
      kind: "hook",
      hooks: ["afterCreate"],
      steps: [["UpdateEntity", { field: "rating", value: "warm" }, ""]],
    },
    [
      {
        label: "create",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { rating: "warm" } }],
      },
      {
        label: "update does not run it",
        arrange: marked("Lead", LEAD()),
        act: { update: { job_title: "VP" } },
        expect: [{ record: { rating: "cold" } }],
      },
    ]
  ),
  wf(
    "W52",
    "hook workflow",
    "After update, stamp the lead",
    {
      entity: "Lead",
      kind: "hook",
      hooks: ["afterUpdate"],
      steps: [["UpdateEntity", { field: "disqualification_reason", value: "edited" }, ""]],
    },
    [
      {
        label: "update",
        arrange: marked("Lead", LEAD()),
        act: { update: { job_title: "VP" } },
        expect: [{ record: { disqualification_reason: "edited" } }],
      },
      {
        label: "create does not",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { disqualification_reason: null } }],
      },
    ]
  ),
  wf(
    "W53",
    "hook workflow",
    "After delete, leave a note",
    {
      entity: "Lead",
      kind: "hook",
      hooks: ["afterDelete"],
      steps: [
        [
          "CreateEntity",
          {
            entity: "Activity",
            values:
              "subject: {{company_name}}\nowner_id: {OWNER}\nactivity_type: note\nstatus: completed\npriority: low",
          },
          "note",
        ],
      ],
    },
    [
      {
        label: "delete",
        arrange: marked("Lead", LEAD()),
        act: { delete: true },
        expect: [{ made: { table: "bus_activity", column: "subject", count: 1 } }],
      },
    ]
  ),
  wf(
    "W54",
    "hook workflow",
    "Create and update hooks together",
    {
      entity: "Lead",
      kind: "hook",
      hooks: ["afterCreate", "afterUpdate"],
      steps: [["UpdateEntity", { field: "job_title", value: "seen" }, ""]],
    },
    [
      {
        label: "create",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { job_title: "seen" } }],
      },
      {
        label: "update",
        arrange: marked("Lead", LEAD({ job_title: "x" })),
        act: { update: { rating: "warm" } },
        expect: [{ record: { job_title: "seen" } }],
      },
      {
        label: "delete is not covered",
        arrange: marked("Lead", LEAD()),
        act: { delete: true },
        expect: [{ recordGone: true }],
      },
    ]
  ),
  wf(
    "W55",
    "hook workflow",
    "Handlers only, nothing to run",
    { entity: "Lead", kind: "hook", hooks: ["beforeCreate", "customValidate"], steps: [] },
    [
      {
        label: "create",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { rating: "cold" } }, { runs: 0 }],
      },
    ]
  ),

  // ── Processes (sagas) ────────────────────────────────────────────────────────
  wf(
    "W56",
    "process",
    "A lead intake process",
    {
      entity: "Lead",
      kind: "saga",
      sagaOperation: "CREATE",
      sagaTrigger: "automatic",
      steps: [
        ["Formula", { operation: "set", left: "warm" }, "tone"],
        ["UpdateEntity", { field: "rating", value: "{{tone}}" }, ""],
        [
          "CreateEntity",
          {
            entity: "Activity",
            values:
              "subject: {{company_name}}\nowner_id: {OWNER}\nactivity_type: task\nstatus: planned\npriority: low",
          },
          "task",
        ],
      ],
    },
    [
      {
        label: "create",
        act: { create: marked("Lead", LEAD()) },
        expect: [
          { record: { rating: "warm" } },
          { made: { table: "bus_activity", column: "subject", count: 1 } },
          { mutations: ["Formula", "UpdateEntity", "CreateEntity"] },
        ],
      },
    ]
  ),
  wf(
    "W57",
    "process",
    "A process that runs on updates",
    {
      entity: "Opportunity",
      kind: "saga",
      sagaOperation: "UPDATE",
      sagaTrigger: "automatic",
      steps: [["UpdateEntity", { field: "next_step", value: "Reviewed" }, ""]],
    },
    [
      {
        label: "update",
        arrange: marked("Opportunity", OPP()),
        act: { update: { probability: 30 } },
        expect: [{ record: { next_step: "Reviewed" } }],
      },
      {
        label: "create does not",
        act: { create: marked("Opportunity", OPP()) },
        expect: [{ record: { next_step: null } }],
      },
    ]
  ),
  wf(
    "W58",
    "process",
    "A process that runs on deletes",
    {
      entity: "Account",
      kind: "saga",
      sagaOperation: "DELETE",
      sagaTrigger: "automatic",
      steps: [
        [
          "CreateEntity",
          {
            entity: "Activity",
            values:
              "subject: {{name}}\nowner_id: {OWNER}\nactivity_type: note\nstatus: completed\npriority: low",
          },
          "note",
        ],
      ],
    },
    [
      {
        label: "delete",
        arrange: marked("Account", ACCOUNT({ status: "on_hold" })),
        act: { delete: true },
        expect: [{ made: { table: "bus_activity", column: "subject", count: 1 } }],
      },
    ]
  ),
  wf(
    "W59",
    "process",
    "A process on every write",
    {
      entity: "Lead",
      kind: "saga",
      sagaOperation: "ALL",
      sagaTrigger: "automatic",
      steps: [["UpdateEntity", { field: "job_title", value: "touched" }, ""]],
    },
    [
      {
        label: "create",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { job_title: "touched" } }],
      },
      {
        label: "update",
        arrange: marked("Lead", LEAD()),
        act: { update: { job_title: "x" } },
        expect: [{ record: { job_title: "touched" } }],
      },
    ]
  ),
  wf(
    "W60",
    "process",
    "A process only a rule can start",
    {
      entity: "Lead",
      kind: "saga",
      sagaOperation: "CREATE",
      sagaTrigger: "rule",
      steps: [["UpdateEntity", { field: "rating", value: "hot" }, ""]],
    },
    [
      {
        label: "nothing starts it",
        act: { create: marked("Lead", LEAD()) },
        expect: [{ record: { rating: "cold" } }, { runs: 0 }],
      },
    ]
  ),
  wf(
    "W61",
    "process",
    "A rule starts a process",
    {
      entity: "Lead",
      kind: "saga",
      sagaOperation: "CREATE",
      sagaTrigger: "rule",
      steps: [
        ["UpdateEntity", { field: "job_title", value: "started by a rule" }, ""],
        [
          "CreateEntity",
          {
            entity: "Activity",
            values:
              "subject: {{company_name}}\nowner_id: {OWNER}\nactivity_type: task\nstatus: planned\npriority: low",
          },
          "task",
        ],
      ],
    },
    [
      {
        label: "the rule matches",
        act: { create: marked("Lead", LEAD({ score: 90 })) },
        expect: [
          { record: { job_title: "started by a rule" } },
          { made: { table: "bus_activity", column: "subject", count: 1 } },
          { mutations: ["UpdateEntity", "CreateEntity"] },
        ],
      },
      {
        label: "the rule does not match",
        act: { create: marked("Lead", LEAD({ score: 5 })) },
        expect: [{ record: { job_title: null } }, { runs: 0 }],
      },
    ],
    async ({ post, del, marker }) => {
      const processName = `QA W61 A rule starts a process ${marker}`;
      const graph = {
        nodes: [
          { id: "in", type: "inputNode", name: "Record", position: { x: 0, y: 0 } },
          {
            id: "dt",
            type: "decisionTableNode",
            name: "Start it",
            position: { x: 240, y: 0 },
            content: {
              hitPolicy: "collect",
              inputField: null,
              outputPath: null,
              passThrough: false,
              executionMode: "single",
              inputs: [
                { id: "i1", name: "company_name", field: "company_name" },
                { id: "i2", name: "score", field: "score" },
              ],
              outputs: [
                { id: "o1", name: "action", field: "action" },
                { id: "o2", name: "workflowName", field: "workflowName" },
              ],
              rules: [
                {
                  _id: "r1",
                  i1: `"${marker}"`,
                  i2: ">= 50",
                  o1: '"trigger-workflow"',
                  o2: JSON.stringify(processName),
                },
              ],
            },
          },
          { id: "out", type: "outputNode", name: "Response", position: { x: 480, y: 0 } },
        ],
        edges: [
          { id: "a", sourceId: "in", targetId: "dt", type: "edge" },
          { id: "b", sourceId: "dt", targetId: "out", type: "edge" },
        ],
      };
      const made = await post("/rules", {
        entityName: "bus_lead",
        ruleName: `QA starter ${marker}`,
        operation: "CREATE",
        jdmContent: JSON.stringify(graph),
      });
      return async () => {
        if (made?.body?.id) {
          await del(`/rules/${made.body.id}`);
          await del(`/rules/${made.body.id}?permanent=true`);
        }
      };
    }
  ),
];
