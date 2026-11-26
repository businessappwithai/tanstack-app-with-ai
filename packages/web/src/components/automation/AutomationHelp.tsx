/**
 * The help screen for the builder.
 *
 * Written to be read by someone who has the builder open beside it, so every
 * section names what they can see rather than describing an abstraction. The
 * examples use the entities of whatever app this is running in — a generated
 * app's help says "Patient" and "Appointment", not "Order" and "Invoice" —
 * because a help page whose examples do not exist in your app is a help page
 * you have to translate before you can use.
 */

import {
  OPERATORS,
  STEP_GLYPHS,
  STEP_HINTS,
  STEP_LABELS,
  STEP_TYPES,
  TRIGGER_EVENTS,
  TRIGGER_HINTS,
  TRIGGER_LABELS,
} from "@appwithai/editors/lib/automation/model";
import { cn } from "@appwithai/editors/lib/utils";
import { useState } from "react";

export interface HelpExample {
  /** An entity in this app, used through the examples. */
  entity: string;
  /** A numeric field on it, e.g. "total". */
  numericField: string;
  /** A second entity a step could create, e.g. "Invoice". */
  relatedEntity: string;
}

const DEFAULT_EXAMPLE: HelpExample = {
  entity: "Order",
  numericField: "total",
  relatedEntity: "Invoice",
};

type SectionId =
  | "how"
  | "first"
  | "triggers"
  | "checks"
  | "steps"
  | "repeats"
  | "naming"
  | "references"
  | "tables"
  | "testing"
  | "failures";

const SECTIONS: { group: string; items: { id: SectionId; label: string }[] }[] = [
  {
    group: "Start here",
    items: [
      { id: "how", label: "How an automation runs" },
      { id: "first", label: "Build your first one" },
      { id: "triggers", label: "Picking a trigger" },
      { id: "checks", label: "Adding checks" },
      { id: "steps", label: "Adding steps" },
      { id: "repeats", label: "Repeating steps" },
    ],
  },
  {
    group: "Working with values",
    items: [
      { id: "naming", label: "Naming a step's result" },
      { id: "references", label: "Using earlier values" },
      { id: "tables", label: "Rule tables" },
    ],
  },
  {
    group: "Confidence",
    items: [
      { id: "testing", label: "Test runs" },
      { id: "failures", label: "Reading a failure" },
    ],
  },
];

export function AutomationHelp({
  example = DEFAULT_EXAMPLE,
  initialSection = "how",
  onClose,
}: {
  example?: HelpExample;
  initialSection?: SectionId;
  onClose?: () => void;
}) {
  const [section, setSection] = useState<SectionId>(initialSection);

  return (
    <div className="flex h-full min-h-0 flex-1">
      <nav
        aria-label="Help topics"
        className="w-[236px] shrink-0 overflow-y-auto border-r border-border bg-card py-4"
      >
        {SECTIONS.map((group) => (
          <div key={group.group}>
            <h2 className="px-[18px] pb-2 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground first:pt-0">
              {group.group}
            </h2>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                aria-current={section === item.id ? "page" : undefined}
                className={cn(
                  "mx-2 block w-[calc(100%-1rem)] rounded-lg px-2.5 py-1.5 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  section === item.id
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto bg-muted/30 px-8 py-7">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="float-right rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            ✕ Close
          </button>
        ) : null}
        <Section id={section} example={example} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Section({ id, example }: { id: SectionId; example: HelpExample }) {
  switch (id) {
    case "how":
      return <HowItRuns example={example} />;
    case "first":
      return <FirstAutomation example={example} />;
    case "triggers":
      return <Triggers />;
    case "checks":
      return <Checks example={example} />;
    case "steps":
      return <Steps />;
    case "repeats":
      return <Repeats example={example} />;
    case "naming":
      return <Naming example={example} />;
    case "references":
      return <References example={example} />;
    case "tables":
      return <Tables />;
    case "testing":
      return <Testing />;
    case "failures":
      return <Failures />;
    default:
      return null;
  }
}

function H1({ children }: { children: React.ReactNode }) {
  return <h1 className="mb-2 text-[25px] font-bold tracking-tight">{children}</h1>;
}

function Lede({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-6 max-w-[66ch] text-[14.5px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 mt-7 text-[13px] font-bold first:mt-0">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 max-w-[66ch] text-[14px] leading-relaxed">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[12px] text-primary">
      {children}
    </code>
  );
}

function Example({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2.5 rounded-lg border border-border bg-muted/50 px-3 py-2 text-[12px]">
      {children}
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 flex max-w-[70ch] gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3.5 text-[13px] leading-relaxed text-blue-900">
      <span aria-hidden="true" className="text-[15px]">
        💡
      </span>
      <div>{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function HowItRuns({ example }: { example: HelpExample }) {
  const parts = [
    {
      kicker: "When",
      glyph: "⚡",
      tone: "border-amber-200 bg-amber-50 text-amber-700",
      kickerTone: "text-amber-700",
      title: "The trigger",
      body: "The event that starts the run. One per automation: a record type plus what happened to it — created, updated, deleted, or the moment before any of those.",
      example: (
        <>
          When an <b>{example.entity}</b> is <b>created</b>
        </>
      ),
    },
    {
      kicker: "Only if",
      glyph: "◇",
      tone: "border-blue-200 bg-blue-50 text-blue-600",
      kickerTone: "text-blue-600",
      title: "The checks",
      body: "All of them must pass before anything runs. No checks means it always runs. Compare a field to a fixed value, or to another field on the same record.",
      example: (
        <>
          If <b>{`${example.entity}.${example.numericField}`}</b> is greater than <b>1000</b>
        </>
      ),
    },
    {
      kicker: "Then",
      glyph: "▸",
      tone: "border-primary/30 bg-primary/10 text-primary",
      kickerTone: "text-primary",
      title: "The steps",
      body: "What actually happens, in order. Each step that produces something asks you to name it, so the steps below can use that value.",
      example: (
        <>
          Then{" "}
          <b>
            create {/^[aeiou]/i.test(example.relatedEntity) ? "an" : "a"} {example.relatedEntity}
          </b>
        </>
      ),
    },
  ];

  return (
    <>
      <H1>How an automation runs</H1>
      <Lede>
        Every automation is one sentence: <b className="text-foreground">when</b> something happens,{" "}
        <b className="text-foreground">only if</b> some things are true,{" "}
        <b className="text-foreground">then</b> do these things. You build it top to bottom and it
        runs top to bottom. If a step fails, the run stops there and the rest never happen.
      </Lede>

      <div className="mb-6 grid gap-3.5 lg:grid-cols-3">
        {parts.map((p) => (
          <div key={p.kicker} className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2.5 flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "grid h-[26px] w-[26px] place-items-center rounded-md border text-xs",
                  p.tone
                )}
              >
                {p.glyph}
              </span>
              <span
                className={cn("text-[10px] font-bold uppercase tracking-[0.1em]", p.kickerTone)}
              >
                {p.kicker}
              </span>
            </div>
            <h3 className="mb-1.5 text-[14px] font-bold">{p.title}</h3>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">{p.body}</p>
            <Example>{p.example}</Example>
          </div>
        ))}
      </div>

      <H2>The steps you can add</H2>
      <div className="grid gap-2.5 lg:grid-cols-3">
        {STEP_TYPES.map((type) => (
          <div key={type} className="flex gap-2.5 rounded-xl border border-border bg-card p-3">
            <span
              aria-hidden="true"
              className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md border border-primary/30 bg-primary/10 text-xs text-primary"
            >
              {STEP_GLYPHS[type]}
            </span>
            <div>
              <strong className="block text-[12.5px]">{STEP_LABELS[type]}</strong>
              <span className="text-[11.5px] leading-snug text-muted-foreground">
                {STEP_HINTS[type]}
              </span>
            </div>
          </div>
        ))}
      </div>

      <Tip>
        <b>Using a value from an earlier step.</b> Every step that produces something asks you to
        name it. Write that name in double braces further down —{" "}
        <Code>{"{{tier.discount_pct}}"}</Code>, <Code>{"{{invoiceId}}"}</Code>. Only values produced
        above the current step are offered, so a reference can never point at a step that has not
        happened yet.
      </Tip>
    </>
  );
}

function FirstAutomation({ example }: { example: HelpExample }) {
  const steps = [
    {
      title: "Pick what starts it",
      body: (
        <>
          Click the <b>When this happens</b> card and choose a record type and an event. That is the
          only card every automation must have.
        </>
      ),
    },
    {
      title: "Narrow it down, if you need to",
      body: (
        <>
          Press the <b>+</b> under the trigger and add a check. Skip this and the automation runs
          every time the trigger fires, which is often what you want.
        </>
      ),
    },
    {
      title: "Say what should happen",
      body: (
        <>
          Press <b>+</b> again and pick a step. Fill in the panel on the right. Add as many as you
          need; they run in the order you see.
        </>
      ),
    },
    {
      title: "Try it before anyone else does",
      body: (
        <>
          Hit <b>Test run</b>. Each step shows what went in and what came out, right under its own
          settings, so you can see where a wrong value first appears.
        </>
      ),
    },
    {
      title: "Publish",
      body: (
        <>
          Publishing makes it live for real records. Until then it is a draft and never runs.
          Anything still unfinished is listed on the Publish button.
        </>
      ),
    },
  ];

  return (
    <>
      <H1>Build your first one</H1>
      <Lede>
        Five minutes, start to finish. This walks through &ldquo;when {example.entity.toLowerCase()}
        s come in above 1000, raise {/^[aeiou]/i.test(example.relatedEntity) ? "an" : "a"}{" "}
        {example.relatedEntity.toLowerCase()}&rdquo;.
      </Lede>

      <ol className="max-w-[70ch] list-none">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className="relative border-l border-border pb-5 pl-9 last:border-transparent last:pb-0"
          >
            <span className="absolute -left-[13px] top-0 grid h-[26px] w-[26px] place-items-center rounded-full border border-border bg-card text-[12px] font-bold text-muted-foreground">
              {i + 1}
            </span>
            <strong className="mb-1 block text-[15px]">{s.title}</strong>
            <span className="text-[14px] leading-relaxed text-muted-foreground">{s.body}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function Triggers() {
  return (
    <>
      <H1>Picking a trigger</H1>
      <Lede>
        The trigger decides <em>when</em> your automation gets a turn, and whether it can still stop
        what is about to happen.
      </Lede>

      <div className="max-w-[70ch] overflow-hidden rounded-xl border border-border bg-card">
        {TRIGGER_EVENTS.map((ev) => (
          <div key={ev} className="border-b border-border px-4 py-3 last:border-b-0">
            <strong className="text-[13.5px]">is {TRIGGER_LABELS[ev].replace(/^is /, "")}</strong>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {TRIGGER_HINTS[ev]}
            </p>
          </div>
        ))}
      </div>

      <Tip>
        The <b>about to be</b> triggers are the ones that can refuse. If a check fails there, the
        write never happens. The plain triggers run after the write has already landed, so they can
        react but not prevent.
      </Tip>
    </>
  );
}

function Checks({ example }: { example: HelpExample }) {
  return (
    <>
      <H1>Adding checks</H1>
      <Lede>
        A check is a field, a test, and usually a value. Every check must pass for the steps to run.
      </Lede>

      <H2>The tests you can use</H2>
      <div className="max-w-[52ch] overflow-hidden rounded-xl border border-border bg-card">
        {OPERATORS.map((op) => (
          <div
            key={op.id}
            className="flex items-baseline gap-3 border-b border-border px-4 py-2 text-[13px] last:border-b-0"
          >
            <span className="font-semibold">{op.label}</span>
            <span className="ml-auto text-[11.5px] text-muted-foreground">
              {op.arity === 0 ? "no value needed" : "takes a value"}
            </span>
          </div>
        ))}
      </div>

      <H2>Two checks, not one</H2>
      <P>
        Checks are joined with <b>and</b>, never <b>or</b>. To act on either of two cases, build two
        automations. It reads better, and each one then has its own run history so you can see which
        case is actually firing.
      </P>
      <Example>
        If <b>{`${example.entity}.${example.numericField}`}</b> is greater than <b>1000</b> and{" "}
        <b>{`${example.entity}.status`}</b> is <b>confirmed</b>
      </Example>
    </>
  );
}

function Steps() {
  return (
    <>
      <H1>Adding steps</H1>
      <Lede>
        Steps run in the order they appear. Press the <b>+</b> between two cards to add one exactly
        where you want it.
      </Lede>

      <div className="grid max-w-[74ch] gap-2.5">
        {STEP_TYPES.map((type) => (
          <div key={type} className="flex gap-3 rounded-xl border border-border bg-card p-3.5">
            <span
              aria-hidden="true"
              className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-md border border-primary/30 bg-primary/10 text-xs text-primary"
            >
              {STEP_GLYPHS[type]}
            </span>
            <div>
              <strong className="block text-[13.5px]">{STEP_LABELS[type]}</strong>
              <span className="text-[12.5px] leading-relaxed text-muted-foreground">
                {STEP_HINTS[type]}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Repeats({ example }: { example: HelpExample }) {
  return (
    <>
      <H1>Repeating steps</H1>
      <Lede>
        A <b>repeat</b> runs the steps inside it over and over, for as long as a check keeps
        passing. It stops the first time that check fails.
      </Lede>

      <H2>There is no separate &ldquo;break&rdquo; step</H2>
      <P>
        The rule on the repeat <em>is</em> the break. It is re-read before every pass, against the
        record as it stands at that moment — so a step inside the repeat is what eventually ends it.
      </P>
      <Example>
        Repeat while <b>{`${example.entity}.attempts`}</b> is less than <b>3</b> → inside: call the
        service, then set <b>{`${example.entity}.attempts`}</b> to <Code>{"{{L1.iteration}}"}</Code>
      </Example>

      <H2>Something inside must change what the check reads</H2>
      <P>
        If nothing in the repeat writes the field the check looks at, it reads the same every pass
        and the repeat can never end. The builder refuses that before you can publish, naming the
        field.
      </P>

      <H2>You must say when to give up</H2>
      <P>
        Every repeat needs a <b>Give up after</b> number, and there is no default. An automation
        runs inside the save that triggered it, so a repeat that cannot end holds the record open
        rather than spinning harmlessly in the background. Reaching your limit marks the whole run
        failed and names the repeat — which is what you want, because a repeat that gets there is
        wrong.
      </P>
      <P>
        Pick the number that would obviously be too many <em>for this work</em>. A retry that should
        give up after 5 and a clean-up that legitimately runs 800 have nothing in common, so there
        is no sensible shared default to fall back on.
      </P>

      <H2>Counting the passes</H2>
      <P>
        Inside a repeat you can use <Code>{"{{L1.iteration}}"}</Code> — the pass number, counting
        from 1. Useful for recording an attempt count, or for building a value that changes each
        time round.
      </P>
      <P>
        Repeats do not nest, and the steps in one have to sit together. Both keep the ladder
        readable, and keep the cost of a run something you can see rather than work out.
      </P>
    </>
  );
}

function Naming({ example }: { example: HelpExample }) {
  return (
    <>
      <H1>Naming a step&rsquo;s result</H1>
      <Lede>
        Any step that produces something asks &ldquo;save the answer as&rdquo;. The name you give is
        how later steps reach that value.
      </Lede>
      <P>
        Pick a name that says what the value is, not which step made it. <Code>tier</Code> survives
        you inserting a step above it; <Code>step3</Code> does not.
      </P>
      <Example>
        Look up <b>Discount tier</b> → save the answer as <b>tier</b>, then later: set{" "}
        <b>{`${example.entity}.discount`}</b> to <Code>{"{{tier.discount_pct}}"}</Code>
      </Example>
      <P>
        Two steps cannot share a name. If they do, the builder says so and Publish stays disabled
        until you rename one.
      </P>
    </>
  );
}

function References({ example }: { example: HelpExample }) {
  return (
    <>
      <H1>Using earlier values</H1>
      <Lede>Write a value in double braces and it is filled in when the automation runs.</Lede>

      <div className="max-w-[70ch] overflow-hidden rounded-xl border border-border bg-card">
        {[
          {
            ref: `{{${example.entity.toLowerCase()}.${example.numericField}}}`,
            what: `A field on the ${example.entity} that triggered the run`,
          },
          { ref: "{{tier.discount_pct}}", what: "An answer from a rule table step" },
          { ref: "{{invoiceId}}", what: "The id of a record an earlier step created" },
          { ref: "{{response.body}}", what: "What a web service step got back" },
        ].map((r) => (
          <div key={r.ref} className="border-b border-border px-4 py-2.5 last:border-b-0">
            <Code>{r.ref}</Code>
            <span className="ml-2 text-[12.5px] text-muted-foreground">{r.what}</span>
          </div>
        ))}
      </div>

      <Tip>
        Type <Code>{"{{"}</Code> in any value box and the builder lists everything available at that
        point in the run. The list only ever contains values produced above the step you are in, so
        you cannot accidentally reference something that has not happened yet.
      </Tip>
    </>
  );
}

function Tables() {
  return (
    <>
      <H1>Rule tables</H1>
      <Lede>
        A rule table is a decision written out as rows. Use one when the answer depends on a
        combination of things, and you would otherwise be stacking checks.
      </Lede>

      <H2>How a table is read</H2>
      <P>
        Top to bottom. The first row where <b>every</b> check fits is the answer, and the rest are
        never looked at. A blank check means &ldquo;any value&rdquo;.
      </P>

      <H2>Always end with a catch-all</H2>
      <P>
        A row with every check left blank fits anything, so it is the answer when nothing above fit.
        Without one, a table can return nothing and the step quietly produces no value — which is
        much harder to spot later than a wrong number. The coverage check on the table page warns
        you when the catch-all is missing.
      </P>

      <H2>Sharing a table</H2>
      <P>
        A table can be looked up by any number of automations. The table page lists which ones, so
        you can see what a change affects before you publish it.
      </P>
    </>
  );
}

function Testing() {
  return (
    <>
      <H1>Test runs</H1>
      <Lede>
        A test run executes the automation against sample values without touching real records.
      </Lede>
      <P>
        Each step shows what went in and what came out, under that step&rsquo;s own settings. That
        is where a wrong value first becomes visible, and it is usually one step earlier than where
        the error appears.
      </P>
      <P>
        Edit a step after a test run and its result is marked out of date rather than removed, so
        you can still see what it used to do while you change it.
      </P>
      <Tip>
        Publish stays disabled while anything is unfinished. Hover it to see what is left. A draft
        automation never runs against real records, so there is no risk in leaving one half-built.
      </Tip>
    </>
  );
}

function Failures() {
  return (
    <>
      <H1>Reading a failure</H1>
      <Lede>
        When a step fails, the run stops there. Steps after it never ran — they are not skipped,
        they simply never happened.
      </Lede>
      <H2>The usual causes</H2>
      <div className="max-w-[70ch] overflow-hidden rounded-xl border border-border bg-card">
        {[
          {
            t: "A reference points at nothing",
            d: "The step it named produced no value, usually because a rule table matched no row. Add a catch-all row to that table.",
          },
          {
            t: "A required field was left empty",
            d: "A create step needs every required field on that record type. The step's panel lists which are missing.",
          },
          {
            t: "A web service did not answer",
            d: "The call timed out or returned an error status. The response is shown in full under that step.",
          },
          {
            t: "A check compared different kinds of value",
            d: 'Comparing text to a number never matches. "1000" and 1000 are not the same thing.',
          },
        ].map((c) => (
          <div key={c.t} className="border-b border-border px-4 py-3 last:border-b-0">
            <strong className="text-[13.5px]">{c.t}</strong>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{c.d}</p>
          </div>
        ))}
      </div>
    </>
  );
}
