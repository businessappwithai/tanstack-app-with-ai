/**
 * The generated application described for a chat assistant, as Markdown skills.
 *
 * A chat assistant in front of a generated application (the orchestrator's
 * `assistant/`) reaches records, forms and reports through tools that run as the
 * signed-in person. What it lacks is the application's vocabulary: which field
 * names a shipment ("SHI-0002" is a `reference`), what the form holds and in
 * which sections, which buttons move a record and who may press them, which
 * rules can refuse a change, and which reports are about it. Without that it
 * guesses, and a guess at a record's identity opens the wrong record.
 *
 * So generation writes one skill per entity beside the manual, plus an index.
 *
 * ## The same reading as the manual
 *
 * Every fact here comes from the derivations `renderManual` already uses — the
 * Application Dictionary layout (`manualDictionary`), the read access
 * (`deriveAccess`), the compiled workflows and `%%rbac` move grants, the display
 * value rule (`identifierColumnNames`) and the reporting pack
 * (`buildReportingPack`). None is worked out again here, so the skills cannot
 * describe a form, a button or a report the application does not have.
 *
 * ## What a skill never holds
 *
 * No address (the assistant's model never writes one — it names an object and an
 * id, and the assistant's registry resolves the path after the application has
 * confirmed access), no record data, no credential. A skill is context, not
 * access: the application still answers every read and every write as the
 * person, and the assistant hands a skill only for an entity that person's own
 * session lists.
 *
 * Pure, like the manual: no filesystem, no clock. The browser bundle reaches it.
 */

import type { Entity } from "@appwithai/core/types";
import { identifierColumnNames } from "@appwithai/core/types";
import { LIFECYCLE_DRAFT, moveLabel, REOPEN_EVENT } from "../../../../language/state-field";
import { referenceIdFor, tableNameFor } from "../generators/wasm/model-bundle";
import type { ParsedModel } from "../pipeline/generate-application";
import { deriveAccess } from "../rbac/roles";
import { buildReportingPack, type ReportingPack } from "../reporting/pack";
import { controlFor, declaredNames, manualDictionary, referenceTarget, title } from "./index";

export interface SkillsOptions {
  /** The name the application was generated under (`-n`), as the manual takes it. */
  name: string;
  /** The application database the reporting pack's queries name. */
  databaseName?: string;
}

/** Where the skills live inside a generated application. */
export const SKILLS_DIRECTORY = "assistant-skills";

/** Most reports and charts listed per entity; the rest are reached by searching. */
const REPORTS_PER_ENTITY = 12;

/**
 * One line of model-supplied text, safe inside Markdown.
 *
 * Help text is written by whoever wrote the model. Folded onto one line and with
 * the characters that would open a table cell or a heading neutralised, it reads
 * as what it is — content — wherever the skill is shown.
 */
function text(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "/")
    .replace(/^#+\s*/, "")
    .trim();
}

function code(value: string): string {
  return `\`${String(value).replace(/`/g, "'")}\``;
}

/** The file a skill is written to: the entity's table name, which is the object key the tools take. */
export function skillFileName(entity: Entity): string {
  return `${tableNameFor(entity)}.md`;
}

/** The `bus_` tables each report and chart reads, keyed by table. */
function reportsByTable(pack: ReportingPack | null): Map<string, string[]> {
  const byTable = new Map<string, string[]>();
  if (!pack) return byTable;
  const tablesOf = new Map(pack.queries.map((query) => [query.key, query.tables]));
  const add = (kind: string, name: string, queryKey: string) => {
    for (const table of tablesOf.get(queryKey) ?? []) {
      const list = byTable.get(table) ?? [];
      list.push(`${kind}: ${text(name)}`);
      byTable.set(table, list);
    }
  };
  for (const report of pack.reports) add("Report", report.name, report.queryKey);
  for (const chart of pack.charts) add(`Chart (${chart.chartType})`, chart.name, chart.queryKey);
  return byTable;
}

/**
 * The entity each reference column points at.
 *
 * A column named after its parent (`party_id`) resolves by name. One that is not
 * (`owner_id`, whose parent is `User`) cannot be resolved that way, and the
 * parsed relationship's `foreignKey` is not reliable either (it reads `user_id`
 * there). So a column left unresolved is paired with the parent no other column
 * claimed — when exactly one of each is left. Anything still ambiguous is left
 * unresolved rather than guessed.
 */
function referenceTargets(
  model: ParsedModel,
  entity: Entity,
  declared: Map<string, string>
): Map<string, string> {
  const declaredNames = new Set(declared.values());
  const targets = new Map<string, string>();
  const unresolved: string[] = [];
  for (const attribute of entity.attributes) {
    if (!attribute.isForeignKey) continue;
    const target = referenceTarget(attribute.name, declared);
    if (target && declaredNames.has(target)) targets.set(attribute.name, target);
    else unresolved.push(attribute.name);
  }
  const parents = model.relationships
    .filter(
      (relationship) =>
        (relationship.targetEntity === entity.name && relationship.cardinality === "oneToMany") ||
        (relationship.sourceEntity === entity.name && relationship.cardinality === "manyToOne")
    )
    .map((relationship) =>
      relationship.targetEntity === entity.name ? relationship.sourceEntity : relationship.targetEntity
    );
  const claimed = new Set(targets.values());
  const unclaimed = [...new Set(parents.filter((parent) => !claimed.has(parent)))];
  if (unresolved.length === 1 && unclaimed.length === 1) {
    targets.set(unresolved[0] as string, unclaimed[0] as string);
  }
  return targets;
}

/**
 * Turn a parsed model into the skills: `{ "<file>.md": markdown }`, one per
 * entity plus `index.md`.
 */
export function renderSkills(model: ParsedModel, options: SkillsOptions): Record<string, string> {
  const access = deriveAccess(model.rbac, {
    projectId: options.name || "app",
    entities: model.entities.map((entity) => entity.name),
  });
  const dictionary = manualDictionary(model);
  const declared = declaredNames(model);

  const categoryOf = new Map<string, string>();
  for (const category of model.categories) {
    for (const name of category.entities) categoryOf.set(name, category.name);
  }

  /* Reports are listed by name only: their ids exist on the reporting platform,
     which the assistant searches. A model the pack cannot be built from still
     gets its skills, without the reports. */
  let pack: ReportingPack | null = null;
  try {
    pack = buildReportingPack(model, {
      projectName: options.name || "app",
      databaseName: options.databaseName || options.name || "app",
    });
  } catch {
    pack = null;
  }
  const reports = reportsByTable(pack);

  const files: Record<string, string> = {};
  const indexRows: string[] = [];

  for (const entity of [...model.entities].sort((a, b) => a.name.localeCompare(b.name))) {
    const object = tableNameFor(entity);
    const label = title(entity.name);
    const primaryKey = entity.primaryKey || "id";
    const identifiers = identifierColumnNames(entity.attributes, primaryKey, entity.name);
    const readers = access.entityVisibility[entity.name] ?? [];
    const layout = dictionary.get(entity.name);
    const byColumn = new Map(entity.attributes.map((attribute) => [attribute.name, attribute]));
    const labelOf = new Map((layout?.fields ?? []).map((field) => [field.column, field.label]));
    const fieldLabel = (column: string) => labelOf.get(column) ?? title(column);
    const targets = referenceTargets(model, entity, declared);
    const lines: string[] = [];

    lines.push(
      "---",
      `object: ${object}`,
      `entity: ${entity.name}`,
      `label: ${label}`,
      `category: ${text(categoryOf.get(entity.name) ?? "General")}`,
      `identifiers: [${identifiers.join(", ")}]`,
      `readers: [${readers.join(", ")}]`,
      "---",
      "",
      `# ${label}`,
      "",
      entity.description ? text(entity.description) : "The model gives this record type no description.",
      ""
    );

    /* How a person names one of these — the display value the application itself
       shows in a lookup — is what a search should match on. */
    lines.push("## Finding one");
    if (identifiers.length > 0) {
      lines.push(
        `A ${label} is known by ${identifiers.map((column) => `**${fieldLabel(column)}** (${code(column)})`).join(" and ")}. ` +
          `Search with ${code("search_records")} (recordType ${code(object)}) using that value, then open the match with ${code("open_record")} (object ${code(object)} and the id the search returned).`
      );
    } else {
      lines.push(
        `A ${label} has no naming field; it is shown by its parents. Search with ${code("search_records")} (recordType ${code(object)}) and open the match with ${code("open_record")}.`
      );
    }
    lines.push(
      "If more than one record matches, list them by that value and ask which one is meant. Never guess an id.",
      ""
    );

    /* The form, as the Application Dictionary lays it out. */
    lines.push("## The form");
    if (layout) {
      lines.push(`Opened in the **${text(layout.window)}** window, on the **${text(layout.tab)}** tab.`, "");
      /* Sections in order; then, in a sectioned form, the fields no section
         places (the key, chiefly) under a heading of their own rather than
         dropped. */
      const sectionNames = new Set(layout.sections.map((section) => section.name));
      const sections: Array<{ name: string; help?: string; unplaced?: boolean }> =
        layout.sections.length > 0
          ? [...layout.sections, { name: "Other fields", unplaced: true }]
          : [{ name: "" }];
      for (const section of sections) {
        const fields = layout.fields.filter(
          (field) =>
            field.onForm &&
            (layout.sections.length === 0 ||
              (section.unplaced
                ? !field.section || !sectionNames.has(field.section)
                : field.section === section.name))
        );
        if (fields.length === 0) continue;
        if (section.name) {
          lines.push(`### ${text(section.name)}${section.help ? ` — ${text(section.help)}` : ""}`);
        }
        for (const field of fields) {
          const attribute = byColumn.get(field.column);
          const parts: string[] = [`**${text(field.label)}** (${code(field.column)})`];
          if (attribute) {
            const isPrimary = attribute.name === primaryKey;
            parts.push(controlFor(attribute, referenceIdFor(attribute, isPrimary)));
            if (attribute.required && !isPrimary) parts.push("required");
            if (attribute.unique) parts.push("unique");
            if (attribute.enumValues?.length) {
              parts.push(`one of ${attribute.enumValues.map((value) => code(value)).join(", ")}`);
            }
            if (attribute.isForeignKey) {
              const target = targets.get(attribute.name);
              parts.push(target ? `points at ${title(target)}` : "points at another record (see Related records)");
            }
          }
          if (field.readOnly) parts.push("read only");
          const help = attribute?.description ? ` — ${text(attribute.description)}` : "";
          lines.push(`- ${parts.join(", ")}${help}`);
        }
        lines.push("");
      }
    } else {
      lines.push("No form layout was derived for this record type.", "");
    }

    /* Related records, so the assistant can go from one record to its neighbours. */
    const related = model.relationships.filter(
      (relationship) => relationship.sourceEntity === entity.name || relationship.targetEntity === entity.name
    );
    if (related.length > 0) {
      lines.push("## Related records");
      for (const relationship of related) {
        const outgoing = relationship.sourceEntity === entity.name;
        const other = title(outgoing ? relationship.targetEntity : relationship.sourceEntity);
        const many =
          (relationship.cardinality === "oneToMany" && outgoing) ||
          (relationship.cardinality === "manyToOne" && !outgoing) ||
          relationship.cardinality === "manyToMany";
        lines.push(`- ${many ? `Has many ${other} records` : `Belongs to one ${other}`}.`);
      }
      lines.push("");
    }

    /* The lifecycle: the buttons a record offers, and who may press them. A move
       no `%%rbac` line names is open to anyone who may update the record. */
    const machines = model.workflows.filter(
      (workflow) => workflow.entity === entity.name && workflow.transitions.some((t) => t.from !== "[*]")
    );
    const updaters = model.rbac.operations.find(
      (rule) => rule.entity === entity.name && rule.operation === "update"
    )?.roles;
    const mayUpdate = updaters?.length
      ? `${updaters.map((role) => title(role)).join(", ")} (anyone who may update it)`
      : "anyone who may update it";
    // Match on the edges the RBAC compiler resolved (it normalises event names and
    // expands reopen), merging every grant that covers an edge.
    const grantedRoles = (from: string, to: string): string[] => [
      ...new Set(
        model.rbac.transitions
          .filter(
            (rule) =>
              rule.entity === entity.name && rule.edges.some((edge) => edge.from === from && edge.to === to)
          )
          .flatMap((rule) => rule.roles)
      ),
    ];
    for (const machine of machines) {
      lines.push(`## Lifecycle — ${text(machine.name)}`);
      lines.push(
        `A record starts at ${code(machine.initial ?? "—")}${
          machine.terminal.length ? ` and is final at ${machine.terminal.map((state) => code(state)).join(" or ")}` : ""
        }. It moves only by its buttons: read the ones open to this person with ${code("get_record_actions")}, then propose one with ${code("propose_move")} — the person confirms it.`,
        "",
        "| From | Button | To | Who may press |",
        "|---|---|---|---|"
      );
      for (const transition of machine.transitions) {
        if (transition.from === "[*]" || transition.to === "[*]") continue;
        const event = transition.trigger ?? `${transition.from}->${transition.to}`;
        const roles = grantedRoles(transition.from, transition.to);
        lines.push(
          `| ${code(transition.from)} | ${moveLabel(event, transition.to)} (${code(event)}) | ${code(transition.to)} | ${
            roles.length ? roles.map((role) => title(role)).join(", ") : mayUpdate
          } |`
        );
      }
      // Reopen is not drawn: it takes a final record back to Draft.
      for (const from of machine.terminal) {
        const roles = grantedRoles(from, LIFECYCLE_DRAFT);
        lines.push(
          `| ${code(from)} | ${moveLabel(REOPEN_EVENT, LIFECYCLE_DRAFT)} (${code(REOPEN_EVENT)}) | ${code(LIFECYCLE_DRAFT)} | ${
            roles.length ? roles.map((role) => title(role)).join(", ") : "the administrator"
          } |`
        );
      }
      lines.push("");
    }

    const rules = model.rules.filter((rule) => rule.entity === entity.name);
    if (rules.length > 0) {
      lines.push("## What can refuse a change");
      for (const rule of rules) lines.push(`- Rule ${code(rule.name)}, on ${text(rule.event)} (${text(rule.operation)}).`);
      lines.push("When a change is refused, report the application's own words; do not retry another way.", "");
    }

    lines.push("## Who may read it");
    lines.push(
      readers.length > 0
        ? `${readers.map((role) => title(role)).join(", ")}, and the Administrator. Other people do not see it at all.`
        : "Every signed-in person.",
      ""
    );

    const about = reports.get(object) ?? [];
    if (about.length > 0) {
      lines.push("## Reports and charts about it");
      lines.push(
        `On the reporting platform. Find one by name with ${code("search_reports")}, then open it with ${code("open_report")}.`
      );
      for (const item of about.slice(0, REPORTS_PER_ENTITY)) lines.push(`- ${item}`);
      if (about.length > REPORTS_PER_ENTITY) {
        lines.push(`- …and ${about.length - REPORTS_PER_ENTITY} more; search by name.`);
      }
      lines.push("");
    }

    files[skillFileName(entity)] = `${lines.join("\n").trimEnd()}\n`;
    indexRows.push(
      `| ${code(object)} | ${label} | ${text(categoryOf.get(entity.name) ?? "General")} | ${
        identifiers.length ? identifiers.map((column) => code(column)).join(", ") : "—"
      } | ${text(entity.description ?? "").slice(0, 140)} |`
    );
  }

  files["index.md"] = `${[
    `# ${text(options.name)} — record types`,
    "",
    `Every record type this application keeps. Read one type's skill with ${code("read_skill")} (its object) before working with it: how its records are named, its form, its buttons and the reports about it.`,
    "",
    "| Object | Label | Group | Named by | What it is |",
    "|---|---|---|---|---|",
    ...indexRows,
  ].join("\n")}\n`;

  return files;
}
