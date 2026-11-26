/**
 * Sample rows for a generated browser application.
 *
 * An application that boots with empty tables cannot be looked at. Every list
 * is "No entries", every lookup is an empty dropdown, and the one thing a
 * generated application is for — seeing whether the model was right — needs a
 * person to type twenty records first. So the browser CLI seeds a few rows per
 * entity, and the whole point is that they are *typed* rows rather than
 * `String 1`, `String 2`: the Application Dictionary already decided what each
 * column is, and this reads the same `sys_reference_id` the forms read.
 *
 * | Reference | What lands in the column |
 * |---|---|
 * | `TABLE_DIRECT` | the id of a row already generated for the parent table |
 * | a `%%enum` list | one of that enum's declared values |
 * | `EMAIL` / `PHONE` / `URL` / `COLOR` | a plausible address, number, link, hex |
 * | `AMOUNT` / `INTEGER` | a number scaled to what the column is called |
 * | `DATE` / `DATETIME` | a date near today, ordered so `*_at` follows creation |
 * | `TEXT` / `STRING` | words chosen from the column's own name |
 * | `YES_NO` / `JSON` / `PASSWORD` | a boolean, a small object, a placeholder |
 *
 * **The vocabulary is faker.js.** It used to be nine hand-written arrays — a
 * dozen first names, eight company suffixes, seven sentences — which meant ten
 * rows of a `Customer` table showed the same two or three companies, and adding
 * a flavour meant adding a list. `@faker-js/faker` already carries the corpora,
 * so what stays here is the part faker has no opinion about: *which* generator a
 * column gets. That decision is the file's actual subject, and it is made from
 * the column's reference type first and its name second.
 *
 * faker's `lorem` is used for exactly one thing — free prose in a `text` column
 * — because it is the one place where placeholder text reading as placeholder
 * text is the honest answer. Every other flavour resolves to an English
 * generator (`person`, `company`, `commerce`, `location`, `word`), so a grid of
 * sample rows reads as records rather than as filler.
 *
 * Two properties make the result usable rather than merely present:
 *
 * - **Foreign keys resolve.** Entities are emitted parent-first, and a
 *   `TABLE_DIRECT` column takes an id from the rows already generated for the
 *   table its name resolves to. A lookup that opens on a real record is the
 *   difference between demo data and noise.
 * - **It is deterministic.** faker is re-seeded per column and row from the
 *   caller's seed, so regenerating the same model produces the same rows: a
 *   screenshot stays valid, and a diff of two generated applications shows what
 *   the model changed rather than what the random number generator did. Seeding
 *   *per column* rather than once per run is what keeps that stable when a
 *   column is added — the other columns' streams do not shift under it.
 */

import { ReferenceType } from "@appwithai/core/types";
import { base, en, Faker } from "@faker-js/faker";
import type { ParsedModel } from "../../pipeline/generate-application";
import { referenceIdFor, tableNameFor } from "./model-bundle";

export interface SampleDataOptions {
  /** Rows per entity. `0` produces nothing at all. */
  records: number;
  /** Seeds the PRNG. Same seed and same model means the same rows. */
  seed?: string;
  /** How often an OPTIONAL column is left null, 0–1. Defaults to 0.15. */
  nullRate?: number;
}

/** Rows keyed by table name, in the order they must be inserted. */
export type SampleData = Record<string, Array<Record<string, unknown>>>;

/* ------------------------------------------------------------------ random */

/** xmur3 — a string to a 32-bit seed, so a column's stream is its own. */
function hashSeed(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * One column of one row, drawn from a faker seeded for exactly that cell.
 *
 * The instance is shared and re-seeded rather than constructed per cell: faker
 * carries the whole locale, so building one per value would allocate a few
 * hundred kilobytes ten times per entity for no gain. Re-seeding resets the
 * Mersenne Twister, which is the only state a draw depends on.
 */
class Draw {
  readonly faker: Faker;

  constructor(faker: Faker, key: string) {
    faker.seed(hashSeed(key));
    this.faker = faker;
  }

  float(): number {
    return this.faker.number.float({ min: 0, max: 1 });
  }
  int(min: number, max: number): number {
    return this.faker.number.int({ min, max });
  }
  pick<T>(items: readonly T[]): T {
    return this.faker.helpers.arrayElement(items as T[]);
  }
  chance(probability: number): boolean {
    return this.faker.datatype.boolean({ probability });
  }
  uuid(): string {
    return this.faker.string.uuid();
  }
}

/* ------------------------------------------------------------- vocabulary */

/**
 * The two lists faker has no generator for.
 *
 * `example.com` and its siblings are reserved by RFC 2606 precisely so that
 * sample data cannot reach a real inbox or a real site — faker's own domains are
 * plausible-looking rather than reserved, and an email column full of addresses
 * that resolve is a hazard rather than a nicety. Units of measure are simply not
 * a faker module.
 */
const DOMAINS = ["example.com", "example.org", "example.net"];
const UNITS = ["each", "box", "case", "pallet", "kg", "litre"];

/* --------------------------------------------------------------- decisions */

/** What a column's *name* suggests, when its reference type is only `String`. */
type Flavour =
  | "person"
  | "firstName"
  | "lastName"
  | "company"
  | "product"
  | "city"
  | "country"
  | "countryCode"
  | "region"
  | "address"
  | "code"
  | "reference"
  | "title"
  | "jobTitle"
  | "uom"
  | "currency"
  | "word";

function flavourOf(column: string, entity: string): Flavour {
  const n = column.toLowerCase();
  if (/^first_?name$/.test(n)) return "firstName";
  if (/^(last|sur)_?name$/.test(n)) return "lastName";
  if (/^(full_?name|display_?name)$/.test(n)) return "person";
  if (/^(contact|person|customer|client|employee|user|approver|owner)_name$/.test(n))
    return "person";
  if (/^(company|vendor|supplier|organisation|organization|account|insurer)_name$/.test(n))
    return "company";
  /* Before the generic `*_code` rule below, which would otherwise turn
     `currency_code` into `OPP-1060` and `country_code` into `TER-1004` — a
     column whose whole point is a standard code, filled with a made-up one. */
  if (/(^|_)currency(_code)?$/.test(n) || /(^|_)iso_currency$/.test(n)) return "currency";
  if (/^(country_code|iso_country|country_iso)$/.test(n)) return "countryCode";
  if (/^(sku|code|.*_code|barcode)$/.test(n)) return "code";
  if (/(number|reference|ref|invoice_no|po_no)$/.test(n)) return "reference";
  if (/^(job_?title|position|designation)$/.test(n)) return "jobTitle";
  if (/(title|subject|summary|label)$/.test(n)) return "title";
  if (/(city|town)$/.test(n)) return "city";
  if (/(country|nation)$/.test(n)) return "country";
  if (/^(region|state|province|county)$/.test(n)) return "region";
  if (/(address|street|line1|line2)$/.test(n)) return "address";
  if (/^(uom|unit|unit_of_measure|measure)$/.test(n)) return "uom";
  if (n === "name") {
    const e = entity.toLowerCase();
    if (/(vendor|supplier|company|account|customer|client|insurer|organisation)/.test(e))
      return "company";
    if (/(product|item|material|medication|part|sku)/.test(e)) return "product";
    if (/(user|person|staff|employee|contact|patient|owner)/.test(e)) return "person";
    return "title";
  }
  return "word";
}

/** Integer ranges that make a column readable rather than merely numeric. */
function integerRange(column: string): [number, number] {
  const n = column.toLowerCase();
  if (/(quantity|qty|count|units|items|seats|capacity)/.test(n)) return [1, 40];
  if (/(stock|on_hand|inventory|level)/.test(n)) return [0, 500];
  if (/(age|years)/.test(n)) return [1, 60];
  if (/(duration|minutes|days|weeks|months)/.test(n)) return [1, 90];
  if (/(line_?number|seq|sequence|position|order_?no)/.test(n)) return [1, 20];
  if (/(percent|percentage|rate|score)/.test(n)) return [0, 100];
  if (/(attempts|retries|version)/.test(n)) return [1, 5];
  return [1, 100];
}

/** Money scaled by what it is for; a line total is not a unit price. */
function amountRange(column: string): [number, number] {
  const n = column.toLowerCase();
  if (/(unit_?price|price|rate|fee|cost_?per)/.test(n)) return [4, 480];
  if (/(variance|discount|adjustment|tax)/.test(n)) return [0, 90];
  if (/(total|amount|balance|value|subtotal|claimed|settled|paid)/.test(n)) return [50, 9500];
  return [5, 1200];
}

/**
 * Dates land near today, and the column's name decides which side of it: a
 * `due_on` in the past and a `created_at` in the future both read as bugs.
 */
function dayOffsetRange(column: string): [number, number] {
  const n = column.toLowerCase();
  if (/(due|expected|next|valid_until|expiry|expires|scheduled)/.test(n)) return [1, 45];
  if (/(created|opened|registered|joined|started|requested|submitted|captured)/.test(n))
    return [-120, -10];
  /* An invoice dated after the day it fell due reads as a bug in the model
     rather than in the sample data, so the documents that precede a due date
     are pinned behind today. */
  if (/(issued|invoice_date|order_date|ordered|billed|raised)/.test(n)) return [-90, -5];
  if (/(closed|resolved|completed|decided|approved|paid|settled|received|dispatched|sent)/.test(n))
    return [-30, -1];
  if (/(birth|dob)/.test(n)) return [-16000, -700];
  return [-60, 20];
}

function iso(date: Date, withTime: boolean): string {
  return withTime ? date.toISOString() : (date.toISOString().split("T")[0] as string);
}

/* ------------------------------------------------------------------ values */

interface Column {
  name: string;
  columnName: string;
  type: string;
  required: boolean;
  unique: boolean;
  maxLength?: number;
  isForeignKey: boolean;
  enumValues?: string[];
  referenceId: number;
}

/**
 * A string column, in whatever register its name asks for.
 *
 * The flavour decides which faker generator answers; faker decides what it says.
 * Two flavours stay hand-built because they are not vocabulary at all — a code
 * and a reference number are derived from the entity and the row index, which is
 * what makes them unique without a uniqueness check.
 */
function stringValue(draw: Draw, column: string, entity: string, row: number): string {
  const f = draw.faker;
  switch (flavourOf(column, entity)) {
    case "firstName":
      return f.person.firstName();
    case "lastName":
      return f.person.lastName();
    case "person":
      return f.person.fullName();
    case "company":
      return f.company.name();
    case "product":
      return f.commerce.productName();
    case "city":
      return f.location.city();
    case "country":
      return f.location.country();
    case "countryCode":
      return f.location.countryCode();
    case "region":
      return f.location.state();
    case "address":
      return `${f.location.streetAddress()}, ${f.location.city()}`;
    case "code":
      return `${initials(entity)}-${String(1000 + row * 7 + draw.int(0, 6)).slice(0, 4)}`;
    case "reference":
      return `${initials(entity)}${new Date().getFullYear()}-${String(row + 1).padStart(4, "0")}`;
    case "title":
      /* `commerce.productAdjective` rather than `word.adjective`: the general
         list carries determiners, and "Which plain" is not a name. */
      return `${f.commerce.productAdjective()} ${f.word.noun()}`;
    case "jobTitle":
      return f.person.jobTitle();
    case "uom":
      return draw.pick(UNITS);
    case "currency":
      return f.finance.currencyCode();
    default:
      return capitalise(f.word.noun());
  }
}

function initials(entity: string): string {
  const letters = entity.replace(/[^A-Za-z]/g, "");
  const caps = letters.match(/[A-Z]/g);
  return (caps && caps.length >= 2 ? caps.join("") : letters.slice(0, 3)).toUpperCase().slice(0, 4);
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/* ------------------------------------------------------------------- rows */

/** Which table a foreign key points at, by the same rule the generator uses. */
function fkTarget(column: string, personEntity: string | undefined): string | undefined {
  const n = column.toLowerCase();
  if (n.endsWith("_by") || n.endsWith("_by_id")) return personEntity;
  if (PERSON_COLUMNS.has(n)) return personEntity;
  if (!n.endsWith("_id")) return undefined;
  return n.slice(0, -3).replace(/(^|_)([a-z])/g, (_m, _sep, ch: string) => ch.toUpperCase());
}

const PERSON_COLUMNS = new Set([
  "assigned_to",
  "author_id",
  "lab_manager_id",
  "manager_id",
  "owner_id",
  "pi_id",
  "remediation_owner",
  "remediation_owner_id",
  "user_id",
]);

/** Key into the override map: a column is only ambiguous within its entity. */
const overrideKey = (entity: string, column: string) => `${entity}.${column}`.toLowerCase();

/**
 * Where a foreign key points when its *name* points nowhere.
 *
 * Name derivation gets most of them — `patient_id` finds `Patient`. It cannot
 * get the ones named for the role the parent plays rather than for the parent:
 * `ImagingReport.radiologist_id` derives `Radiologist`, an entity nobody
 * declared, while the model says plainly `Doctor ||--o{ ImagingReport`. The
 * checker reports the mismatch as `EML502`, and left unresolved the column is
 * simply never filled — which for a NOT NULL column takes every sample row of
 * that table down with it, one `violates not-null constraint` per row.
 *
 * So where the name resolves to nothing, a *declared parent relationship* is
 * used instead: the first one no other foreign key on the entity already
 * claims. Mirrors `buildFkOverrides` in the NestJS generator, so the browser
 * application and the deployable one fill the same columns.
 */
function buildFkOverrides(
  entities: Array<{ name: string; columns: Column[] }>,
  relationships: Array<{ sourceEntity: string; targetEntity: string }>,
  personEntity: string | undefined
): Map<string, string> {
  const byName = new Map(entities.map((entity) => [entity.name.toLowerCase(), entity.name]));
  const overrides = new Map<string, string>();

  for (const entity of entities) {
    const foreignKeys = entity.columns.filter((column) => column.isForeignKey);

    /* What the other keys on this entity already point at, so two unresolved
       columns cannot both be handed the same parent. */
    const claimed = new Set(
      foreignKeys
        .map((column) => fkTarget(column.columnName, personEntity)?.toLowerCase())
        .filter((name): name is string => !!name && byName.has(name))
    );

    const parents = relationships
      .filter(
        (relationship) => relationship.targetEntity.toLowerCase() === entity.name.toLowerCase()
      )
      .map((relationship) => byName.get(relationship.sourceEntity.toLowerCase()))
      .filter((name): name is string => !!name);

    for (const column of foreignKeys) {
      const derived = fkTarget(column.columnName, personEntity);
      if (derived && byName.has(derived.toLowerCase())) continue;

      const free = parents.find((parent) => !claimed.has(parent.toLowerCase()));
      if (!free) continue;
      overrides.set(overrideKey(entity.name, column.columnName), free);
      claimed.add(free.toLowerCase());
    }
  }

  return overrides;
}

/** The name rule, then the relationship the model drew. */
function resolveTarget(
  entity: string,
  column: Column,
  personEntity: string | undefined,
  overrides: Map<string, string>
): string | undefined {
  return (
    overrides.get(overrideKey(entity, column.columnName)) ??
    fkTarget(column.columnName, personEntity)
  );
}

/**
 * Parents before children, so a foreign key can take an id that exists.
 *
 * Kahn's algorithm over the FK graph, with one deliberate concession: a cycle
 * (two entities pointing at each other, or a self-reference) does not fail the
 * sort. A cycle's members are emitted anyway and their unsatisfiable keys are
 * left null, which is a smaller lie than refusing to generate anything.
 *
 * The concession is made one entity at a time. Dumping every remaining entity
 * in declaration order the moment the sort stalled meant a single cycle poisoned
 * everything *downstream* of it: `User` and `Team` point at each other, so the
 * sort stalled with both pending, and `Compound` — which is not in the cycle and
 * merely wants a `registered_by_id` — was emitted before the users it needed.
 * Its rows came out with a null in a NOT NULL column and every one was skipped,
 * leaving two entities with no sample data at all and only a log line to say so.
 * Breaking the cycle by promoting one member, then resuming the sort, keeps
 * parents-first for everyone who is not actually in a cycle.
 */
function inDependencyOrder(
  entities: Array<{ name: string; columns: Column[] }>,
  personEntity: string | undefined,
  overrides: Map<string, string>
): Array<{ name: string; columns: Column[] }> {
  const byName = new Map(entities.map((entity) => [entity.name, entity]));
  const pending = new Map<string, Set<string>>();

  for (const entity of entities) {
    const parents = new Set<string>();
    for (const column of entity.columns) {
      if (!column.isForeignKey) continue;
      /* The override counts as a dependency too, or the parent it names is not
         guaranteed to have been emitted when the child asks for one of its
         ids — the column would resolve and still come out null. */
      const target = resolveTarget(entity.name, column, personEntity, overrides);
      if (target && target !== entity.name && byName.has(target)) parents.add(target);
    }
    pending.set(entity.name, parents);
  }

  const ordered: Array<{ name: string; columns: Column[] }> = [];
  const done = new Set<string>();

  const emit = (entity: { name: string; columns: Column[] }) => {
    ordered.push(entity);
    done.add(entity.name);
  };

  while (ordered.length < entities.length) {
    let progress = false;
    for (const entity of entities) {
      if (done.has(entity.name)) continue;
      const parents = pending.get(entity.name) as Set<string>;
      if ([...parents].every((parent) => done.has(parent))) {
        emit(entity);
        progress = true;
      }
    }
    if (progress) continue;

    /* Stalled: what is left is a cycle, plus everything downstream of it. Break
       it by promoting a member of the cycle *itself* — never something merely
       waiting on one. `Compound` waits on `User`, and `User` and `Team` wait on
       each other: promoting `Compound` first (it is declared first, and has as
       few outstanding parents as anyone) leaves its mandatory
       `registered_by_id` null, which is the whole failure. Promoting `User`
       costs only its optional `team_id`, and lets both of the others resolve
       properly afterwards. */
    const remaining = entities.filter((entity) => !done.has(entity.name));
    const outstanding = (name: string) =>
      [...(pending.get(name) as Set<string>)].filter((parent) => !done.has(parent));

    /* In a cycle iff the entity is reachable from itself along parents that are
       still outstanding. The graph is one model's entities, so a walk per
       candidate is cheaper than the machinery to avoid it. */
    const inCycle = (start: string) => {
      const seen = new Set<string>();
      const stack = [...outstanding(start)];
      while (stack.length > 0) {
        const name = stack.pop() as string;
        if (name === start) return true;
        if (seen.has(name)) continue;
        seen.add(name);
        stack.push(...outstanding(name));
      }
      return false;
    };

    const candidates = remaining.filter((entity) => inCycle(entity.name));
    /* A stalled sort always has a cycle among what is left, but falling back to
       `remaining` rather than trusting that keeps this a sort, not an assertion. */
    const pool = candidates.length > 0 ? candidates : remaining;
    emit(pool[0] as { name: string; columns: Column[] });
  }
  return ordered;
}

/**
 * Generate the rows.
 *
 * Returns tables in insertion order; the seeder walks them in that order, so
 * the object's key order is load-bearing rather than cosmetic.
 */
export function buildSampleData(parsed: ParsedModel, options: SampleDataOptions): SampleData {
  const count = Math.max(0, Math.floor(options.records));
  if (count === 0 || parsed.entities.length === 0) return {};

  const nullRate = options.nullRate ?? 0.15;
  const salt = options.seed ?? "appwithai";
  /* One faker for the whole run, re-seeded per cell by `Draw`. Constructing
     it here rather than at module scope keeps two concurrent calls — the CLI
     generating twice, a test table-driving the seed — off each other's
     stream. */
  /* `[en, base]` rather than `en` alone: the English locale does not carry
     every corpus, and `location.countryCode` threw outright — a generated
     application refusing to compile because a column was called
     `country_code`. `base` is the fallback faker's own preset composes. */
  const faker = new Faker({ locale: [en, base] });

  const entities = parsed.entities.map((entity) => ({
    name: entity.name,
    table: tableNameFor(entity),
    primaryKey: entity.primaryKey || "id",
    columns: entity.attributes.map((attribute) => ({
      name: attribute.name,
      columnName: attribute.name,
      type: attribute.type,
      required: !!attribute.required,
      unique: !!attribute.unique,
      maxLength: attribute.maxLength,
      isForeignKey: !!attribute.isForeignKey,
      enumValues: attribute.enumValues,
      /* The same call the dictionary makes, so a column's sample value and its
         form control are decided by one rule rather than two that can drift. */
      referenceId: referenceIdFor(attribute, attribute.name === (entity.primaryKey || "id")),
    })) as Column[],
  }));

  /* The entity person-role columns resolve to: `User` when the model declares
     one, otherwise whichever entity looks like the actor table. Without one,
     `approved_by_id` simply stays null rather than pointing at a stranger. */
  const personEntity =
    entities.find((entity) => entity.name === "User")?.name ??
    entities.find((entity) => /^(user|staff|employee|person|account)s?$/i.test(entity.name))?.name;

  const fkOverrides = buildFkOverrides(entities, parsed.relationships ?? [], personEntity);
  const declared = new Set(entities.map((entity) => entity.name));

  const ids = new Map<string, string[]>();
  const data: SampleData = {};

  for (const entity of inDependencyOrder(entities, personEntity, fkOverrides)) {
    const full = entities.find((candidate) => candidate.name === entity.name);
    if (!full) continue;
    const rows: Array<Record<string, unknown>> = [];
    const generatedIds: string[] = [];
    const claimedFks = new Map<string, Set<string>>();

    for (let row = 0; row < count; row++) {
      const record: Record<string, unknown> = {};
      for (const column of full.columns) {
        const draw = new Draw(faker, `${salt}:${full.name}:${column.columnName}:${row}`);
        const isPrimary = column.columnName === full.primaryKey || column.columnName === "id";

        if (isPrimary) {
          const id = draw.uuid();
          record[column.columnName] = id;
          generatedIds.push(id);
          continue;
        }

        /* An OPTIONAL column that is sometimes empty is what makes a generated
           screen look like a real one — but a foreign key the form needs is
           never dropped for the sake of variety. */
        if (!column.required && !column.isForeignKey && draw.chance(nullRate)) {
          record[column.columnName] = null;
          continue;
        }

        record[column.columnName] = valueFor(column, full.name, row, draw, {
          ids,
          personEntity,
          selfIds: generatedIds,
          entityName: full.name,
          fkOverrides,
          declared,
          claimedFks,
        });
      }
      rows.push(record);
    }

    ids.set(full.name, generatedIds);
    data[full.table] = rows;
  }

  return data;
}

interface ValueContext {
  ids: Map<string, string[]>;
  personEntity: string | undefined;
  selfIds: string[];
  entityName: string;
  fkOverrides: Map<string, string>;
  /** Every entity the model declares, to tell "parent not seeded yet" from "no such parent". */
  declared: Set<string>;
  /** Parent ids a UNIQUE foreign key has already taken, per column. Reset per
      entity, because uniqueness is a property of one table's column. */
  claimedFks: Map<string, Set<string>>;
}

function valueFor(
  column: Column,
  entity: string,
  row: number,
  draw: Draw,
  context: ValueContext
): unknown {
  /* A foreign key takes an id that exists, or nothing. Pointing at a uuid no
     row has would make every lookup in the generated application empty — the
     failure this whole file exists to avoid. */
  if (column.isForeignKey) {
    const target = resolveTarget(
      context.entityName,
      column,
      context.personEntity,
      context.fkOverrides
    );
    const pool =
      target === context.entityName ? context.selfIds.slice(0, row) : context.ids.get(target ?? "");
    if (!pool || pool.length === 0) {
      /* No parent entity at all — `Document.document_type_id` with no
         `DocumentType` (the checker's EML502). A required column cannot be
         null: PostgreSQL refuses every row and the entity gets no sample data.
         A uuid no row has is the smaller problem, and only here: when the
         parent *is* declared but not seeded yet (a cycle), null stays, because
         a uuid there would fail a real foreign key. */
      if (column.required && !(target && context.declared.has(target))) {
        return draw.faker.string.uuid();
      }
      return null;
    }
    /* A UNIQUE foreign key is a one-to-one, so it has to be drawn *without*
       replacement. Drawn with it, two children take the same parent, the second
       insert fails the unique index, and the row is lost without a word — the
       same silent loss the counter in `emailFor` exists to prevent, and the one
       every other column type is already guarded against a few branches below.
       Ten doctors over ten staff came out as nine rows, ten nurses as six. */
    if (column.unique) {
      const claimed = context.claimedFks.get(column.columnName) ?? new Set<string>();
      context.claimedFks.set(column.columnName, claimed);
      const free = pool.filter((id) => !claimed.has(id));
      /* Fewer parents than children: the model cannot have a row here, and a
         duplicate would be dropped on insert anyway. Null says so. */
      if (free.length === 0) return null;
      const picked = draw.pick(free);
      claimed.add(picked);
      return picked;
    }
    return draw.pick(pool);
  }

  if (column.enumValues?.length) return draw.pick(column.enumValues);

  const f = draw.faker;

  switch (column.referenceId) {
    case ReferenceType.EMAIL:
      return emailFor(draw);
    case ReferenceType.PHONE:
      /* `international` rather than faker's default: the national format for
         `en` carries an extension (`(901) 468-8976 x74347`), which reads as a
         parsing accident in a phone column. */
      return f.phone.number({ style: "international" });
    case ReferenceType.URL:
      return `https://www.${draw.pick(DOMAINS)}/${f.lorem.slug(1)}`;
    case ReferenceType.COLOR:
      return f.color.rgb({ format: "hex", casing: "lower" });
    case ReferenceType.PASSWORD:
      return "not-a-real-password";
    default:
      break;
  }

  switch (column.type) {
    case "boolean":
      /* `is_active` reads wrong if half the rows are inactive. */
      return /^(is_|has_|can_)?(active|enabled|available|approved)$/.test(column.columnName)
        ? draw.chance(0.85)
        : draw.chance(0.5);
    case "integer": {
      const [min, max] = integerRange(column.columnName);
      return draw.int(min, max);
    }
    case "decimal": {
      const [min, max] = amountRange(column.columnName);
      return Number((min + draw.float() * (max - min)).toFixed(2));
    }
    case "date":
    case "datetime": {
      const [from, to] = dayOffsetRange(column.columnName);
      const when = new Date();
      when.setUTCDate(when.getUTCDate() + draw.int(from, to));
      when.setUTCHours(draw.int(7, 18), draw.int(0, 59), draw.int(0, 59), 0);
      return iso(when, column.type === "datetime");
    }
    case "json":
      return { source: "sample", note: f.word.noun(), index: row + 1 };
    case "text": {
      /* A `text` column is prose by default — unless its name says otherwise.
         A lorem sentence is a fine note and a poor postal address. */
      const flavour = flavourOf(column.columnName, entity);
      return flavour === "word" || flavour === "title"
        ? f.lorem.sentence()
        : stringValue(draw, column.columnName, entity, row);
    }
    default: {
      const flavour = flavourOf(column.columnName, entity);
      const base = stringValue(draw, column.columnName, entity, row);
      /* Codes and references already carry the row number; everything else
         needs one appending when the column is UNIQUE, or ten rows of
         "Northwind Trading" collide on insert. */
      const selfUnique = flavour === "code" || flavour === "reference";
      const value = column.unique && !selfUnique ? `${base} ${row + 1}` : base;
      return column.maxLength && value.length > column.maxLength
        ? value.slice(0, column.maxLength)
        : value;
    }
  }
}

/**
 * An address at a reserved domain, built rather than asked for.
 *
 * `faker.internet.email` is happy to return `amara_okafor2@example.com`, but it
 * decides on its own when to append digits — and a UNIQUE email column with ten
 * rows and two colliding names fails the insert, silently losing the row. The
 * counter here is part of the address rather than a repair applied afterwards.
 */
function emailFor(draw: Draw): string {
  const f = draw.faker;
  const first = f.person
    .firstName()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  const last = f.person
    .lastName()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return `${first}.${last}.${draw.int(1, 999)}@${draw.pick(DOMAINS)}`;
}
