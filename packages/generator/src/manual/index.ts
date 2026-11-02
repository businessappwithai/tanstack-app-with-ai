/**
 * The generated application's manual, as one HTML page.
 *
 * A generated application explains itself in fragments: a column's help text
 * sits under its control, a rule's decision table is behind an admin screen, a
 * state machine is a diagram nobody navigates to, and the relationship between
 * three entities exists only in the model file. Someone handed the running
 * application has no way to read the *whole* of what it does — which is the one
 * question a person who did not write the model always asks first.
 *
 * So the last thing generation does is write the model back out as prose. Every
 * entity, every field with its type and its help text, the workflow each entity
 * moves through, the rules that fire on it, and who is allowed to see it.
 *
 * ## Why one self-contained file
 *
 * No stylesheet, no script, no font, no image. The manual is served by three
 * different things — a Service Worker in the browser stack, a static directory
 * in the NestJS stack, and a file:// double-click out of the downloaded zip —
 * and the only form that survives all three is a single file with its CSS
 * inline. It is also the form that still opens in five years, which is the
 * point of a manual.
 *
 * ## Why it is generated rather than written
 *
 * A manual maintained by hand describes the application it described when
 * somebody last edited it. This one is derived from the same `ParsedModel` the
 * schema, the dictionary and the guards are derived from, so it cannot describe
 * an entity that does not exist or miss one that does. The cost is that its
 * prose is only as good as the model's `%%entity help:` and `%%field help:`
 * text — which is the argument for writing them, and is why the manual says so
 * where they are missing rather than quietly rendering a blank cell.
 *
 * ## One renderer, both stacks
 *
 * The browser stack writes it into the file map; the NestJS stack writes it into
 * the front end's static directory, which is what puts it in the downloadable
 * zip. Both call this function, so the manual cannot describe one stack's
 * application and ship with the other's.
 */

import type { Entity, EntityAttribute, Relationship } from "@appwithai/core/types";
import { formatDisplayName, ReferenceType } from "@appwithai/core/types";
import { DictionaryGenerator } from "../generators/dictionary.generator";
import { GRID_NOISE, referenceIdFor, tableNameFor } from "../generators/wasm/model-bundle";
import type { ParsedModel } from "../pipeline/generate-application";
import { deriveAccess } from "../rbac/roles";

export interface ManualOptions {
  name: string;
  version: string;
  description: string;
  /** Where the reader signs in, printed with the seeded accounts. */
  adminEmail?: string;
  adminPassword?: string;
  /** Which stack produced this application — the manual says so. */
  stack?: "browser" | "nestjs";
  /** Generation timestamp; supplied so two callers can agree on it. */
  generatedAt?: string;
}

/* ------------------------------------------------------------------ escaping */

/**
 * Everything interpolated goes through this.
 *
 * Entity names, help text and enum values all come from a model file somebody
 * else may have written, and a manual that executes what it was asked to
 * describe is a worse failure than one that renders a stray angle bracket.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `SupportCase` -> `support-case`, for an anchor a reader can read in the URL. */
function slug(value: string): string {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * `support_case` / `SupportCase` -> `Support Case`, from core.
 *
 * This was a third implementation and it lowered acronyms, so the manual told
 * a reader a column "points at Kyc Record" about an entity its own dictionary
 * called KYC Record.
 */
const title = (value: string): string => formatDisplayName(String(value));

/* ------------------------------------------------------- what a field *is* */

/** Reference id -> the words the dictionary uses for it on screen. */
const REFERENCE_NAMES: Record<number, string> = {
  [ReferenceType.STRING]: "Text",
  [ReferenceType.INTEGER]: "Whole number",
  [ReferenceType.AMOUNT]: "Amount",
  [ReferenceType.ID]: "Identifier",
  [ReferenceType.TEXT]: "Long text",
  [ReferenceType.DATE]: "Date",
  [ReferenceType.DATETIME]: "Date and time",
  [ReferenceType.LIST]: "List",
  [ReferenceType.TABLE]: "Table reference",
  [ReferenceType.TABLE_DIRECT]: "Lookup",
  [ReferenceType.YES_NO]: "Yes / No",
  [ReferenceType.URL]: "Web address",
  [ReferenceType.COLOR]: "Colour",
  [ReferenceType.JSON]: "JSON",
  [ReferenceType.PASSWORD]: "Password",
  [ReferenceType.EMAIL]: "Email address",
  [ReferenceType.PHONE]: "Telephone",
};

/**
 * What the reader will actually see in the form, in words.
 *
 * The reference type is the thing that decides the control, so it is what the
 * manual reports — not the SQL type. A reader looking at "Lookup" learns that
 * the field is a dropdown of other records; "Text" tells them it is a box they
 * type into. `string` tells them neither.
 */
function controlFor(attribute: EntityAttribute, referenceId: number): string {
  if (attribute.enumValues?.length) return "Choice";
  return REFERENCE_NAMES[referenceId] ?? "Text";
}

/** `owner_id` -> `Owner`; the parent a lookup points at. */
/**
 * The entity a foreign key points at, as the model spells it.
 *
 * `declared` maps a squashed lower-case name to the real one, because the
 * column cannot be trusted to carry the entity's case: `kyc_record_id`
 * reconstructs to `KycRecord`, and the model said `KYCRecord`. Rebuilding the
 * name from the column is what had the manual telling a reader a field
 * "points at Kyc Record" about an entity its own dictionary called KYC Record.
 */
function referenceTarget(column: string, declared: Map<string, string>): string | null {
  const name = column.toLowerCase();
  if (name.endsWith("_by") || name.endsWith("_by_id")) return "User";
  if (!name.endsWith("_id")) return null;
  const stem = name.slice(0, -3);
  return declared.get(stem.replace(/_/g, "")) ?? title(stem).replace(/\s+/g, "");
}

/** Every entity the model declares, by its name with separators and case removed. */
function declaredNames(model: ParsedModel): Map<string, string> {
  return new Map(
    model.entities.map((entity) => [entity.name.toLowerCase().replace(/_/g, ""), entity.name])
  );
}

/* ------------------------------------------------------------------ sections */

function fieldRows(entity: Entity, declared: Map<string, string>): string {
  const primaryKey = entity.primaryKey || "id";

  return entity.attributes
    .map((attribute) => {
      const isPrimary = attribute.name === primaryKey;
      const referenceId = referenceIdFor(attribute, isPrimary);
      const control = controlFor(attribute, referenceId);

      const constraints: string[] = [];
      if (isPrimary) constraints.push("key");
      if (attribute.required && !isPrimary) constraints.push("required");
      if (attribute.unique) constraints.push("unique");
      if (attribute.maxLength) constraints.push(`max ${attribute.maxLength}`);

      /* A field with no help text gets a dash, not a sentence. The complaint
         belongs once per entity (see below) rather than on every row of a
         seventeen-row table, where it drowns the rows that *are* described. */
      const help = attribute.description
        ? escapeHtml(attribute.description)
        : '<span class="unset">&mdash;</span>';

      const detail: string[] = [];
      if (attribute.enumValues?.length) {
        detail.push(
          `One of: ${attribute.enumValues.map((value) => `<code>${escapeHtml(value)}</code>`).join(", ")}`
        );
      }
      if (attribute.isForeignKey) {
        const target = referenceTarget(attribute.name, declared);
        if (target) detail.push(`Points at <b>${escapeHtml(title(target))}</b>`);
      }

      return `        <tr>
          <td><code>${escapeHtml(attribute.name)}</code></td>
          <td>${escapeHtml(control)}</td>
          <td>${constraints.length ? constraints.map((c) => `<span class="tag">${escapeHtml(c)}</span>`).join(" ") : "&mdash;"}</td>
          <td>${help}${detail.length ? `<div class="detail">${detail.join("<br>")}</div>` : ""}</td>
        </tr>`;
    })
    .join("\n");
}

/**
 * How this entity reads to a person, rather than how it reads to a schema.
 *
 * The model states a cardinality operator; a reader wants a sentence. Which
 * side of the relationship the entity we are describing sits on decides the
 * sentence, so the phrase is built per entity rather than per relationship.
 */
function relationshipPhrase(relationship: Relationship, entityName: string): string {
  const outgoing = relationship.sourceEntity === entityName;
  const other = outgoing ? relationship.targetEntity : relationship.sourceEntity;
  const link = `<a href="#entity-${slug(other)}">${escapeHtml(title(other))}</a>`;

  switch (relationship.cardinality) {
    case "oneToMany":
      return outgoing ? `has many ${link} records` : `belongs to one ${link}`;
    case "manyToOne":
      return outgoing ? `belongs to one ${link}` : `has many ${link} records`;
    case "manyToMany":
      return `is linked to many ${link} records`;
    default:
      return `has one ${link}`;
  }
}

function relationshipsFor(model: ParsedModel, entity: Entity): string {
  const related = model.relationships.filter(
    (relationship) =>
      relationship.sourceEntity === entity.name || relationship.targetEntity === entity.name
  );
  if (related.length === 0) return "";

  const items = related
    .map(
      (relationship) =>
        `<li>Each <b>${escapeHtml(title(entity.name))}</b> ${relationshipPhrase(relationship, entity.name)}.</li>`
    )
    .join("\n          ");

  return `      <h4>Related records</h4>
      <ul class="plain">
          ${items}
      </ul>`;
}

/**
 * The window, the tab and the fields on it — the layer between a column and a
 * screen.
 *
 * A column is where a value is *stored*; a field is where it is *placed*. The
 * running application does not draw the fields table above — it draws
 * `sys_field`, joined to the `sys_tab` it sits on and the `sys_window` that tab
 * belongs to, which is why a field can be hidden or reordered in a live
 * application without regenerating it. A manual that stopped at the columns
 * described the storage and left out the screen.
 *
 * **Derived from `DictionaryGenerator`, never re-derived here.** It is the same
 * call `model-bundle.ts` and the NestJS dictionary generator make, so the window
 * this page names is the window the application actually opens. Working it out
 * again from the entity list would be a second answer to the same question, and
 * the first time the derivation changed the manual would start describing a
 * layout the application does not have.
 */
function screensFor(dictionary: ManualDictionary, entity: Entity): string {
  const layout = dictionary.get(entity.name);
  if (!layout) return "";

  const sectioned = layout.sections.length > 0;
  const rows = layout.fields
    .map(
      (field) =>
        `          <tr>
            <td><code>${escapeHtml(field.column)}</code></td>
            <td>${escapeHtml(field.label)}</td>${
              sectioned
                ? `
            <td>${escapeHtml(field.section ?? "—")}</td>
            <td>${escapeHtml(field.place ?? "—")}</td>`
                : ""
            }
            <td>${field.onForm ? "Yes" : "No"}</td>
            <td>${field.inGrid ? "Yes" : "No"}</td>
            <td>${field.formSeq}</td>
            <td>${field.readOnly ? "Yes" : "No"}</td>
          </tr>`
    )
    .join("\n");

  /* `%%section`: the form's headings and what each is for, before the fields
     placed under them. */
  const sections = sectioned
    ? `
      <p>The form is laid out in ${layout.sections.length} section${layout.sections.length === 1 ? "" : "s"}, each a grid of two columns:</p>
      <ul class="plain">
          ${layout.sections
            .map(
              (section) =>
                `<li><b>${escapeHtml(section.name)}</b>${section.help ? ` &mdash; ${escapeHtml(section.help)}` : ""}</li>`
            )
            .join("\n          ")}
      </ul>`
    : "";

  return `      <h4>Where it appears</h4>
      <p>The application opens this record in the <b>${escapeHtml(layout.window)}</b> window, on the <b>${escapeHtml(layout.tab)}</b> tab. These are its ${layout.fields.length} field${layout.fields.length === 1 ? "" : "s"} &mdash; what the screen draws, in the order it draws them. An administrator can change any of this in Application Dictionary &rarr; Fields without regenerating the application.</p>${sections}
      <table>
        <thead><tr><th>Column</th><th>Label</th>${sectioned ? "<th>Section</th><th>Place</th>" : ""}<th>On the form</th><th>In the list</th><th>Order</th><th>Read only</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>`;
}

/** One entity's screen layout, as the Application Dictionary records it. */
interface ManualLayout {
  window: string;
  tab: string;
  /** The `%%section` groups on this tab, in order. Empty when there are none. */
  sections: Array<{ name: string; help?: string; seqNo: number }>;
  fields: Array<{
    column: string;
    label: string;
    section?: string;
    /** `row 2, left`, `row 3, full width` — where in the section's grid. */
    place?: string;
    onForm: boolean;
    inGrid: boolean;
    formSeq: number;
    readOnly: boolean;
  }>;
}

type ManualDictionary = Map<string, ManualLayout>;

/**
 * Run the dictionary derivation once and index it by entity name.
 *
 * `DictionaryGenerator` links its rows by temporary ids rather than by name —
 * a field names a tab, a tab names a window and a table — so this resolves
 * those once rather than per entity.
 */
function manualDictionary(model: ParsedModel): ManualDictionary {
  const context = new DictionaryGenerator({
    databaseType: "postgresql",
    includeRbac: true,
    randomizeFieldOrder: false,
  }).generateDictionaryContext(model.entities, model.relationships);

  const tableOf = new Map(context.sysTables.map((table) => [table._tempId, table.table_name]));
  const windowOf = new Map(context.sysWindows.map((w) => [w._tempId, w.name]));
  const columnOf = new Map(context.sysColumns.map((c) => [c._tempId, c.column_name]));
  const tabOf = new Map(
    context.sysTabs.map((tab) => [
      tab._tempId,
      {
        name: tab.name,
        window: windowOf.get(tab._windowRef) ?? tab.name,
        table: tableOf.get(tab._tableRef) ?? "",
      },
    ])
  );

  const byTable = new Map<string, ManualLayout>();
  for (const tab of tabOf.values()) {
    if (tab.table && !byTable.has(tab.table)) {
      byTable.set(tab.table, { window: tab.window, tab: tab.name, sections: [], fields: [] });
    }
  }
  const groupOf = new Map(context.sysFieldGroups.map((group) => [group._tempId, group]));
  for (const group of context.sysFieldGroups) {
    const tab = group._tabRef ? tabOf.get(group._tabRef) : undefined;
    const layout = tab?.table ? byTable.get(tab.table) : undefined;
    layout?.sections.push({
      name: group.name,
      help: group.description,
      seqNo: group.seq_no ?? 0,
    });
  }
  for (const field of context.sysFields) {
    const tab = tabOf.get(field._tabRef);
    if (!tab?.table) continue;
    const layout = byTable.get(tab.table);
    if (!layout) continue;
    const column = columnOf.get(field._columnRef) ?? "";
    const group = field._groupRef ? groupOf.get(field._groupRef) : undefined;
    layout.fields.push({
      column,
      label: field.name,
      section: group?.name,
      place: group
        ? field.column_span === 2
          ? "full width"
          : field.is_same_line
            ? "beside the field before it"
            : "starts a row"
        : undefined,
      onForm: field.is_displayed !== false,
      /* `DictionaryGenerator` marks every column grid-visible and each consumer
         narrows it — the browser stack through `isNoise`, the NestJS seed
         through its own `GRID_NOISE`. The manual has to narrow it the same way
         or it reports a list with eight audit columns the application does not
         draw. Same set, imported rather than restated. */
      inGrid: field.is_displayed_grid !== false && !GRID_NOISE.has(column),
      formSeq: field.seq_no ?? 0,
      readOnly: !!field.is_read_only,
    });
  }
  for (const layout of byTable.values()) {
    layout.fields.sort((a, b) => a.formSeq - b.formSeq);
    layout.sections.sort((a, b) => a.seqNo - b.seqNo);
  }

  /* Keyed by entity name for the caller, which holds entities rather than
     table names. */
  const byEntity: ManualDictionary = new Map();
  for (const entity of model.entities) {
    const layout = byTable.get(tableNameFor(entity));
    if (layout) byEntity.set(entity.name, layout);
  }
  return byEntity;
}

function workflowFor(model: ParsedModel, entity: Entity): string {
  const workflows = model.workflows.filter((workflow) => workflow.entity === entity.name);
  if (workflows.length === 0) return "";

  return workflows
    .map((workflow) => {
      const rows = workflow.transitions
        .map(
          (transition) =>
            `          <tr><td><code>${escapeHtml(transition.from)}</code></td><td><code>${escapeHtml(transition.to)}</code></td><td>${transition.trigger ? `<code>${escapeHtml(transition.trigger)}</code>` : "&mdash;"}</td></tr>`
        )
        .join("\n");

      return `      <h4>Lifecycle &mdash; ${escapeHtml(workflow.name)}</h4>
      <p>A record starts at <code>${escapeHtml(workflow.initial ?? "—")}</code>${
        workflow.terminal.length
          ? ` and finishes at ${workflow.terminal.map((state) => `<code>${escapeHtml(state)}</code>`).join(" or ")}`
          : ""
      }. These are the moves it may make, and no others:</p>
      <table>
        <thead><tr><th>From</th><th>To</th><th>Event</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>`;
    })
    .join("\n");
}

function rulesFor(model: ParsedModel, entity: Entity): string {
  const rules = model.rules.filter((rule) => rule.entity === entity.name);
  const hooks = model.hooks.filter((hook) => hook.entity === entity.name);
  const sagas = model.sagas.filter((saga) => saga.entity === entity.name);
  if (rules.length === 0 && hooks.length === 0 && sagas.length === 0) return "";

  const parts: string[] = ["      <h4>What happens when it is written</h4>"];

  if (rules.length > 0) {
    parts.push(`      <table>
        <thead><tr><th>Rule</th><th>Runs on</th><th>Order</th></tr></thead>
        <tbody>
${rules
  .map(
    (rule) =>
      `          <tr><td><code>${escapeHtml(rule.name)}</code></td><td>${escapeHtml(rule.event)} (${escapeHtml(rule.operation)})</td><td>${rule.priority}</td></tr>`
  )
  .join("\n")}
        </tbody>
      </table>`);
  }

  if (hooks.length > 0) {
    parts.push(
      `      <p><b>Handlers:</b> ${hooks
        .map(
          (hook) =>
            `<code>${escapeHtml(hook.type)}</code>${hook.field ? ` on <code>${escapeHtml(hook.field)}</code>` : ""}`
        )
        .join(", ")}</p>`
    );
  }

  if (sagas.length > 0) {
    parts.push(
      `      <p><b>Processes:</b> ${sagas
        .map((saga) => `<a href="#process-${slug(saga.name)}">${escapeHtml(saga.name)}</a>`)
        .join(", ")}</p>`
    );
  }

  return parts.join("\n");
}

function accessFor(
  model: ParsedModel,
  entity: Entity,
  visibility: Record<string, string[]>
): string {
  const readers = visibility[entity.name];
  const rules = model.rbac.operations.filter((rule) => rule.entity === entity.name);
  if (!readers && rules.length === 0) return "";

  const parts: string[] = ["      <h4>Who may use it</h4>"];

  parts.push(
    readers && readers.length > 0
      ? `      <p>Visible to ${readers.map((role) => `<b>${escapeHtml(title(role))}</b>`).join(", ")}, and to the Administrator. Nobody else sees it at all &mdash; it is absent from their menu rather than refused when opened.</p>`
      : "      <p>Visible to every signed-in user; the model places no restriction on reading it.</p>"
  );

  const writes = rules.filter((rule) => rule.operation !== "read");
  if (writes.length > 0) {
    parts.push(`      <table>
        <thead><tr><th>Action</th><th>Permitted to</th></tr></thead>
        <tbody>
${writes
  .map(
    (rule) =>
      `          <tr><td>${escapeHtml(title(rule.operation))}</td><td>${rule.roles.map((role) => escapeHtml(title(role))).join(", ")}</td></tr>`
  )
  .join("\n")}
        </tbody>
      </table>`);
  }

  return parts.join("\n");
}

/* ------------------------------------------------------------------- render */

/**
 * Turn a parsed model into the manual.
 *
 * Pure and dependency-free by design: the browser stack calls it from a bundle
 * inside a tab, so it may not reach a filesystem, a template loader or a
 * markdown library.
 */
export function renderManual(model: ParsedModel, options: ManualOptions): string {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const access = deriveAccess(model.rbac, {
    projectId: slug(options.name) || "app",
    adminEmail: options.adminEmail,
    entities: model.entities.map((entity) => entity.name),
  });

  const categoryOf = new Map<string, string>();
  for (const category of model.categories) {
    for (const name of category.entities) categoryOf.set(name, category.name);
  }

  const entities = [...model.entities].sort((a, b) => a.name.localeCompare(b.name));
  const declared = declaredNames(model);
  /* One derivation for the whole page: the window/tab/field layout every entity
     section reports, taken from the same generator the application's own
     dictionary is built by. */
  const dictionary = manualDictionary(model);

  const contents = `
      <nav class="toc" aria-label="Contents">
        <h2>Contents</h2>
        <ol>
          <li><a href="#overview">What this application is</a></li>
          <li><a href="#signing-in">Signing in, and what each role sees</a></li>
          <li><a href="#entities">The records it keeps</a>
            <ul>
${entities
  .map(
    (entity) =>
      `              <li><a href="#entity-${slug(entity.name)}">${escapeHtml(title(entity.name))}</a></li>`
  )
  .join("\n")}
            </ul>
          </li>
          <li><a href="#concurrent-edits">When two people change the same record</a></li>
${model.rules.length ? '          <li><a href="#rules">The decisions it makes</a></li>\n' : ""}${
  model.sagas.length ? '          <li><a href="#processes">The processes it runs</a></li>\n' : ""
}          <li><a href="#how-it-was-built">How this application was built</a></li>
        </ol>
      </nav>`;

  const entitySections = entities
    .map((entity) => {
      const category = categoryOf.get(entity.name);
      return `    <section id="entity-${slug(entity.name)}" class="entity">
      <h3>${escapeHtml(title(entity.name))}${category ? ` <span class="group">${escapeHtml(category)}</span>` : ""}</h3>
      <p class="lede">${
        entity.description
          ? escapeHtml(entity.description)
          : '<span class="missing">The model gives this entity no description. Add one with <code>%%entity ' +
            escapeHtml(entity.name) +
            " help: …</code>.</span>"
      }</p>
      <p class="meta">Stored as <code>${escapeHtml(tableNameFor(entity))}</code>, keyed by <code>${escapeHtml(entity.primaryKey || "id")}</code>.</p>

      <h4>Its fields</h4>
${
  entity.attributes.some((attribute) => attribute.description)
    ? ""
    : `      <p class="missing">No field here carries help text. Add it with <code>%%field ${escapeHtml(entity.name)}.&lt;field&gt; help: …</code> and it appears in this column and in the application itself.</p>\n`
}      <table>
        <thead><tr><th>Field</th><th>Shown as</th><th></th><th>What it is for</th></tr></thead>
        <tbody>
${fieldRows(entity, declared)}
        </tbody>
      </table>
${[
  screensFor(dictionary, entity),
  relationshipsFor(model, entity),
  workflowFor(model, entity),
  rulesFor(model, entity),
  accessFor(model, entity, access.entityVisibility),
]
  .filter(Boolean)
  .join("\n")}
      <p class="back"><a href="#top">Back to contents</a></p>
    </section>`;
    })
    .join("\n\n");

  const rulesSection = model.rules.length
    ? `  <section id="rules">
    <h2>The decisions it makes</h2>
    <p>Each of these is a decision table the application evaluates when a record is written. A rule that refuses a write refuses it for everyone, including an administrator &mdash; it is a statement about the business, not about permissions.</p>
    <table>
      <thead><tr><th>Rule</th><th>Applies to</th><th>Runs on</th></tr></thead>
      <tbody>
${model.rules
  .map(
    (rule) =>
      `        <tr><td><code>${escapeHtml(rule.name)}</code></td><td><a href="#entity-${slug(rule.entity)}">${escapeHtml(title(rule.entity))}</a></td><td>${escapeHtml(rule.event)}</td></tr>`
  )
  .join("\n")}
      </tbody>
    </table>
    <p class="back"><a href="#top">Back to contents</a></p>
  </section>`
    : "";

  const processSection = model.sagas.length
    ? `  <section id="processes">
    <h2>The processes it runs</h2>
    <p>A process spans more than one record. Its steps run in order and stop at the first failure.</p>
${model.sagas
  .map(
    (saga) => `    <div id="process-${slug(saga.name)}" class="process">
      <h3>${escapeHtml(saga.name)}</h3>
      <p class="meta">On <a href="#entity-${slug(saga.entity)}">${escapeHtml(title(saga.entity))}</a>, ${escapeHtml(saga.trigger)} on ${escapeHtml(saga.operation)}.</p>
      <ol>
${saga.steps.map((step) => `        <li>${escapeHtml(step.label)} <span class="tag">${escapeHtml(step.type)}</span></li>`).join("\n")}
      </ol>
    </div>`
  )
  .join("\n")}
    <p class="back"><a href="#top">Back to contents</a></p>
  </section>`
    : "";

  const accountRows = access.users
    .map(
      (user) =>
        `        <tr><td>${escapeHtml(user.roleName)}</td><td><code>${escapeHtml(user.email)}</code></td><td>${
          user.isAdmin
            ? `all ${model.entities.length}`
            : `${access.entityCounts[user.roleName] ?? 0} of ${model.entities.length}`
        }</td></tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.name)} &mdash; Manual</title>
<style>
/* Inline, and deliberately: this file is opened from a Service Worker, from a
   static directory, and by double-clicking it out of a zip. A stylesheet
   reference survives only the first two. */
:root {
  --bg: #ffffff; --surface: #f7f7f6; --border: #e3e3e0; --text: #17171a;
  --soft: #5f6066; --faint: #8a8b91; --accent: #0d6e6e; --accent-soft: #e6f2f2;
  --warn: #b45309;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #17171a; --surface: #1f1f23; --border: #33333a; --text: #ececee;
    --soft: #a9aab0; --faint: #7e7f86; --accent: #4bb3b3; --accent-soft: #14312f;
    --warn: #e0a355;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.wrap { max-width: 60rem; margin: 0 auto; padding: 40px 24px 96px; }
header.title { border-bottom: 2px solid var(--accent); padding-bottom: 18px; margin-bottom: 8px; }
header.title h1 { margin: 0 0 6px; font-size: 30px; letter-spacing: -0.02em; }
header.title p { margin: 0; color: var(--soft); }
header.title .stamp { margin-top: 10px; font-size: 12.5px; color: var(--faint); }
h2 { font-size: 21px; margin: 44px 0 10px; letter-spacing: -0.01em; }
h3 { font-size: 18px; margin: 34px 0 6px; }
h4 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.07em;
     color: var(--soft); margin: 24px 0 8px; }
p { margin: 0 0 12px; }
a { color: var(--accent); }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 4px; padding: 0.5px 4px;
}
.toc { background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
       padding: 18px 22px; margin: 26px 0 8px; }
.toc h2 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase;
          letter-spacing: 0.07em; color: var(--soft); }
.toc ol { margin: 0; padding-left: 20px; }
.toc ul { margin: 4px 0 8px; padding-left: 18px; list-style: none; }
.toc ul li { font-size: 14px; }
.toc li { margin: 3px 0; }
section { scroll-margin-top: 16px; }
.entity { border-top: 1px solid var(--border); padding-top: 8px; margin-top: 34px; }
.entity .lede { color: var(--text); }
.group { font-size: 12px; font-weight: 500; color: var(--accent);
         background: var(--accent-soft); border-radius: 999px; padding: 2px 9px;
         vertical-align: middle; margin-left: 6px; }
.meta { font-size: 13px; color: var(--faint); }
table { width: 100%; border-collapse: collapse; margin: 6px 0 4px; font-size: 14.5px; display: block; overflow-x: auto; }
thead th { text-align: left; background: var(--surface); color: var(--soft);
           font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;
           padding: 8px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
tbody tr:last-child td { border-bottom: none; }
.tag { display: inline-block; font-size: 11.5px; color: var(--soft);
       background: var(--surface); border: 1px solid var(--border);
       border-radius: 4px; padding: 1px 6px; margin-right: 3px; }
.missing { color: var(--muted); font-style: italic; }
.unset { color: var(--muted); }
.detail { margin-top: 5px; font-size: 13px; color: var(--soft); }
.app-overview { margin: 18px 0; padding: 16px 20px; background: var(--surface); border-left: 4px solid var(--accent); border-radius: 4px; font-size: 15px; line-height: 1.7; }
ul.plain { margin: 4px 0 12px; padding-left: 20px; }
.process { border-left: 3px solid var(--border); padding-left: 16px; margin: 18px 0; }
.back { margin-top: 18px; font-size: 13px; }
footer { margin-top: 56px; padding-top: 18px; border-top: 1px solid var(--border);
         color: var(--faint); font-size: 13px; }
@media print {
  .toc, .back { break-inside: avoid; }
  a { color: inherit; text-decoration: none; }
}
</style>
</head>
<body>
<div class="wrap" id="top">

  <header class="title">
    <h1>${escapeHtml(options.name)}</h1>
    <p>${escapeHtml(options.description)}</p>
    <!-- The full ISO instant rather than a friendly date, and deliberately so:
         CI generates this application twice and diffs the two trees to police
         the WASM overlay's footprint, blanking ISO timestamps first. A
         "2026-08-22" would survive that blanking and make the two copies differ
         whenever the pair of runs straddles midnight. -->
    <div class="stamp">Manual for version ${escapeHtml(options.version)} &middot; generated <time datetime="${escapeHtml(generatedAt)}">${escapeHtml(generatedAt)}</time></div>
  </header>
${contents}

  <section id="overview">
    <h2>What this application is</h2>
${options.description && options.description !== "Generated application" ? `    <div class="app-overview"><p>${escapeHtml(options.description)}</p></div>\n` : ""}    <p>${escapeHtml(options.name)} keeps ${model.entities.length} kinds of record${model.entities.length === 1 ? "" : "s"}${
    model.categories.length ? `, grouped into ${model.categories.length} areas of the business` : ""
  }. Every screen in it &mdash; every list, every form, every field label and every dropdown &mdash; is drawn from a description of those records held in the application itself, so the application can be changed by changing that description rather than by editing code.</p>
    <p>This manual is generated from the same description. It cannot describe a record type the application does not have, and it cannot miss one it does.</p>
${
  model.categories.length
    ? `    <table>
      <thead><tr><th>Area</th><th>Records</th></tr></thead>
      <tbody>
${model.categories
  .map(
    (category) =>
      `        <tr><td>${escapeHtml(category.name)}${category.description ? `<div class="detail">${escapeHtml(category.description)}</div>` : ""}</td><td>${category.entities
        .map((name) => `<a href="#entity-${slug(name)}">${escapeHtml(title(name))}</a>`)
        .join(", ")}</td></tr>`
  )
  .join("\n")}
      </tbody>
    </table>`
    : ""
}
    <p class="back"><a href="#top">Back to contents</a></p>
  </section>

  <section id="signing-in">
    <h2>Signing in, and what each role sees</h2>
    <p>The application is seeded with one account per role the model names, so each can be looked at as itself. The Administrator bypasses every restriction, which is what makes it the account to compare the others against.</p>
    <table>
      <thead><tr><th>Role</th><th>Account</th><th>Records it can see</th></tr></thead>
      <tbody>
${accountRows}
      </tbody>
    </table>
${
  options.adminPassword
    ? `    <p>Every seeded account uses the password <code>${escapeHtml(options.adminPassword)}</code>. It is demonstration data &mdash; change it before this application holds anything real.</p>`
    : ""
}
    <p class="back"><a href="#top">Back to contents</a></p>
  </section>

  <section id="entities">
    <h2>The records it keeps</h2>
    <p>One section per record type. For each: what it is, every field it has and what that field is for, the records it connects to, the states it moves through, and who may use it.</p>

${entitySections}
  </section>

  <section id="concurrent-edits">
    <h2>When two people change the same record</h2>
    <p>Every record carries a version number, and every save raises it by one. When you open a record to edit it, the form remembers the version you opened. Saving sends that version back, and the save goes through only if nobody has saved the record since.</p>
    <p>If somebody has, your save is not applied &mdash; neither of you loses a change without seeing it. The ${
      options.stack === "browser" ? "form shows a panel" : "form opens a dialog"
    } listing the fields the other person changed, with their value and yours side by side, and marks the fields you both changed. It offers three choices:</p>
    <table>
      <thead><tr><th>Choice</th><th>What happens</th></tr></thead>
      <tbody>
        <tr><td>Reload their version</td><td>Your unsaved edits are discarded and the form shows the record as it now stands.</td></tr>
        <tr><td>Overwrite with mine</td><td>Your values are saved over theirs. It is checked again against the version you have just been shown, so a third person saving in the meantime is caught the same way.</td></tr>
        <tr><td>Keep editing</td><td>Nothing is saved yet; the form stays open with your edits so you can change them first.</td></tr>
      </tbody>
    </table>
    <p>Two saves of the same version arriving at the same moment cannot both win: exactly one is applied and the other is offered the same three choices.</p>
    <p class="back"><a href="#top">Back to contents</a></p>
  </section>

${rulesSection}

${processSection}

  <section id="how-it-was-built">
    <h2>How this application was built</h2>
    <p>It was generated from a single model file &mdash; a Mermaid document describing the records, the rules and the processes above. The generator read that file and wrote the database schema, the API, the screens and this manual from it.</p>
    <p>The same model produces two applications, and this is the <b>${
      options.stack === "browser"
        ? "browser build</b>: a runtime that boots in a tab with no install and no build step, with PostgreSQL compiled to WebAssembly underneath it"
        : "deployable build</b>: NestJS and TanStack Start source you can read, edit and deploy, with a <code>docker-compose.yml</code> that brings up PostgreSQL, the API and the web front end together"
    }.</p>
    <p>Regenerating from an amended model rewrites all of it, this manual included. Nothing here is maintained by hand, which is why it cannot fall out of step with the application it describes.</p>
    <p class="back"><a href="#top">Back to contents</a></p>
  </section>

  <footer>
    ${escapeHtml(options.name)} ${escapeHtml(options.version)} &middot; ${model.entities.length} record types &middot; ${model.rules.length} rules &middot; ${model.workflows.length + model.sagas.length} processes
  </footer>
</div>
</body>
</html>
`;
}
