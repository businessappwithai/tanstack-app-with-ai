// "then" is a key of the GoRules switch branch data, not a thenable.
/**
 * Fifty-odd business rules, each a different shape of graph, each with the
 * records that must be refused, allowed or changed.
 *
 * Every rule is scoped by a marker value in the entity's first text column, so
 * rules from this run cannot refuse each other's records — or anyone else's.
 */

import {
  BLOCK,
  chain,
  edge,
  expression,
  fn,
  type Graph,
  type Node,
  say,
  switchNode,
  table,
  wire,
} from "./graph";

export type Op = "CREATE" | "UPDATE" | "DELETE";

export interface Case {
  label: string;
  /** For CREATE: the record. For UPDATE: the record that exists first. For DELETE: the record to delete. */
  record: Record<string, unknown>;
  /** For UPDATE: what is written. */
  changes?: Record<string, unknown>;
  expect: "blocks" | "allows" | "transforms";
  /** Every one of these must be among the refusal's messages. */
  messages?: string[];
  /** For `transforms`: the column that must hold this value afterwards. */
  becomes?: { field: string; value: unknown };
}

export interface RuleSpec {
  id: string;
  /** What shape of graph this is — the thing being varied. */
  kind: string;
  title: string;
  entity: string;
  operation: Op;
  build: (marker: string) => Graph;
  cases: Case[];
}

/** The first text column of each entity — where a rule's marker lives. */
export const MARKER_FIELD: Record<string, string> = {
  bus_lead: "company_name",
  bus_opportunity: "name",
  bus_quote: "name",
  bus_account: "name",
  bus_contact: "last_name",
  bus_support_case: "subject",
  bus_contract: "contract_number",
  bus_campaign: "name",
  bus_activity: "subject",
  bus_product: "name",
  bus_territory: "name",
};

const q = (value: string) => JSON.stringify(value);

/** A decision table scoped to the run's marker: its first input is the marker column. */
function scoped(
  entity: string,
  marker: string,
  name: string,
  inputs: string[],
  outputs: string[],
  rows: Array<{ when: string[]; then: string[] }>,
  hit: "first" | "collect" = "collect"
) {
  return table(
    name,
    [MARKER_FIELD[entity] as string, ...inputs],
    outputs,
    rows.map((row) => ({ when: [q(marker), ...row.when], then: row.then })),
    hit
  );
}

const refuse = (message: string) => [BLOCK, say(message)];
const OUT = ["action", "message"];
/** The marker test for a function: records of other runs pass untouched. */
const only = (entity: string, marker: string) =>
  `if (input.${MARKER_FIELD[entity]} !== ${q(marker)}) return {};`;

/** A one-table rule: the most common shape, written once. */
function simple(
  id: string,
  title: string,
  entity: string,
  inputs: string[],
  rows: Array<{ when: string[]; then?: string[]; message: string }>,
  cases: Case[],
  operation: Op = "CREATE",
  hit: "first" | "collect" = "collect"
): RuleSpec {
  return {
    id,
    kind: rows.length > 1 ? "decision table (several rows)" : "decision table",
    title,
    entity,
    operation,
    build: (m) =>
      chain([
        scoped(
          entity,
          m,
          title,
          inputs,
          OUT,
          rows.map((r) => ({ when: r.when, then: r.then ?? refuse(r.message) })),
          hit
        ),
      ]),
    cases,
  };
}

const lead =
  (extra: Record<string, unknown> = {}) =>
  (m: string) => ({
    company_name: m,
    first_name: "Ada",
    last_name: "Quinn",
    email: "ada@example.com",
    lead_source: "web",
    rating: "warm",
    status: "new",
    ...extra,
  });

/** Cases are written with `{M}` where the marker goes; this fills it in at run time. */
export function withMarker<T>(value: T, marker: string): T {
  // `{U}` is a number no other record has used, for the columns the application keeps unique.
  const text = JSON.stringify(value)
    .replaceAll("{M}", marker)
    .replace(/\{U\}/g, () => String(100000 + ++unique));
  return JSON.parse(text);
}
let unique = 0;

const L = (extra: Record<string, unknown>) => ({
  company_name: "{M}",
  first_name: "Ada",
  last_name: "Quinn",
  email: "ada@example.com",
  lead_source: "web",
  rating: "warm",
  status: "new",
  ...extra,
});
const OPP = (extra: Record<string, unknown>) => ({
  name: "{M}",
  stage: "prospecting",
  amount: 1000,
  probability: 10,
  forecast_category: "pipeline",
  expected_close_date: "2031-01-01",
  ...extra,
});
const QUOTE = (extra: Record<string, unknown>) => ({
  name: "{M}",
  status: "draft",
  version_number: 1,
  valid_until: "2031-01-01",
  subtotal: 100,
  discount_percent: 0,
  discount_amount: 0,
  tax_amount: 0,
  grand_total: 100,
  ...extra,
});
const ACC = (extra: Record<string, unknown>) => ({
  name: "{M}",
  account_type: "customer",
  tier: "smb",
  industry: "technology",
  status: "active",
  employee_count: 10,
  annual_revenue: 1000,
  health_score: 50,
  ...extra,
});
const CON = (extra: Record<string, unknown>) => ({
  last_name: "{M}",
  first_name: "Bo",
  email: "bo{U}@example.com",
  lead_source: "web",
  status: "active",
  ...extra,
});
const CASE = (extra: Record<string, unknown>) => ({
  subject: "{M}",
  case_type: "incident",
  priority: "low",
  origin: "web",
  status: "new",
  ...extra,
});
const CONTRACT = (extra: Record<string, unknown>) => ({
  contract_number: "{M}",
  status: "draft",
  start_date: "2031-01-01",
  end_date: "2032-01-01",
  term_months: 12,
  annual_value: 1000,
  auto_renew: false,
  renewal_notice_days: 30,
  ...extra,
});
const CAMP = (extra: Record<string, unknown>) => ({
  name: "{M}",
  campaign_type: "email",
  status: "planning",
  start_date: "2031-01-01",
  end_date: "2031-02-01",
  budgeted_cost: 100,
  actual_cost: 50,
  ...extra,
});
const ACT = (extra: Record<string, unknown>) => ({
  subject: "{M}",
  activity_type: "call",
  status: "planned",
  priority: "low",
  ...extra,
});
const PROD = (extra: Record<string, unknown>) => ({
  name: "{M}",
  family: "platform",
  list_price: 100,
  unit_cost: 50,
  billing_frequency: "monthly",
  is_active: true,
  ...extra,
});
const TERR = (extra: Record<string, unknown>) => ({
  name: "{M}",
  region: "EMEA",
  country_code: "GB",
  employee_count_floor: 10,
  employee_count_ceiling: 100,
  is_active: true,
  ...extra,
});
void lead;

export const RULES: RuleSpec[] = [
  // ── A decision table, read like a spreadsheet ───────────────────────────────
  simple(
    "R01",
    "Hot leads need a score of 50",
    "bus_lead",
    ["rating", "score"],
    [{ when: [q("hot"), "< 50"], message: "Hot leads need a score of 50 or more" }],
    [
      {
        label: "hot, low score",
        record: L({ rating: "hot", score: 10 }),
        expect: "blocks",
        messages: ["Hot leads need a score of 50 or more"],
      },
      { label: "hot, high score", record: L({ rating: "hot", score: 80 }), expect: "allows" },
      { label: "cold, low score", record: L({ rating: "cold", score: 10 }), expect: "allows" },
    ]
  ),
  simple(
    "R02",
    "A disqualified lead says why",
    "bus_lead",
    ["status", "disqualification_reason"],
    [{ when: [q("disqualified"), 'null, ""'], message: "Say why the lead was disqualified" }],
    [
      {
        label: "no reason",
        record: L({ status: "disqualified" }),
        expect: "blocks",
        messages: ["Say why the lead was disqualified"],
      },
      {
        label: "with reason",
        record: L({ status: "disqualified", disqualification_reason: "budget" }),
        expect: "allows",
      },
      { label: "not disqualified", record: L({ status: "working" }), expect: "allows" },
    ]
  ),
  simple(
    "R03",
    "A closed-won deal has a close date",
    "bus_opportunity",
    ["stage", "actual_close_date"],
    [{ when: [q("closed_won"), "null"], message: "A closed-won deal needs its actual close date" }],
    [
      {
        label: "won, no date",
        record: OPP({ stage: "closed_won" }),
        expect: "blocks",
        messages: ["A closed-won deal needs its actual close date"],
      },
      {
        label: "won, dated",
        record: OPP({ stage: "closed_won", actual_close_date: "2031-01-02" }),
        expect: "allows",
      },
      { label: "open", record: OPP({ stage: "proposal" }), expect: "allows" },
    ]
  ),
  simple(
    "R04",
    "Probability stays between 0 and 100",
    "bus_opportunity",
    ["probability"],
    [
      { when: ["> 100"], message: "Probability cannot be over 100" },
      { when: ["< 0"], message: "Probability cannot be negative" },
    ],
    [
      {
        label: "over",
        record: OPP({ probability: 150 }),
        expect: "blocks",
        messages: ["Probability cannot be over 100"],
      },
      {
        label: "under",
        record: OPP({ probability: -5 }),
        expect: "blocks",
        messages: ["Probability cannot be negative"],
      },
      { label: "inside", record: OPP({ probability: 40 }), expect: "allows" },
    ]
  ),
  simple(
    "R05",
    "Discounts over 40 percent need approval",
    "bus_quote",
    ["discount_percent"],
    [{ when: ["> 40"], message: "Discounts over 40 percent need approval" }],
    [
      {
        label: "deep discount",
        record: QUOTE({ discount_percent: 55 }),
        expect: "blocks",
        messages: ["Discounts over 40 percent need approval"],
      },
      { label: "edge", record: QUOTE({ discount_percent: 40 }), expect: "allows" },
      { label: "none", record: QUOTE({}), expect: "allows" },
    ]
  ),
  simple(
    "R06",
    "An approved quote has a total",
    "bus_quote",
    ["status", "grand_total"],
    [{ when: [q("approved"), "<= 0"], message: "An approved quote needs a total above zero" }],
    [
      {
        label: "approved at zero",
        record: QUOTE({ status: "approved", grand_total: 0 }),
        expect: "blocks",
        messages: ["An approved quote needs a total above zero"],
      },
      {
        label: "approved with total",
        record: QUOTE({ status: "approved", grand_total: 10 }),
        expect: "allows",
      },
      { label: "draft at zero", record: QUOTE({ grand_total: 0 }), expect: "allows" },
    ]
  ),
  simple(
    "R07",
    "Strategic accounts are large",
    "bus_account",
    ["tier", "employee_count"],
    [
      {
        when: [q("strategic"), "< 1000"],
        message: "Strategic accounts have at least 1000 employees",
      },
    ],
    [
      {
        label: "small strategic",
        record: ACC({ tier: "strategic", employee_count: 50 }),
        expect: "blocks",
        messages: ["Strategic accounts have at least 1000 employees"],
      },
      {
        label: "large strategic",
        record: ACC({ tier: "strategic", employee_count: 5000 }),
        expect: "allows",
      },
      { label: "small smb", record: ACC({ tier: "smb", employee_count: 50 }), expect: "allows" },
    ]
  ),
  simple(
    "R08",
    "Health score is a percentage",
    "bus_account",
    ["health_score"],
    [{ when: ["> 100"], message: "Health score is out of 100" }],
    [
      {
        label: "too high",
        record: ACC({ health_score: 120 }),
        expect: "blocks",
        messages: ["Health score is out of 100"],
      },
      { label: "fine", record: ACC({ health_score: 80 }), expect: "allows" },
    ]
  ),
  simple(
    "R09",
    "A contact who opted out is not active marketing",
    "bus_contact",
    ["email_opt_out", "status"],
    [{ when: ["true", q("bounced")], message: "An opted-out contact cannot be marked bounced" }],
    [
      {
        label: "opted out, bounced",
        record: CON({ email_opt_out: true, status: "bounced" }),
        expect: "blocks",
        messages: ["An opted-out contact cannot be marked bounced"],
      },
      { label: "opted out, active", record: CON({ email_opt_out: true }), expect: "allows" },
      { label: "bounced only", record: CON({ status: "bounced" }), expect: "allows" },
    ]
  ),
  simple(
    "R10",
    "Critical cases carry a response deadline",
    "bus_support_case",
    ["priority", "first_response_due_at"],
    [{ when: [q("critical"), "null"], message: "A critical case needs a first-response deadline" }],
    [
      {
        label: "no deadline",
        record: CASE({ priority: "critical" }),
        expect: "blocks",
        messages: ["A critical case needs a first-response deadline"],
      },
      {
        label: "with deadline",
        record: CASE({ priority: "critical", first_response_due_at: "2031-01-01T10:00:00Z" }),
        expect: "allows",
      },
      { label: "low priority", record: CASE({}), expect: "allows" },
    ]
  ),
  simple(
    "R11",
    "A resolved case says how",
    "bus_support_case",
    ["status", "resolution_notes"],
    [
      {
        when: [q("resolved"), 'null, ""'],
        message: "Resolution notes are required to resolve a case",
      },
    ],
    [
      {
        label: "resolved without notes",
        record: CASE({ status: "resolved" }),
        expect: "blocks",
        messages: ["Resolution notes are required to resolve a case"],
      },
      {
        label: "resolved with notes",
        record: CASE({ status: "resolved", resolution_notes: "Restarted it" }),
        expect: "allows",
      },
    ]
  ),
  simple(
    "R12",
    "A contract has a term",
    "bus_contract",
    ["term_months"],
    [{ when: ["< 1"], message: "A contract runs for at least one month" }],
    [
      {
        label: "zero term",
        record: CONTRACT({ term_months: 0 }),
        expect: "blocks",
        messages: ["A contract runs for at least one month"],
      },
      { label: "a year", record: CONTRACT({}), expect: "allows" },
    ]
  ),
  simple(
    "R13",
    "Auto-renew needs a notice period",
    "bus_contract",
    ["auto_renew", "renewal_notice_days"],
    [{ when: ["true", "null"], message: "An auto-renewing contract needs a notice period" }],
    [
      {
        label: "auto-renew, no notice",
        record: CONTRACT({ auto_renew: true, renewal_notice_days: undefined }),
        expect: "blocks",
        messages: ["An auto-renewing contract needs a notice period"],
      },
      { label: "auto-renew with notice", record: CONTRACT({ auto_renew: true }), expect: "allows" },
    ]
  ),
  simple(
    "R14",
    "A meeting has a duration",
    "bus_activity",
    ["activity_type", "duration_minutes"],
    [
      { when: [q("meeting"), "null"], message: "A meeting needs a duration" },
      { when: [q("meeting"), "<= 0"], message: "A meeting cannot be zero minutes" },
    ],
    [
      {
        label: "no duration",
        record: ACT({ activity_type: "meeting" }),
        expect: "blocks",
        messages: ["A meeting needs a duration"],
      },
      {
        label: "zero minutes",
        record: ACT({ activity_type: "meeting", duration_minutes: 0 }),
        expect: "blocks",
        messages: ["A meeting cannot be zero minutes"],
      },
      {
        label: "an hour",
        record: ACT({ activity_type: "meeting", duration_minutes: 60 }),
        expect: "allows",
      },
      { label: "a call", record: ACT({}), expect: "allows" },
    ]
  ),
  simple(
    "R15",
    "A referral lead names a job title",
    "bus_lead",
    ["lead_source", "job_title"],
    [{ when: [q("referral"), 'null, ""'], message: "A referral lead needs a job title" }],
    [
      {
        label: "referral, no title",
        record: L({ lead_source: "referral" }),
        expect: "blocks",
        messages: ["A referral lead needs a job title"],
      },
      {
        label: "referral, titled",
        record: L({ lead_source: "referral", job_title: "CFO" }),
        expect: "allows",
      },
      { label: "web, no title", record: L({}), expect: "allows" },
    ]
  ),
  simple(
    "R16",
    "A product has a price",
    "bus_product",
    ["is_active", "list_price"],
    [{ when: ["true", "<= 0"], message: "An active product needs a list price" }],
    [
      {
        label: "active, free",
        record: PROD({ list_price: 0 }),
        expect: "blocks",
        messages: ["An active product needs a list price"],
      },
      {
        label: "inactive, free",
        record: PROD({ list_price: 0, is_active: false }),
        expect: "allows",
      },
      { label: "active, priced", record: PROD({}), expect: "allows" },
    ]
  ),
  simple(
    "R17",
    "Three checks in one table",
    "bus_lead",
    ["score", "employee_count", "annual_revenue"],
    [
      { when: ["> 100", "", ""], message: "Score is out of 100" },
      { when: ["", "< 0", ""], message: "Employee count cannot be negative" },
      { when: ["", "", "< 0"], message: "Revenue cannot be negative" },
    ],
    [
      {
        label: "all three wrong",
        record: L({ score: 500, employee_count: -1, annual_revenue: -9 }),
        expect: "blocks",
        messages: [
          "Score is out of 100",
          "Employee count cannot be negative",
          "Revenue cannot be negative",
        ],
      },
      {
        label: "one wrong",
        record: L({ score: 500 }),
        expect: "blocks",
        messages: ["Score is out of 100"],
      },
      {
        label: "all fine",
        record: L({ score: 50, employee_count: 5, annual_revenue: 10 }),
        expect: "allows",
      },
    ]
  ),
  simple(
    "R18",
    "First match wins: lead source tiers",
    "bus_lead",
    ["lead_source", "score"],
    [
      { when: [q("referral"), "< 10"], message: "Referrals need a score of 10" },
      { when: [q("web"), "< 30"], message: "Web leads need a score of 30" },
      { when: ["", "< 5"], message: "Every lead needs a score of 5" },
    ],
    [
      {
        label: "referral low",
        record: L({ lead_source: "referral", score: 3 }),
        expect: "blocks",
        messages: ["Referrals need a score of 10"],
      },
      {
        label: "web low",
        record: L({ lead_source: "web", score: 20 }),
        expect: "blocks",
        messages: ["Web leads need a score of 30"],
      },
      {
        label: "event low",
        record: L({ lead_source: "event", score: 1 }),
        expect: "blocks",
        messages: ["Every lead needs a score of 5"],
      },
      { label: "web fine", record: L({ lead_source: "web", score: 90 }), expect: "allows" },
    ],
    "CREATE",
    "first"
  ),

  // ── An expression computes a value; a table decides on it ────────────────────
  graphRule(
    "R19",
    "expression → table",
    "Weighted pipeline cap",
    "bus_opportunity",
    "CREATE",
    (m) =>
      chain([
        expression("Weighted", { weighted: "amount * probability / 100" }),
        scoped("bus_opportunity", m, "Weighted cap", ["weighted", "stage"], OUT, [
          {
            when: ["> 5000000", q("prospecting")],
            then: refuse("A prospecting deal cannot weigh over 5,000,000"),
          },
        ]),
      ]),
    [
      {
        label: "huge early deal",
        record: OPP({ amount: 20000000, probability: 50 }),
        expect: "blocks",
        messages: ["A prospecting deal cannot weigh over 5,000,000"],
      },
      { label: "small deal", record: OPP({ amount: 1000, probability: 50 }), expect: "allows" },
      {
        label: "huge but late",
        record: OPP({ amount: 20000000, probability: 50, stage: "negotiation" }),
        expect: "allows",
      },
    ]
  ),
  graphRule(
    "R20",
    "expression → table",
    "Quote totals add up",
    "bus_quote",
    "CREATE",
    (m) =>
      chain([
        expression("Check total", {
          gap: "abs(subtotal - discount_amount + tax_amount - grand_total)",
        }),
        scoped("bus_quote", m, "Totals", ["gap"], OUT, [
          {
            when: ["> 0.01"],
            then: refuse("Subtotal, discount and tax do not add up to the total"),
          },
        ]),
      ]),
    [
      {
        label: "off by ten",
        record: QUOTE({ subtotal: 100, discount_amount: 0, tax_amount: 0, grand_total: 110 }),
        expect: "blocks",
        messages: ["Subtotal, discount and tax do not add up to the total"],
      },
      {
        label: "adds up",
        record: QUOTE({ subtotal: 100, discount_amount: 10, tax_amount: 5, grand_total: 95 }),
        expect: "allows",
      },
    ]
  ),
  graphRule(
    "R21",
    "expression → table",
    "No selling at a loss",
    "bus_product",
    "CREATE",
    (m) =>
      chain([
        expression("Margin", { margin: "list_price - unit_cost" }),
        scoped("bus_product", m, "Margin", ["margin"], OUT, [
          { when: ["< 0"], then: refuse("List price is below cost") },
        ]),
      ]),
    [
      {
        label: "below cost",
        record: PROD({ list_price: 10, unit_cost: 40 }),
        expect: "blocks",
        messages: ["List price is below cost"],
      },
      { label: "above cost", record: PROD({}), expect: "allows" },
    ]
  ),
  graphRule(
    "R22",
    "expression → table",
    "Territory range is the right way round",
    "bus_territory",
    "CREATE",
    (m) =>
      chain([
        expression("Span", { span: "employee_count_ceiling - employee_count_floor" }),
        scoped("bus_territory", m, "Span", ["span"], OUT, [
          { when: ["< 0"], then: refuse("The ceiling is below the floor") },
        ]),
      ]),
    [
      {
        label: "inverted",
        record: TERR({ employee_count_floor: 500, employee_count_ceiling: 100 }),
        expect: "blocks",
        messages: ["The ceiling is below the floor"],
      },
      { label: "ordered", record: TERR({}), expect: "allows" },
    ]
  ),
  graphRule(
    "R23",
    "expression → table",
    "Campaigns stay near budget",
    "bus_campaign",
    "CREATE",
    (m) =>
      chain([
        expression("Overspend", {
          overspend: "actual_cost - budgeted_cost",
          limit: "budgeted_cost * 0.2",
        }),
        scoped("bus_campaign", m, "Budget", ["overspend"], OUT, [
          { when: ["> limit"], then: refuse("Spend is more than 20 percent over budget") },
        ]),
      ]),
    [
      {
        label: "way over",
        record: CAMP({ budgeted_cost: 100, actual_cost: 500 }),
        expect: "blocks",
        messages: ["Spend is more than 20 percent over budget"],
      },
      { label: "within", record: CAMP({ budgeted_cost: 100, actual_cost: 110 }), expect: "allows" },
    ]
  ),
  graphRule(
    "R24",
    "expression → table",
    "Names fit on a badge",
    "bus_lead",
    "CREATE",
    (m) =>
      chain(
        [
          expression("Full name", { fullName: 'first_name + " " + last_name' }),
          scoped("bus_lead", m, "Badge", ["fullName"], OUT, [
            { when: ["len(fullName) > 20"], then: refuse("The name is too long for a badge") },
          ]),
        ],
        [],
        undefined
      ),
    [
      {
        label: "long name",
        record: L({ first_name: "Bartholomew-Maximilian", last_name: "Featherstonehaugh" }),
        expect: "blocks",
        messages: ["The name is too long for a badge"],
      },
      { label: "short name", record: L({}), expect: "allows" },
    ]
  ),
  graphRule(
    "R25",
    "expression → table",
    "Contract value cap",
    "bus_contract",
    "CREATE",
    (m) =>
      chain([
        expression("Total value", { totalValue: "annual_value * term_months / 12" }),
        scoped("bus_contract", m, "Cap", ["totalValue"], OUT, [
          { when: ["> 10000000"], then: refuse("Contracts over 10,000,000 need legal review") },
        ]),
      ]),
    [
      {
        label: "huge",
        record: CONTRACT({ annual_value: 50000000, term_months: 24 }),
        expect: "blocks",
        messages: ["Contracts over 10,000,000 need legal review"],
      },
      { label: "modest", record: CONTRACT({}), expect: "allows" },
    ]
  ),
  graphRule(
    "R26",
    "expression only",
    "Answer straight from an expression",
    "bus_activity",
    "CREATE",
    (m) =>
      chain([
        expression("Decide", {
          action: `activity_type == "demo" and subject == ${q(m)} and (duration_minutes == null or duration_minutes < 15) ? "validation-error" : ""`,
          message: '"A demo runs for at least 15 minutes"',
        }),
      ]),
    [
      {
        label: "short demo",
        record: ACT({ activity_type: "demo", duration_minutes: 5 }),
        expect: "blocks",
        messages: ["A demo runs for at least 15 minutes"],
      },
      {
        label: "full demo",
        record: ACT({ activity_type: "demo", duration_minutes: 45 }),
        expect: "allows",
      },
      { label: "a note", record: ACT({ activity_type: "note" }), expect: "allows" },
    ]
  ),

  // ── A function holds the logic a table cannot ───────────────────────────────
  graphRule(
    "R27",
    "function → table",
    "Lead fit tier",
    "bus_lead",
    "CREATE",
    (m) =>
      chain([
        fn(
          "Fit",
          `  const size = Number(input.employee_count ?? 0);\n  const revenue = Number(input.annual_revenue ?? 0);\n  const points = (size >= 500 ? 2 : size >= 50 ? 1 : 0) + (revenue >= 1000000 ? 2 : revenue >= 100000 ? 1 : 0);\n  return { ...input, fit: points >= 3 ? "high" : points >= 1 ? "medium" : "low" };`
        ),
        scoped("bus_lead", m, "Fit check", ["fit", "rating"], OUT, [
          { when: [q("low"), q("hot")], then: refuse("A low-fit lead cannot be rated hot") },
        ]),
      ]),
    [
      {
        label: "tiny and hot",
        record: L({ rating: "hot", employee_count: 3, annual_revenue: 10 }),
        expect: "blocks",
        messages: ["A low-fit lead cannot be rated hot"],
      },
      {
        label: "big and hot",
        record: L({ rating: "hot", employee_count: 900, annual_revenue: 5000000 }),
        expect: "allows",
      },
      {
        label: "tiny and cold",
        record: L({ rating: "cold", employee_count: 3, annual_revenue: 10 }),
        expect: "allows",
      },
    ]
  ),
  graphRule(
    "R28",
    "function only",
    "Website addresses are real",
    "bus_account",
    "CREATE",
    (m) =>
      chain([
        fn(
          "Website",
          `  ${only("bus_account", m)}\n  const site = String(input.website ?? "");\n  if (site && !/^https?:\\/\\/[^ ]+\\.[a-z]{2,}/i.test(site)) {\n    return { action: "validation-error", message: "The website must start with http:// or https://" };\n  }\n  return {};`
        ),
      ]),
    [
      {
        label: "bad url",
        record: ACC({ website: "example dot com" }),
        expect: "blocks",
        messages: ["The website must start with http:// or https://"],
      },
      { label: "good url", record: ACC({ website: "https://example.com" }), expect: "allows" },
      { label: "no url", record: ACC({}), expect: "allows" },
    ]
  ),
  graphRule(
    "R29",
    "function only",
    "No throwaway email domains",
    "bus_contact",
    "CREATE",
    (m) =>
      chain([
        fn(
          "Domain",
          `  ${only("bus_contact", m)}\n  const domain = String(input.email ?? "").split("@")[1]?.toLowerCase();\n  const blocked = ["mailinator.com", "guerrillamail.com", "10minutemail.com"];\n  if (domain && blocked.includes(domain)) return { action: "validation-error", message: "Throwaway email addresses are not accepted" };\n  return {};`
        ),
      ]),
    [
      {
        label: "mailinator",
        record: CON({ email: "x@mailinator.com" }),
        expect: "blocks",
        messages: ["Throwaway email addresses are not accepted"],
      },
      { label: "real", record: CON({}), expect: "allows" },
    ]
  ),
  graphRule(
    "R30",
    "function → table",
    "Close date is in the future",
    "bus_opportunity",
    "CREATE",
    (m) =>
      chain([
        fn(
          "Days out",
          `  const when = input.expected_close_date ? new Date(input.expected_close_date).getTime() : null;\n  return { ...input, daysOut: when === null ? null : Math.round((when - Date.now()) / 86400000) };`
        ),
        scoped("bus_opportunity", m, "Open deal in the past", ["daysOut", "stage"], OUT, [
          {
            when: ["< 0", q("prospecting")],
            then: refuse("An open deal cannot close in the past"),
          },
          { when: ["< 0", q("proposal")], then: refuse("An open deal cannot close in the past") },
        ]),
      ]),
    [
      {
        label: "past, prospecting",
        record: OPP({ expected_close_date: "2001-01-01" }),
        expect: "blocks",
        messages: ["An open deal cannot close in the past"],
      },
      { label: "future", record: OPP({}), expect: "allows" },
      {
        label: "past, won",
        record: OPP({
          expected_close_date: "2001-01-01",
          stage: "closed_won",
          actual_close_date: "2001-01-02",
        }),
        expect: "allows",
      },
    ]
  ),
  graphRule(
    "R31",
    "function only",
    "Quote numbers follow the pattern",
    "bus_quote",
    "CREATE",
    (m) =>
      chain([
        fn(
          "Pattern",
          `  ${only("bus_quote", m)}\n  const n = input.quote_number;\n  if (n && !/^Q-\\d{4,}$/.test(String(n))) return { action: "validation-error", message: "Quote numbers look like Q-1234" };\n  return {};`
        ),
      ]),
    [
      {
        label: "bad number",
        record: QUOTE({ quote_number: "quote 7" }),
        expect: "blocks",
        messages: ["Quote numbers look like Q-1234"],
      },
      { label: "good number", record: QUOTE({ quote_number: "Q-{U}" }), expect: "allows" },
    ]
  ),
  graphRule(
    "R32",
    "function only",
    "A contract ends after it starts",
    "bus_contract",
    "CREATE",
    (m) =>
      chain([
        fn(
          "Dates",
          `  ${only("bus_contract", m)}\n  if (input.start_date && input.end_date && new Date(input.end_date) <= new Date(input.start_date)) {\n    return { action: "validation-error", message: "The end date must be after the start date" };\n  }\n  return {};`
        ),
      ]),
    [
      {
        label: "backwards",
        record: CONTRACT({ start_date: "2031-06-01", end_date: "2031-01-01" }),
        expect: "blocks",
        messages: ["The end date must be after the start date"],
      },
      { label: "forwards", record: CONTRACT({}), expect: "allows" },
    ]
  ),
  graphRule(
    "R33",
    "function → table",
    "High priority cases carry a resolution deadline",
    "bus_support_case",
    "CREATE",
    (m) =>
      chain([
        fn(
          "Urgency",
          `  const rank = { low: 1, medium: 2, high: 3, critical: 4 }[input.priority] ?? 0;\n  return { ...input, urgency: rank, hasDeadline: Boolean(input.resolution_due_at) };`
        ),
        scoped("bus_support_case", m, "Deadline", ["urgency", "hasDeadline"], OUT, [
          {
            when: [">= 3", "false"],
            then: refuse("High and critical cases need a resolution deadline"),
          },
        ]),
      ]),
    [
      {
        label: "high, no deadline",
        record: CASE({ priority: "high" }),
        expect: "blocks",
        messages: ["High and critical cases need a resolution deadline"],
      },
      {
        label: "high, deadline",
        record: CASE({ priority: "high", resolution_due_at: "2031-01-01T10:00:00Z" }),
        expect: "allows",
      },
      { label: "low", record: CASE({}), expect: "allows" },
    ]
  ),
  graphRule(
    "R34",
    "function only",
    "Campaigns end after they start",
    "bus_campaign",
    "CREATE",
    (m) =>
      chain([
        fn(
          "Window",
          `  ${only("bus_campaign", m)}\n  if (input.start_date && input.end_date && input.end_date < input.start_date) return { action: "validation-error", message: "A campaign cannot end before it starts" };\n  return {};`
        ),
      ]),
    [
      {
        label: "ends first",
        record: CAMP({ start_date: "2031-05-01", end_date: "2031-01-01" }),
        expect: "blocks",
        messages: ["A campaign cannot end before it starts"],
      },
      { label: "ordered", record: CAMP({}), expect: "allows" },
    ]
  ),
  graphRule(
    "R35",
    "function only",
    "A planned activity has a due time",
    "bus_activity",
    "CREATE",
    (m) =>
      chain([
        fn(
          "Due",
          `  ${only("bus_activity", m)}\n  if (input.status === "planned" && !input.due_at) return { action: "validation-error", message: "A planned activity needs a due time" };\n  return {};`
        ),
      ]),
    [
      {
        label: "no due time",
        record: ACT({}),
        expect: "blocks",
        messages: ["A planned activity needs a due time"],
      },
      { label: "with due time", record: ACT({ due_at: "2031-01-01T09:00:00Z" }), expect: "allows" },
      { label: "completed", record: ACT({ status: "completed" }), expect: "allows" },
    ]
  ),
  graphRule(
    "R36",
    "function only",
    "A lead name is not an email",
    "bus_lead",
    "CREATE",
    (m) =>
      chain([
        fn(
          "Names",
          `  ${only("bus_lead", m)}\n  const bad = [input.first_name, input.last_name].some((n) => String(n ?? "").includes("@"));\n  return bad ? { action: "validation-error", message: "Names do not contain @" } : {};`
        ),
      ]),
    [
      {
        label: "an email as a name",
        record: L({ first_name: "ada@example.com" }),
        expect: "blocks",
        messages: ["Names do not contain @"],
      },
      { label: "a name", record: L({}), expect: "allows" },
    ]
  ),

  // ── A switch sends a record down one branch ─────────────────────────────────
  switchRule(
    "R37",
    "Lead: bar by rating",
    "bus_lead",
    (m) => {
      const sw = switchNode("By rating", ['rating == "hot"', 'rating == "warm"', "true"]);
      const hot = scoped("bus_lead", m, "Hot bar", ["score"], OUT, [
        { when: ["< 70"], then: refuse("Hot leads need a score of 70") },
      ]);
      const warm = scoped("bus_lead", m, "Warm bar", ["score"], OUT, [
        { when: ["< 40"], then: refuse("Warm leads need a score of 40") },
      ]);
      const rest = scoped("bus_lead", m, "Cold bar", ["score"], OUT, [
        { when: ["< 10"], then: refuse("Every lead needs a score of 10") },
      ]);
      return branches(sw, [hot, warm, rest]);
    },
    [
      {
        label: "hot, 60",
        record: L({ rating: "hot", score: 60 }),
        expect: "blocks",
        messages: ["Hot leads need a score of 70"],
      },
      { label: "warm, 60", record: L({ rating: "warm", score: 60 }), expect: "allows" },
      {
        label: "warm, 20",
        record: L({ rating: "warm", score: 20 }),
        expect: "blocks",
        messages: ["Warm leads need a score of 40"],
      },
      {
        label: "cold, 5",
        record: L({ rating: "cold", score: 5 }),
        expect: "blocks",
        messages: ["Every lead needs a score of 10"],
      },
    ]
  ),
  switchRule(
    "R38",
    "Account: what a tier must have",
    "bus_account",
    (m) => {
      const sw = switchNode("By tier", ['tier == "strategic"', 'tier == "enterprise"', "true"]);
      const a = scoped("bus_account", m, "Strategic needs", ["website"], OUT, [
        { when: ['null, ""'], then: refuse("Strategic accounts need a website") },
      ]);
      const b = scoped("bus_account", m, "Enterprise needs", ["phone"], OUT, [
        { when: ['null, ""'], then: refuse("Enterprise accounts need a phone number") },
      ]);
      const c = scoped("bus_account", m, "Others", ["name"], OUT, [
        { when: ['""'], then: refuse("An account needs a name") },
      ]);
      return branches(sw, [a, b, c]);
    },
    [
      {
        label: "strategic, no site",
        record: ACC({ tier: "strategic", employee_count: 5000 }),
        expect: "blocks",
        messages: ["Strategic accounts need a website"],
      },
      {
        label: "enterprise, no phone",
        record: ACC({ tier: "enterprise" }),
        expect: "blocks",
        messages: ["Enterprise accounts need a phone number"],
      },
      {
        label: "enterprise, phone",
        record: ACC({ tier: "enterprise", phone: "555-0100" }),
        expect: "allows",
      },
      { label: "smb", record: ACC({}), expect: "allows" },
    ]
  ),
  switchRule(
    "R39",
    "Opportunity: each closing stage has its own proof",
    "bus_opportunity",
    (m) => {
      const sw = switchNode("By stage", [
        'stage == "closed_lost"',
        'stage == "closed_won"',
        "true",
      ]);
      const lost = scoped("bus_opportunity", m, "Lost needs a reason", ["loss_reason"], OUT, [
        { when: ["null"], then: refuse("A lost deal needs a loss reason") },
      ]);
      const won = scoped("bus_opportunity", m, "Won needs a date", ["actual_close_date"], OUT, [
        { when: ["null"], then: refuse("A won deal needs a close date") },
      ]);
      const open = scoped("bus_opportunity", m, "Open needs a next step", ["next_step"], OUT, [
        { when: ['""'], then: refuse("An open deal needs a next step") },
      ]);
      return branches(sw, [lost, won, open]);
    },
    [
      {
        label: "lost, no reason",
        record: OPP({ stage: "closed_lost" }),
        expect: "blocks",
        messages: ["A lost deal needs a loss reason"],
      },
      {
        label: "lost, reason",
        record: OPP({ stage: "closed_lost", loss_reason: "price" }),
        expect: "allows",
      },
      {
        label: "won, no date",
        record: OPP({ stage: "closed_won" }),
        expect: "blocks",
        messages: ["A won deal needs a close date"],
      },
      {
        label: "open, step",
        record: OPP({ stage: "proposal", next_step: "Call Tuesday" }),
        expect: "allows",
      },
    ]
  ),
  switchRule(
    "R40",
    "Case: the priority decides what is required",
    "bus_support_case",
    (m) => {
      const sw = switchNode("By priority", [
        'priority == "critical"',
        'priority == "high"',
        "true",
      ]);
      const crit = scoped("bus_support_case", m, "Critical", ["description"], OUT, [
        { when: ['null, ""'], then: refuse("A critical case needs a description") },
      ]);
      const high = scoped("bus_support_case", m, "High", ["case_type"], OUT, [
        { when: [q("question")], then: refuse("A high-priority case is not a question") },
      ]);
      const low = scoped("bus_support_case", m, "Rest", ["origin"], OUT, [
        { when: ['""'], then: refuse("A case needs an origin") },
      ]);
      return branches(sw, [crit, high, low]);
    },
    [
      {
        label: "critical, no description",
        record: CASE({ priority: "critical" }),
        expect: "blocks",
        messages: ["A critical case needs a description"],
      },
      {
        label: "critical, described",
        record: CASE({ priority: "critical", description: "Down" }),
        expect: "allows",
      },
      {
        label: "high question",
        record: CASE({ priority: "high", case_type: "question" }),
        expect: "blocks",
        messages: ["A high-priority case is not a question"],
      },
      { label: "low", record: CASE({}), expect: "allows" },
    ]
  ),
  switchRule(
    "R41",
    "Contract: what each status requires",
    "bus_contract",
    (m) => {
      const sw = switchNode("By status", ['status == "active"', 'status == "terminated"', "true"]);
      const active = scoped("bus_contract", m, "Active", ["signed_at"], OUT, [
        { when: ["null"], then: refuse("An active contract is signed") },
      ]);
      const ended = scoped("bus_contract", m, "Terminated", ["end_date"], OUT, [
        { when: ["null"], then: refuse("A terminated contract has an end date") },
      ]);
      const draft = scoped("bus_contract", m, "Draft", ["term_months"], OUT, [
        { when: ["< 1"], then: refuse("A contract has a term") },
      ]);
      return branches(sw, [active, ended, draft]);
    },
    [
      {
        label: "active, unsigned",
        record: CONTRACT({ status: "active" }),
        expect: "blocks",
        messages: ["An active contract is signed"],
      },
      {
        label: "active, signed",
        record: CONTRACT({ status: "active", signed_at: "2031-01-01T00:00:00Z" }),
        expect: "allows",
      },
      {
        label: "draft, no term",
        record: CONTRACT({ term_months: 0 }),
        expect: "blocks",
        messages: ["A contract has a term"],
      },
    ]
  ),
  switchRule(
    "R42",
    "Quote: two branches can both apply",
    "bus_quote",
    (m) => {
      const sw = switchNode(
        "Which checks",
        ["discount_percent > 20", "grand_total > 100000"],
        "collect"
      );
      const disc = scoped("bus_quote", m, "Discount", ["status"], OUT, [
        { when: [q("approved")], then: refuse("A discounted quote cannot skip review") },
      ]);
      const big = scoped("bus_quote", m, "Large", ["status"], OUT, [
        { when: [q("approved")], then: refuse("A large quote cannot skip review") },
      ]);
      return branches(sw, [disc, big]);
    },
    [
      // Branches that both apply merge into one answer, so a refusal is given, but only one message survives.
      {
        label: "both apply",
        record: QUOTE({ status: "approved", discount_percent: 30, grand_total: 500000 }),
        expect: "blocks",
      },
      {
        label: "only discount",
        record: QUOTE({ status: "approved", discount_percent: 30, grand_total: 500 }),
        expect: "blocks",
        messages: ["A discounted quote cannot skip review"],
      },
      {
        label: "neither",
        record: QUOTE({ status: "approved", grand_total: 500 }),
        expect: "allows",
      },
    ]
  ),

  // ── Several steps, chained ──────────────────────────────────────────────────
  graphRule(
    "R43",
    "expression → function → switch → table",
    "Lead routing gate",
    "bus_lead",
    "CREATE",
    (m) => {
      const e = expression("Points", {
        points: "(employee_count ?? 0) / 100 + (annual_revenue ?? 0) / 100000",
      });
      const f = fn(
        "Tier",
        `  const p = Number(input.points ?? 0);\n  return { ...input, tier: p >= 20 ? "gold" : p >= 5 ? "silver" : "bronze" };`
      );
      const sw = switchNode("By tier", ['tier == "gold"', 'tier == "silver"', "true"]);
      const gold = scoped("bus_lead", m, "Gold", ["status"], OUT, [
        { when: [q("disqualified")], then: refuse("Do not disqualify a gold lead") },
      ]);
      const silver = scoped("bus_lead", m, "Silver", ["rating"], OUT, [
        { when: [q("cold")], then: refuse("A silver lead is at least warm") },
      ]);
      const bronze = scoped("bus_lead", m, "Bronze", ["rating"], OUT, [
        { when: [q("hot")], then: refuse("A bronze lead is not hot") },
      ]);
      const graph = branches(sw, [gold, silver, bronze]);
      return prepend(graph, [e, f]);
    },
    [
      {
        label: "gold, disqualified",
        record: L({ employee_count: 5000, annual_revenue: 9000000, status: "disqualified" }),
        expect: "blocks",
        messages: ["Do not disqualify a gold lead"],
      },
      {
        label: "silver, cold",
        record: L({ employee_count: 800, rating: "cold" }),
        expect: "blocks",
        messages: ["A silver lead is at least warm"],
      },
      {
        label: "bronze, hot",
        record: L({ employee_count: 3, rating: "hot" }),
        expect: "blocks",
        messages: ["A bronze lead is not hot"],
      },
      { label: "bronze, warm", record: L({ employee_count: 3 }), expect: "allows" },
    ]
  ),
  graphRule(
    "R44",
    "expression → switch → table",
    "Deal size by stage",
    "bus_opportunity",
    "CREATE",
    (m) => {
      const e = expression("Weighted", { weighted: "amount * probability / 100" });
      const sw = switchNode("Early or late", [
        'stage in ["prospecting", "qualification", "needs_analysis"]',
        "true",
      ]);
      const early = scoped("bus_opportunity", m, "Early", ["weighted"], OUT, [
        { when: ["> 1000000"], then: refuse("An early deal cannot weigh over 1,000,000") },
      ]);
      const late = scoped("bus_opportunity", m, "Late", ["weighted"], OUT, [
        { when: ["> 50000000"], then: refuse("No deal weighs over 50,000,000") },
      ]);
      return prepend(branches(sw, [early, late]), [e]);
    },
    [
      {
        label: "early, heavy",
        record: OPP({ amount: 9000000, probability: 50 }),
        expect: "blocks",
        messages: ["An early deal cannot weigh over 1,000,000"],
      },
      {
        label: "late, heavy",
        record: OPP({ stage: "negotiation", amount: 9000000, probability: 50 }),
        expect: "allows",
      },
      {
        label: "late, absurd",
        record: OPP({ stage: "negotiation", amount: 900000000, probability: 50 }),
        expect: "blocks",
        messages: ["No deal weighs over 50,000,000"],
      },
    ]
  ),
  graphRule(
    "R45",
    "expression → function → table",
    "Quote review score",
    "bus_quote",
    "CREATE",
    (m) => {
      const e = expression("Inputs", { net: "subtotal - discount_amount + tax_amount" });
      const f = fn(
        "Risk",
        `  const net = Number(input.net ?? 0);\n  const deep = Number(input.discount_percent ?? 0) > 25;\n  return { ...input, risk: (deep ? 2 : 0) + (net > 100000 ? 2 : 0) + (input.status === "approved" ? 1 : 0) };`
      );
      const t = scoped("bus_quote", m, "Review", ["risk"], OUT, [
        { when: [">= 4"], then: refuse("High risk: this quote needs a second reviewer") },
        { when: ["3"], then: refuse("Medium risk: add an approval note") },
      ]);
      return chain([e, f, t]);
    },
    [
      {
        label: "high risk",
        record: QUOTE({
          subtotal: 500000,
          discount_percent: 30,
          status: "approved",
          grand_total: 500000,
        }),
        expect: "blocks",
        messages: ["High risk: this quote needs a second reviewer"],
      },
      {
        label: "medium risk",
        record: QUOTE({ subtotal: 500000, status: "approved", grand_total: 500000 }),
        expect: "blocks",
        messages: ["Medium risk: add an approval note"],
      },
      { label: "low risk", record: QUOTE({}), expect: "allows" },
    ]
  ),
  graphRule(
    "R46",
    "function → expression → table",
    "Contact completeness",
    "bus_contact",
    "CREATE",
    (m) => {
      const f = fn(
        "Facts",
        `  const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";\n  return { ...input, phoneCount: [input.phone, input.mobile].filter(has).length, hasTitle: has(input.job_title) };`
      );
      const e = expression("Complete", { complete: "phoneCount > 0 and hasTitle" });
      const t = scoped(
        "bus_contact",
        m,
        "Active contacts are complete",
        ["complete", "status"],
        OUT,
        [
          {
            when: ["false", q("active")],
            then: refuse("An active contact needs a phone number and a job title"),
          },
        ]
      );
      return chain([f, e, t]);
    },
    [
      {
        label: "bare",
        record: CON({}),
        expect: "blocks",
        messages: ["An active contact needs a phone number and a job title"],
      },
      { label: "complete", record: CON({ phone: "555-0100", job_title: "CTO" }), expect: "allows" },
      { label: "inactive and bare", record: CON({ status: "inactive" }), expect: "allows" },
    ]
  ),
  graphRule(
    "R47",
    "switch → expression → table",
    "Case SLA by priority",
    "bus_support_case",
    "CREATE",
    (m) => {
      const sw = switchNode("Urgent?", ['priority in ["high", "critical"]', "true"]);
      const urgent = expression("Urgent hours", { hoursAllowed: "4" });
      const normal = expression("Normal hours", { hoursAllowed: "48" });
      const t1 = scoped("bus_support_case", m, "Urgent SLA", ["hoursAllowed", "status"], OUT, [
        {
          when: ["< 8", q("waiting_on_customer")],
          then: refuse("An urgent case cannot wait on the customer"),
        },
      ]);
      const t2 = scoped("bus_support_case", m, "Normal SLA", ["hoursAllowed", "status"], OUT, [
        { when: ["< 8", q("waiting_on_customer")], then: refuse("never") },
      ]);
      return branchesTo(sw, [
        [urgent, t1],
        [normal, t2],
      ]);
    },
    [
      {
        label: "urgent, waiting",
        record: CASE({ priority: "critical", description: "x", status: "waiting_on_customer" }),
        expect: "blocks",
        messages: ["An urgent case cannot wait on the customer"],
      },
      {
        label: "normal, waiting",
        record: CASE({ status: "waiting_on_customer" }),
        expect: "allows",
      },
      {
        label: "urgent, in progress",
        record: CASE({ priority: "high", status: "in_progress" }),
        expect: "allows",
      },
    ]
  ),
  graphRule(
    "R48",
    "expression → function → switch",
    "Contract renewal gate",
    "bus_contract",
    "CREATE",
    (m) => {
      const e = expression("Months left", { tenure: "term_months" });
      const f = fn(
        "Band",
        `  const t = Number(input.tenure ?? 0);\n  return { ...input, band: t >= 36 ? "long" : t >= 12 ? "standard" : "short" };`
      );
      const sw = switchNode("By band", ['band == "long"', 'band == "short"', "true"]);
      const long = scoped("bus_contract", m, "Long", ["auto_renew"], OUT, [
        { when: ["true"], then: refuse("A multi-year contract is not auto-renewed") },
      ]);
      const short = scoped("bus_contract", m, "Short", ["annual_value"], OUT, [
        { when: ["> 100000"], then: refuse("A short contract cannot be this large") },
      ]);
      const std = scoped("bus_contract", m, "Standard", ["renewal_notice_days"], OUT, [
        { when: ["< 7"], then: refuse("Give at least a week's notice") },
      ]);
      return prepend(branches(sw, [long, short, std]), [e, f]);
    },
    [
      {
        label: "long auto-renew",
        record: CONTRACT({ term_months: 48, auto_renew: true }),
        expect: "blocks",
        messages: ["A multi-year contract is not auto-renewed"],
      },
      {
        label: "short and large",
        record: CONTRACT({ term_months: 6, annual_value: 500000 }),
        expect: "blocks",
        messages: ["A short contract cannot be this large"],
      },
      {
        label: "standard, short notice",
        record: CONTRACT({ renewal_notice_days: 3 }),
        expect: "blocks",
        messages: ["Give at least a week's notice"],
      },
      { label: "standard", record: CONTRACT({}), expect: "allows" },
    ]
  ),
  graphRule(
    "R49",
    "function → switch → table",
    "Account health gate",
    "bus_account",
    "CREATE",
    (m) => {
      const f = fn(
        "Band",
        `  const h = Number(input.health_score ?? 0);\n  return { ...input, band: h >= 70 ? "healthy" : h >= 40 ? "watch" : "at_risk" };`
      );
      const sw = switchNode("By band", ['band == "at_risk"', "true"]);
      const risk = scoped("bus_account", m, "At risk", ["status"], OUT, [
        { when: [q("active")], then: refuse("An at-risk account is put on hold, not left active") },
      ]);
      const ok = scoped("bus_account", m, "Fine", ["name"], OUT, [
        { when: ['""'], then: refuse("never") },
      ]);
      return prepend(branches(sw, [risk, ok]), [f]);
    },
    [
      {
        label: "at risk, active",
        record: ACC({ health_score: 10 }),
        expect: "blocks",
        messages: ["An at-risk account is put on hold, not left active"],
      },
      {
        label: "at risk, on hold",
        record: ACC({ health_score: 10, status: "on_hold" }),
        expect: "allows",
      },
      { label: "healthy", record: ACC({ health_score: 90 }), expect: "allows" },
    ]
  ),
  graphRule(
    "R50",
    "expression → function → table",
    "Campaign return on spend",
    "bus_campaign",
    "CREATE",
    (m) => {
      const e = expression("Return", {
        roi: "budgeted_cost > 0 ? (expected_revenue - budgeted_cost) / budgeted_cost : 0",
      });
      const f = fn(
        "Grade",
        `  const roi = Number(input.roi ?? 0);\n  return { ...input, grade: roi >= 3 ? "A" : roi >= 1 ? "B" : "C" };`
      );
      const t = scoped("bus_campaign", m, "Grade C", ["grade", "status"], OUT, [
        {
          when: [q("C"), q("active")],
          then: refuse("A campaign returning under 1x cannot be activated"),
        },
      ]);
      return chain([e, f, t]);
    },
    [
      {
        label: "poor, active",
        record: CAMP({ status: "active", budgeted_cost: 1000, expected_revenue: 1200 }),
        expect: "blocks",
        messages: ["A campaign returning under 1x cannot be activated"],
      },
      {
        label: "poor, planning",
        record: CAMP({ budgeted_cost: 1000, expected_revenue: 1200 }),
        expect: "allows",
      },
      {
        label: "strong, active",
        record: CAMP({ status: "active", budgeted_cost: 1000, expected_revenue: 9000 }),
        expect: "allows",
      },
    ]
  ),

  // ── A row can change the record instead of refusing it ───────────────────────
  transformRule(
    "R51",
    "Strong warm leads become hot",
    "bus_lead",
    ["rating", "score"],
    [q("warm"), ">= 80"],
    "rating",
    "hot",
    [
      {
        label: "warm and strong",
        record: L({ score: 90 }),
        expect: "transforms",
        becomes: { field: "rating", value: "hot" },
      },
      { label: "warm and weak", record: L({ score: 10 }), expect: "allows" },
    ]
  ),
  transformRule(
    "R52",
    "Small accounts are SMB",
    "bus_account",
    ["employee_count", "tier"],
    ["< 50", q("enterprise")],
    "tier",
    "smb",
    [
      {
        label: "tiny enterprise",
        record: ACC({ tier: "enterprise", employee_count: 5 }),
        expect: "transforms",
        becomes: { field: "tier", value: "smb" },
      },
      {
        label: "big enterprise",
        record: ACC({ tier: "enterprise", employee_count: 900 }),
        expect: "allows",
      },
    ]
  ),
  transformRule(
    "R53",
    "Confident deals are committed",
    "bus_opportunity",
    ["probability", "forecast_category"],
    [">= 90", q("pipeline")],
    "forecast_category",
    "commit",
    [
      {
        label: "90 percent",
        record: OPP({ probability: 95 }),
        expect: "transforms",
        becomes: { field: "forecast_category", value: "commit" },
      },
      { label: "30 percent", record: OPP({ probability: 30 }), expect: "allows" },
    ]
  ),
  transformRule(
    "R54",
    "Discounted quotes are flagged for review",
    "bus_quote",
    ["discount_percent", "status"],
    ["> 20", q("draft")],
    "approval_notes",
    "Needs review",
    [
      {
        label: "discounted draft",
        record: QUOTE({ discount_percent: 25 }),
        expect: "transforms",
        becomes: { field: "approval_notes", value: "Needs review" },
      },
      { label: "plain draft", record: QUOTE({}), expect: "allows" },
    ]
  ),

  // ── Rules on other writes ───────────────────────────────────────────────────
  simple(
    "R55",
    "An active account cannot be deleted",
    "bus_account",
    ["status"],
    [{ when: [q("active")], message: "Put the account on hold before deleting it" }],
    [
      {
        label: "active",
        record: ACC({}),
        expect: "blocks",
        messages: ["Put the account on hold before deleting it"],
      },
      { label: "on hold", record: ACC({ status: "on_hold" }), expect: "allows" },
    ],
    "DELETE"
  ),
  simple(
    "R56",
    "A won deal cannot be deleted",
    "bus_opportunity",
    ["stage"],
    [{ when: [q("closed_won")], message: "A won deal is part of the record" }],
    [
      {
        label: "won",
        record: OPP({ stage: "closed_won", actual_close_date: "2031-01-02" }),
        expect: "blocks",
        messages: ["A won deal is part of the record"],
      },
      { label: "open", record: OPP({}), expect: "allows" },
    ],
    "DELETE"
  ),
  simple(
    "R57",
    "A quote cannot be discounted past 40 percent on an edit",
    "bus_quote",
    ["discount_percent"],
    [{ when: ["> 40"], message: "Edits cannot take a discount past 40 percent" }],
    [
      {
        label: "deepen the discount",
        record: QUOTE({}),
        changes: { discount_percent: 60 },
        expect: "blocks",
        messages: ["Edits cannot take a discount past 40 percent"],
      },
      {
        label: "small change",
        record: QUOTE({}),
        changes: { discount_percent: 10 },
        expect: "allows",
      },
    ],
    "UPDATE"
  ),
  simple(
    "R58",
    "A hot lead keeps a score on edit",
    "bus_lead",
    ["rating", "score"],
    [{ when: [q("hot"), "< 50"], message: "A hot lead needs a score of 50 or more" }],
    [
      {
        label: "heat up a low lead",
        record: L({ score: 10 }),
        changes: { rating: "hot", score: 10 },
        expect: "blocks",
        messages: ["A hot lead needs a score of 50 or more"],
      },
      {
        label: "heat up a good lead",
        record: L({ score: 90 }),
        changes: { rating: "hot", score: 90 },
        expect: "allows",
      },
    ],
    "UPDATE"
  ),
  simple(
    "R59",
    "Closing a case at low satisfaction needs notes",
    "bus_support_case",
    ["satisfaction_score", "resolution_notes"],
    [{ when: ["< 3", 'null, ""'], message: "Explain a low-satisfaction closure" }],
    [
      {
        label: "unhappy, no notes",
        record: CASE({}),
        changes: { satisfaction_score: 1 },
        expect: "blocks",
        messages: ["Explain a low-satisfaction closure"],
      },
      {
        label: "unhappy, notes",
        record: CASE({}),
        changes: { satisfaction_score: 1, resolution_notes: "Refunded" },
        expect: "allows",
      },
    ],
    "UPDATE"
  ),
  simple(
    "R60",
    "Turning on auto-renew needs a notice period",
    "bus_contract",
    ["auto_renew", "renewal_notice_days"],
    [{ when: ["true", "null"], message: "Set a notice period before turning on auto-renew" }],
    [
      {
        label: "auto-renew, no notice",
        record: CONTRACT({ renewal_notice_days: undefined }),
        changes: { auto_renew: true, renewal_notice_days: null },
        expect: "blocks",
        messages: ["Set a notice period before turning on auto-renew"],
      },
      {
        label: "auto-renew, notice",
        record: CONTRACT({}),
        changes: { auto_renew: true },
        expect: "allows",
      },
    ],
    "UPDATE"
  ),
];

// ── Builders used above ───────────────────────────────────────────────────────

function graphRule(
  id: string,
  kind: string,
  title: string,
  entity: string,
  operation: Op,
  build: (marker: string) => Graph,
  cases: Case[]
): RuleSpec {
  return { id, kind, title, entity, operation, build, cases };
}

function switchRule(
  id: string,
  title: string,
  entity: string,
  build: (marker: string) => Graph,
  cases: Case[]
): RuleSpec {
  return { id, kind: "switch → tables", title, entity, operation: "CREATE", build, cases };
}

/** A table that changes a column of the record instead of refusing it. */
function transformRule(
  id: string,
  title: string,
  entity: string,
  inputs: string[],
  cells: string[],
  field: string,
  value: string,
  cases: Case[]
): RuleSpec {
  return {
    id,
    kind: "transform",
    title,
    entity,
    operation: "CREATE",
    build: (m) =>
      chain([
        table(
          title,
          [MARKER_FIELD[entity] as string, ...inputs],
          ["action", "field", "value"],
          [{ when: [q(m), ...cells], then: [`"transform"`, q(field), q(value)] }],
          "collect"
        ),
      ]),
    cases,
  };
}

/** Wire a switch to one node per statement, and each of those to the Response. */
function branches(
  sw: ReturnType<typeof switchNode>,
  targets: Array<Omit<Node, "position">>
): Graph {
  const nodes = wire([
    { id: "in", type: "inputNode", name: "Record" },
    sw,
    ...targets,
    { id: "out", type: "outputNode", name: "Response" },
  ]);
  const edges = [
    edge("in", sw.id),
    ...targets.map((t, i) => edge(sw.id, t.id, sw.statementIds[i])),
    ...targets.map((t) => edge(t.id, "out")),
  ];
  // Spread the branches down the canvas so they do not sit on one another.
  nodes.forEach((n, i) => {
    if (targets.some((t) => t.id === n.id)) n.position = { x: 520, y: 140 * (i - 1) };
    if (n.id === "out") n.position = { x: 820, y: 0 };
  });
  return { nodes, edges };
}

/** Each branch is a short chain of nodes ending at the Response. */
function branchesTo(
  sw: ReturnType<typeof switchNode>,
  paths: Array<Array<Omit<Node, "position">>>
): Graph {
  const nodes = wire([
    { id: "in", type: "inputNode", name: "Record" },
    sw,
    ...paths.flat(),
    { id: "out", type: "outputNode", name: "Response" },
  ]);
  const edges = [edge("in", sw.id)];
  paths.forEach((path, i) => {
    edges.push(edge(sw.id, path[0]!.id, sw.statementIds[i]));
    for (let k = 0; k < path.length - 1; k++) edges.push(edge(path[k]!.id, path[k + 1]!.id));
    edges.push(edge(path[path.length - 1]!.id, "out"));
  });
  nodes.forEach((n, i) => {
    if (n.id === "out") n.position = { x: 1100, y: 0 };
    else if (n.id !== "in" && n.id !== sw.id)
      n.position = { x: 520 + (i % 2) * 260, y: 160 * (i % 3) };
  });
  return { nodes, edges };
}

/** Put nodes between the Record and a graph's first node. */
function prepend(graph: Graph, before: Array<Omit<Node, "position">>): Graph {
  const first = graph.edges.find((e) => e.sourceId === "in");
  if (!first) return graph;
  const placed: Node[] = before.map(
    (n, i) => ({ ...n, position: { x: 200 * (i + 1), y: 0 } }) as Node
  );
  const edges = graph.edges.filter((e) => e !== first);
  const ids = ["in", ...before.map((b) => b.id), first.targetId];
  for (let i = 0; i < ids.length - 1; i++) edges.push(edge(ids[i]!, ids[i + 1]!));
  const shifted = graph.nodes.map((n) =>
    n.id === "in"
      ? n
      : { ...n, position: { x: n.position.x + 200 * before.length, y: n.position.y } }
  );
  return { nodes: [shifted[0]!, ...placed, ...shifted.slice(1)], edges };
}
