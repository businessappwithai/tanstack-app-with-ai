/**
 * The administrative screens: dictionary, rules, processes, audit, model.
 *
 * They are grouped in one module because they share a shape — read something
 * the generator seeded, show it next to what the running database now says
 * about it — and because separating five read-only tables into five files would
 * be filing, not structure.
 *
 * The rules screen earns its place. A rule compiled from a flowchart has prose
 * decisions, and the engine's reading of them is a guess that can be wrong;
 * showing the expression each decision became, and marking the ones nothing
 * matched, is the difference between a rule you can trust and a rule that
 * returns "passed".
 */

import { el, mount, spinner, empty, displayValue, toast } from "../dom.js";
import { api } from "../api.js";
import { setHelp } from "../main.js";
import { deleteButton, editorForm, openEditor } from "../editor.js";

/**
 * The Application Dictionary, as the application actually holds it.
 *
 * It used to list the tables and stop there, which showed the smallest part of
 * the dictionary and none of the part that decides what a screen looks like.
 * The reference type on a column is why a field is a dropdown rather than a
 * text box; the reference lists are the dropdown's values; the windows and tabs
 * are how the screens are grouped; the fields are what each tab actually draws.
 * All of it is seeded at first boot and all of it is readable, so all of it is
 * shown.
 *
 * Picking a table opens its columns, and picking a tab opens its fields. That is
 * one request per table rather than one for every table at load, because a
 * seventeen-entity model has several hundred columns and nobody reads them all at
 * once.
 */
export async function dictionaryView(root, { user } = {}) {
  mount(root, spinner("Reading the dictionary"));
  const [tables, summary, references, refLists, windows, tabs, fields] = await Promise.all([
    api.get("/sys/tables"),
    api.get("/sys/model-summary"),
    api.get("/sys/references"),
    api.get("/sys/ref-list"),
    api.get("/sys/windows"),
    api.get("/sys/tabs"),
    api.get("/sys/fields"),
  ]);

  const columnsByTable = new Map();
  const listsByReference = new Map();
  for (const row of refLists) {
    if (!listsByReference.has(row.sys_reference_id)) listsByReference.set(row.sys_reference_id, []);
    listsByReference.get(row.sys_reference_id).push(row);
  }
  const referenceName = new Map(references.map((row) => [row.sys_reference_id, row.name]));

  /* The lists a model declared, rather than the twenty-two standard types every
     application has: those are the %%enum vocabularies, and they are the ones
     worth reading next to the columns that use them. */
  const modelReferences = references.filter((row) => row.sys_reference_id >= 1000);

  const detail = el("div.dict__detail", el("p.muted", "Select a table to see its columns."));

  /*
   * A field is not a column, and this screen used to stop one short of saying so.
   *
   * `sys_column` is where a value is stored; `sys_field` is where it is *placed* —
   * whether it appears on the form at all, whether it appears in the grid, in
   * what order, under what label, and whether it can be edited. That is the third
   * leg of the window/tab/field triple the rest of this section already shows, and
   * the application reads it on every screen it draws: `/bus/<entity>/fields/form`
   * and `.../fields/grid` are both queries over these rows. They were seeded (323
   * of them on the hospital model), served by `/sys/fields`, and rendered nowhere,
   * so the one part of the dictionary that decides what a form looks like was the
   * one part a reader could not look at.
   */
  const fieldsByTab = new Map();
  for (const field of fields) {
    if (!fieldsByTab.has(field.sys_tab_id)) fieldsByTab.set(field.sys_tab_id, []);
    fieldsByTab.get(field.sys_tab_id).push(field);
  }

  const fieldDetail = el("div.dict__detail", el("p.muted", "Select a tab to see its fields."));

  /* The stat counts what this caller can actually open, for the same reason the
     Tables list is scoped: a count of 323 above a list offering eight of them
     reads as a broken screen rather than as access control working. */
  const readableTabIds = new Set(
    tabs
      .filter((tab) => tables.some((row) => row.sys_table_id === tab.sys_table_id))
      .map((tab) => tab.sys_tab_id)
  );
  const visibleFieldCount = fields.filter((field) => readableTabIds.has(field.sys_tab_id)).length;

  /* Columns are fetched per table and cached; the fields view needs the same rows
     to name the column each field sits on, so it goes through the same cache
     rather than adding a second request for what is already in hand. */
  async function columnsFor(tableId) {
    if (!columnsByTable.has(tableId)) {
      columnsByTable.set(tableId, await api.get(`/sys/columns?tableId=${tableId}`));
    }
    return columnsByTable.get(tableId);
  }

  const yesNo = (value) => (value ? "Yes" : "No");

  /**
   * The one dictionary write this application offers, and it had no caller.
   *
   * `PATCH /sys/fields/:id` has been in `sys.routes.js` since the dictionary
   * was, under a comment calling it "the one dictionary write the application
   * itself offers, because it is the one that pays off immediately: a column
   * hidden here disappears from every grid and form without regenerating". It
   * paid off for nobody: no screen listed the fields, so nothing could reach it.
   * The Fields panel is where it belongs.
   *
   * Administrator-only *as an offer*. `sys.routes.js` refuses any non-GET from a
   * caller who is not one, so this decides what is drawn, never what is allowed
   * — a reader who is not an administrator sees the value and no control rather
   * than a control that answers 403.
   *
   * The row is updated from the server's response rather than from what was
   * clicked: the endpoint returns the updated row, and trusting the optimistic
   * value is how a screen comes to disagree with the database it is describing.
   */
  function visibilityCell(field, key, onChanged) {
    if (!user?.isAdmin) return el("td", yesNo(field[key]));

    const label = key === "is_displayed" ? "the form" : "the list";
    const button = el(
      "button.linklike",
      { type: "button", title: `${field[key] ? "Remove from" : "Add to"} ${label}` },
      yesNo(field[key])
    );
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      button.disabled = true;
      try {
        const updated = await api.patch(`/sys/fields/${field.sys_field_id}`, {
          [key]: !field[key],
        });
        Object.assign(field, updated);
        toast(
          `${field.name} is ${field[key] ? "on" : "off"} ${label}. The screen picks it up next time it loads.`,
          "success"
        );
        onChanged();
      } catch (error) {
        toast(error.message, "error");
        button.disabled = false;
      }
    });
    return el("td", button);
  }

  async function showFields(tab) {
    const table = tables.find((row) => row.sys_table_id === tab.sys_table_id);
    /* `/sys/tables` is scoped to what this caller's roles may read; `/sys/tabs`
       and `/sys/fields` are not. Showing the fields of a table absent from that
       scoped list would make this screen name columns of an entity the rest of
       the application refuses to show — so the tab is listed and its fields are
       not, which is the same rule the Tables list above already follows. */
    if (!table) {
      mount(
        fieldDetail,
        el(
          "div",
          el("h3.section-title", tab.name),
          el("p.muted", "This tab belongs to an entity your roles cannot read.")
        )
      );
      return;
    }
    const rows = fieldsByTab.get(tab.sys_tab_id) ?? [];
    const columnName = new Map(
      (await columnsFor(table.sys_table_id)).map((c) => [c.sys_column_id, c.column_name])
    );
    mount(
      fieldDetail,
      el(
        "div",
        el("h3.section-title", `${tab.name} — ${rows.length} fields`),
        el(
          "p.lede",
          "“On form” and “In grid” are what the application asks for when it draws this " +
            "entity’s record screen and its list. Sequence is the order it draws them in." +
            (user?.isAdmin
              ? " Both are editable: click one to hide or show that field. The column stays in the" +
                " database and the screen stops drawing it — no regeneration, no migration."
              : "")
        ),
        rows.length === 0
          ? el("p.muted", "No fields are seeded against this tab.")
          : el(
              "div.table-wrap",
              el(
                "table.table",
                el(
                  "thead",
                  el(
                    "tr",
                    ["Field", "Column", "On form", "In grid", "Form seq", "Grid seq", "Required", "Read only", "Logic", "Type", "Help"].map(
                      (heading) => el("th", heading)
                    )
                  )
                ),
                el(
                  "tbody",
                  rows.map((field) =>
                    el(
                      "tr",
                      el("td", field.name || "—"),
                      el("td", el("code", columnName.get(field.sys_column_id) || "—")),
                      visibilityCell(field, "is_displayed", () => showFields(tab)),
                      visibilityCell(field, "is_displayed_grid", () => showFields(tab)),
                      el("td", displayValue(field.seq_no ?? "—")),
                      el("td", displayValue(field.seq_no_grid ?? "—")),
                      el("td", yesNo(field.is_mandatory)),
                      el("td", yesNo(field.is_read_only)),
                      el("td", logicCell(field)),
                      el("td", field.field_type || "—"),
                      el("td.dict__help", field.description || "—")
                    )
                  )
                )
              )
            )
      )
    );
  }

  /* Compiere's Display, Read Only and Mandatory Logic, as the dictionary row
     holds them — what makes the field appear, lock or become required. */
  function logicCell(field) {
    const parts = [
      ["Display", field.display_logic],
      ["Read only", field.read_only_logic],
      ["Mandatory", field.mandatory_logic],
    ].filter(([, logic]) => logic);
    if (!parts.length) return "—";
    return parts.map(([label, logic]) => el("div", `${label}: `, el("code", logic)));
  }

  async function showColumns(table) {
    const columns = await columnsFor(table.sys_table_id);
    mount(
      detail,
      el(
        "div",
        el("h3.section-title", `${table.name} — ${columns.length} columns`),
        table.description ? el("p.lede", table.description) : null,
        el(
          "div.table-wrap",
          el(
            "table.table",
            el(
              "thead",
              el(
                "tr",
                ["Column", "Name", "Reference", "Lookup", "Required", "Length", "Default", "Help"].map(
                  (heading) => el("th", heading)
                )
              )
            ),
            el(
              "tbody",
              columns.map((column) =>
                el(
                  "tr",
                  el("td", el("code", column.column_name)),
                  el("td", column.name || "—"),
                  el(
                    "td",
                    referenceName.get(column.sys_reference_id) ??
                      (column.sys_reference_id >= 1000 ? "List" : String(column.sys_reference_id ?? "—"))
                  ),
                  el("td", column.ref_table_name ? el("code", column.ref_table_name) : "—"),
                  el("td", column.is_mandatory ? "Yes" : "No"),
                  el("td", displayValue(column.field_length ?? "—")),
                  el("td", displayValue(column.default_value ?? "—")),
                  el("td.dict__help", column.description || "—")
                )
              )
            )
          )
        )
      )
    );
  }

  mount(
    root,
    panel(
      "Application Dictionary",
      "Every screen in this application is drawn from these rows. Change one and the screen changes.",
      el(
        "div",
        statRow([
          ["Tables", tables.length],
          ["References", references.length],
          ["List values", refLists.length],
          ["Windows", windows.length],
          ["Tabs", tabs.length],
          ["Fields", visibleFieldCount],
          ["Rules", summary.counts.rules],
        ]),

        el("h3.section-title", "Tables"),
        el(
          "div.table-wrap",
          el(
            "table.table",
            el(
              "thead",
              el(
                "tr",
                ["Table", "Name", "Category", "Window", "Records", "Help"].map((heading) =>
                  el("th", heading)
                )
              )
            ),
            el(
              "tbody",
              tables.map((table) =>
                el(
                  "tr.dict__row",
                  {
                    onclick: () => showColumns(table),
                    title: `Show the columns of ${table.name}`,
                  },
                  el("td", el("code", table.table_name)),
                  el("td", table.name),
                  el("td", table.category_name || "—"),
                  el("td", table.window_name || "—"),
                  el("td", displayValue(summary.records[entityFor(table.name, summary)] ?? "—")),
                  el("td.dict__help", table.description || "—")
                )
              )
            )
          )
        ),

        el("h3.section-title", "Columns"),
        detail,

        el("h3.section-title", "Reference lists"),
        modelReferences.length === 0
          ? el("p.muted", "This model declares no %%enum vocabularies.")
          : el(
              "div.table-wrap",
              el(
                "table.table",
                el(
                  "thead",
                  el("tr", ["Reference", "Name", "Values"].map((heading) => el("th", heading)))
                ),
                el(
                  "tbody",
                  modelReferences.map((reference) =>
                    el(
                      "tr",
                      el("td", el("code", String(reference.sys_reference_id))),
                      el("td", reference.name),
                      el(
                        "td",
                        (listsByReference.get(reference.sys_reference_id) ?? [])
                          .map((row) => row.name || row.value)
                          .join(" · ") || "—"
                      )
                    )
                  )
                )
              )
            ),

        el("h3.section-title", "Windows and tabs"),
        el(
          "div.table-wrap",
          el(
            "table.table",
            el(
              "thead",
              el("tr", ["Window", "Tab", "Table", "Sequence", "Fields"].map((heading) => el("th", heading)))
            ),
            el(
              "tbody",
              tabs.length === 0
                ? [el("tr", el("td", { colspan: 5 }, "No tabs seeded."))]
                : tabs.map((tab) => {
                    const window = windows.find((row) => row.sys_window_id === tab.sys_window_id);
                    const table = tables.find((row) => row.sys_table_id === tab.sys_table_id);
                    return el(
                      "tr.dict__row",
                      {
                        onclick: () => showFields(tab),
                        title: `Show the fields of ${tab.name}`,
                      },
                      el("td", window?.name || "—"),
                      el("td", tab.name),
                      el("td", table ? el("code", table.table_name) : "—"),
                      el("td", displayValue(tab.seq_no ?? "—")),
                      el("td", table ? displayValue((fieldsByTab.get(tab.sys_tab_id) ?? []).length) : "—")
                    );
                  })
            )
          )
        ),

        el("h3.section-title", "Fields"),
        fieldDetail
      )
    )
  );
}

const entityFor = (name, summary) =>
  Object.keys(summary.records).find((key) => key.toLowerCase() === String(name).replace(/\s+/g, "").toLowerCase()) ??
  name;

/**
 * The rules screen, and the first of the three that can now be edited.
 *
 * `bus.routes.js` enforces from `sys_rule_definitions`, so a rule changed here
 * governs the next write to its entity — no regeneration, the same bargain the
 * dictionary's field toggles make. Administrator-only as an offer; the routes
 * refuse a non-admin write regardless.
 */
export async function rulesView(root, { user } = {}) {
  mount(root, spinner("Loading rules"));
  const [rules, model] = await Promise.all([api.get("/rules"), api.get("/model")]);
  const entities = (model.entities || []).map((entity) => entity.name).sort();
  const editor = el("div.editor-host");
  const reload = () => rulesView(root, { user });

  const newButton = user?.isAdmin
    ? el(
        "button.btn.btn--primary.btn--small",
        {
          onclick: () =>
            openEditor(
              editor,
              editorForm({
                title: "New rule",
                lede:
                  "A rule is evaluated against the record being written and nothing else — a condition naming a parent's column or a count of children is undefined at evaluation, and the rule silently never fires.",
                fields: ruleFields(entities),
                values: { event: "beforeCreate", operation: "ALL", priority: 100, jdm_content: EMPTY_JDM },
                saveLabel: "Create rule",
                onSave: async (values) => {
                  await api.post("/rules", values);
                  toast("Rule created", "success");
                  await reload();
                },
                onCancel: () => mount(editor),
              })
            ),
        },
        "New rule"
      )
    : null;

  if (!rules.length) {
    mount(
      root,
      panel(
        "Business rules",
        "",
        el(
          "div",
          newButton,
          editor,
          empty("This model declares no rules", "Add a %%rule section to the EML and regenerate — or create one here.")
        )
      )
    );
    return;
  }

  mount(
    root,
    panel(
      "Business rules",
      "Compiled from the model's %%rule sections into GoRules JDM, and evaluated here by the browser engine. An administrator can change one without regenerating: the engine reads these rows on every write.",
      el(
        "div",
        newButton,
        editor,
      el(
        "div.cards",
        rules.map((rule) =>
          el(
            "article.rule",
            el(
              "header.rule__head",
              el("h3.rule__name", rule.name),
              el("span.badge", `${rule.entity_name} · ${rule.event}`)
            ),
            el(
              "p.rule__meta",
              `${rule.reading.shape === "decision-table" ? "Decision table" : "Decision graph"} · priority ${rule.priority}`
            ),
            rule.reading.decisions.length
              ? el(
                  "ul.decisions",
                  rule.reading.decisions.map((decision) =>
                    el(
                      `li.decision${decision.assumed ? ".decision--assumed" : ""}`,
                      el("span.decision__label", decision.label),
                      el(
                        "span.decision__reading",
                        decision.assumed ? `assumed true — ${decision.reason}` : decision.expression
                      )
                    )
                  )
                )
              : el("p.rule__meta", "No branching decisions."),
            el(
              "div.rule__actions",
              el("button.btn.btn--small", { onclick: () => tryRule(rule) }, "Try this rule"),
              user?.isAdmin
                ? el(
                    "button.btn.btn--small",
                    {
                      onclick: () =>
                        openEditor(
                          editor,
                          editorForm({
                            title: `Edit ${rule.name}`,
                            fields: ruleFields(entities),
                            values: rule,
                            onSave: async (values) => {
                              await api.patch(`/rules/${rule.sys_rule_definition_id}`, values);
                              toast("Rule saved", "success");
                              await reload();
                            },
                            onCancel: () => mount(editor),
                          })
                        ),
                    },
                    "Edit"
                  )
                : null,
              user?.isAdmin
                ? deleteButton("Delete", `Delete ${rule.name}?`, async () => {
                    await api.delete(`/rules/${rule.sys_rule_definition_id}`);
                    toast(`${rule.name} deleted`, "success");
                    await reload();
                  })
                : null
            )
          )
        )
      )
      )
    )
  );
}

/**
 * The fields a rule has, as the routes define them.
 *
 * `event` and `operation` are `select`s rather than text because the server
 * accepts exactly these values — offering a free-text box invites a rule that
 * is stored, listed, and never evaluated, which is the failure the route's own
 * validation exists to refuse.
 */
function ruleFields(entities) {
  return [
    { name: "name", label: "Name", required: true },
    { name: "entity_name", label: "Entity", type: "select", options: entities, required: true },
    {
      name: "event",
      label: "Runs on",
      type: "select",
      options: ["beforeCreate", "afterCreate", "beforeUpdate", "afterUpdate", "beforeDelete", "afterDelete"],
      hint: "When the engine evaluates it, relative to the write.",
    },
    { name: "operation", label: "Operation", type: "select", options: ["ALL", "CREATE", "UPDATE", "DELETE"] },
    { name: "priority", label: "Priority", type: "number", hint: "Lower runs first." },
    { name: "description", label: "Description" },
    { name: "is_active", label: "Active", type: "checkbox" },
    {
      name: "jdm_content",
      label: "Decision graph (JDM)",
      type: "textarea",
      rows: 12,
      required: true,
      hint: "GoRules JDM: an object with a `nodes` array. Refused at save time if it will not parse.",
    },
  ];
}

/** A graph the engine accepts and that decides nothing — a starting point. */
const EMPTY_JDM = JSON.stringify({ nodes: [], edges: [] }, null, 2);

/** Evaluate a rule against a record the reader types, and show the trace. */
async function tryRule(rule) {
  const input = prompt(
    `Evaluate ${rule.name} against a record.\nJSON, e.g. {"status":"draft"}`,
    '{"status":"draft"}'
  );
  if (input == null) return;
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    toast("That is not valid JSON", "error");
    return;
  }
  try {
    const result = await api.post("/rules/evaluate", {
      entity: rule.entity_name,
      operation: rule.operation,
      data,
    });
    const lines = [
      `${result.rulesEvaluated} rule(s) evaluated`,
      `${result.violations.length} refusal(s)`,
      ...result.violations.map((violation) => `  ✗ ${violation.message}`),
      ...Object.entries(result.mutations).map(([field, value]) => `  → sets ${field} = ${value}`),
      ...result.notifications.map((note) => `  ! ${note.message || note.action}`),
    ];
    toast(lines.join("\n"), result.violations.length ? "error" : "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

/**
 * The processes screen, editable for the same reason the rules screen is.
 *
 * Worth knowing what an edit here does and does not do. `lib/workflows.js`
 * reads these rows, so changing a machine's transitions changes which moves the
 * transition UI offers and which status changes the run log records as
 * modelled — on the next request, without regenerating. What it does not do is
 * *move* a record: that is still a PUT to the record, through the guards, hooks
 * and rules, and there is deliberately no side door.
 */
export async function processesView(root, { user } = {}) {
  mount(root, spinner("Loading processes"));
  const [definitions, runs, model] = await Promise.all([
    api.get("/workflows/definitions"),
    api.get("/workflows/runs?limit=25"),
    api.get("/model"),
  ]);
  const entities = (model.entities || []).map((entity) => entity.name).sort();
  const editor = el("div.editor-host");
  const reload = () => processesView(root, { user });

  const newButton = user?.isAdmin
    ? el(
        "button.btn.btn--primary.btn--small",
        {
          onclick: () =>
            openEditor(
              editor,
              editorForm({
                title: "New process",
                lede:
                  "A state machine's transitions are the only moves its records may make. A `saga` has steps rather than transitions and is never offered as a move.",
                fields: workflowFields(entities),
                values: { kind: "state", definition: EMPTY_WORKFLOW },
                saveLabel: "Create process",
                onSave: async (values) => {
                  await api.post("/workflows/definitions", toWorkflowBody(values));
                  toast("Process created", "success");
                  await reload();
                },
                onCancel: () => mount(editor),
              })
            ),
        },
        "New process"
      )
    : null;

  mount(
    root,
    panel(
      "Processes",
      "State machines and sagas the model declared. A record moves through one by being updated — there is no side door.",
      el(
        "div",
        newButton,
        editor,
        definitions.length
          ? el(
              "div.cards",
              definitions.map((definition) => {
                /* A definition an administrator has edited may not parse — the
                   route validates the shape it understands, not every key a
                   reader might add. One unreadable definition should cost its
                   own card rather than the whole screen. */
                let parsed;
                try {
                  parsed =
                    typeof definition.definition === "string"
                      ? JSON.parse(definition.definition)
                      : definition.definition;
                } catch {
                  parsed = null;
                }
                return el(
                  "article.rule",
                  el(
                    "header.rule__head",
                    el("h3.rule__name", definition.name),
                    el("span.badge", `${definition.entity_name} · ${definition.kind}`)
                  ),
                  parsed === null
                    ? el("p.rule__meta", "This definition is not readable JSON — edit it to repair it.")
                    : null,
                  parsed?.states
                    ? el(
                        "div.states",
                        parsed?.states.map((state) =>
                          el(
                            `span.state${state === parsed?.initial ? ".state--initial" : ""}`,
                            typeof state === "string" ? state : state.name
                          )
                        )
                      )
                    : null,
                  parsed?.transitions
                    ? el(
                        "ul.transitions",
                        parsed?.transitions.map((transition) =>
                          el("li", `${transition.from} → ${transition.to}`, transition.trigger ? el("span.badge.badge--soft", transition.trigger) : null)
                        )
                      )
                    : null,
                  parsed?.steps
                    ? el("ol.transitions", parsed?.steps.map((step) => el("li", `${step.name} (${step.type})`)))
                    : null,
                  user?.isAdmin
                    ? el(
                        "div.rule__actions",
                        el(
                          "button.btn.btn--small",
                          {
                            onclick: () =>
                              openEditor(
                                editor,
                                editorForm({
                                  title: `Edit ${definition.name}`,
                                  fields: workflowFields(entities),
                                  values: {
                                    ...definition,
                                    definition:
                                      typeof definition.definition === "string"
                                        ? prettyJson(definition.definition)
                                        : JSON.stringify(definition.definition, null, 2),
                                  },
                                  onSave: async (values) => {
                                    await api.patch(
                                      `/workflows/definitions/${definition.sys_workflow_definition_id}`,
                                      toWorkflowBody(values)
                                    );
                                    toast("Process saved", "success");
                                    await reload();
                                  },
                                  onCancel: () => mount(editor),
                                })
                              ),
                          },
                          "Edit"
                        ),
                        deleteButton("Delete", `Delete ${definition.name}?`, async () => {
                          await api.delete(
                            `/workflows/definitions/${definition.sys_workflow_definition_id}`
                          );
                          toast(`${definition.name} deleted — its runs are kept`, "success");
                          await reload();
                        })
                      )
                    : null
                );
              })
            )
          : empty("This model declares no processes"),
        el("h2.section-title", "Recent transitions"),
        runs.data.length
          ? el(
              "div.table-wrap",
              el(
                "table.table",
                el("thead", el("tr", ["When", "Process", "Entity", "From", "To", "Modelled"].map((h) => el("th", h)))),
                el(
                  "tbody",
                  runs.data.map((run) =>
                    el(
                      "tr",
                      el("td", displayValue(run.created_at)),
                      el("td", run.workflow_name),
                      el("td", run.entity_name),
                      el("td", run.from_state || "—"),
                      el("td", run.to_state),
                      el("td", run.status === "completed" ? "Yes" : "No")
                    )
                  )
                )
              )
            )
          : empty("Nothing has moved yet", "Change a record's status to see it here.")
      )
    )
  );
}

export async function auditView(root) {
  mount(root, spinner("Loading the audit trail"));
  try {
    const page = await api.get("/audit?limit=100");
    mount(
      root,
      panel(
        "Audit trail",
        "Every write and every sign-in, successful or not.",
        page.data.length
          ? el(
              "div.table-wrap",
              el(
                "table.table",
                el("thead", el("tr", ["When", "Who", "Action", "Entity", "Record", "OK"].map((h) => el("th", h)))),
                el(
                  "tbody",
                  page.data.map((entry) =>
                    el(
                      `tr${entry.success ? "" : ".table__row--bad"}`,
                      el("td", displayValue(entry.created_at)),
                      el("td", entry.user_email || "—"),
                      el("td", el("code", entry.action)),
                      el("td", entry.entity_type || "—"),
                      el("td", entry.entity_id ? el("code", String(entry.entity_id).slice(0, 8)) : "—"),
                      el("td", entry.success ? "✓" : "✗")
                    )
                  )
                )
              )
            )
          : empty("Nothing recorded yet")
      )
    );
  } catch (error) {
    mount(root, panel("Audit trail", "", empty("Not available", error.message)));
  }
}

export async function modelView(root) {
  mount(root, spinner("Loading the model"));
  // Through the client, not a bare fetch: the session is a bearer token the
  // client holds, so a direct fetch here would be the one unauthenticated
  // request in the application and would answer 401.
  const [model, source] = await Promise.all([
    api.get("/model"),
    api.get("/model/source").catch(() => ""),
  ]);

  mount(
    root,
    panel(
      "The model",
      "The EML this application was compiled from. It ships inside the app so the app can describe itself.",
      el(
        "div",
        statRow([
          ["Entities", model.entities.length],
          ["Relationships", model.relationships.length],
          ["Rules", model.rules.length],
          ["Processes", model.workflows.length + (model.sagas || []).length],
          ["Hooks", model.hooks.length],
          ["Access rules", model.rbac.operations.length + model.rbac.transitions.length],
        ]),
        model.rbac.operations.length || model.rbac.transitions.length
          ? el(
              "div",
              el("h2.section-title", "Access control"),
              el(
                "ul.plain-list",
                model.rbac.operations.map((rule) =>
                  el("li", el("code", `${rule.entity}.${rule.operation}`), ` restricted to ${rule.roles.join(" or ")}`)
                ),
                model.rbac.transitions.map((rule) =>
                  el("li", el("code", `${rule.entity}.${rule.transition}`), ` (transition) restricted to ${rule.roles.join(" or ")}`)
                )
              )
            )
          : null,
        el("h2.section-title", "Source"),
        el("pre.source", el("code", source || "— not shipped with this application —"))
      )
    )
  );
}

/**
 * Every administrative screen has the same shape: a title, a body, and its
 * explanation behind the `?`.
 *
 * The explanation used to be both — a `<p class="lede">` under the heading
 * *and* the screen's registered help text, which is the same sentence shown
 * twice. It is the help now, and only the help, so there is one place in this
 * application that shows help and one control that opens it.
 */
function panel(title, subtitle, body) {
  if (subtitle) setHelp(subtitle);
  return el("section", el("h2.section-title", title), body);
}

function statRow(entries) {
  return el(
    "div.stats",
    entries.map(([label, value]) => el("div.stat", el("span.stat__value", String(value)), el("span.stat__label", label)))
  );
}

/**
 * The fields a workflow definition has.
 *
 * `definition` is raw JSON on purpose. A form with a row-per-transition would
 * be friendlier and would also be a second, partial model of what a workflow
 * is — one that quietly drops the keys it has no widget for. The route
 * validates the shape it understands (`state` needs transitions, each with a
 * `from` and a `to`) and preserves everything else, so the textarea is the
 * honest control: it can express whatever the model could.
 */
function workflowFields(entities) {
  return [
    { name: "name", label: "Name", required: true },
    { name: "entity_name", label: "Entity", type: "select", options: entities, required: true },
    {
      name: "kind",
      label: "Kind",
      type: "select",
      options: [
        { value: "state", label: "state — a record's lifecycle" },
        { value: "saga", label: "saga — a multi-step process" },
      ],
    },
    { name: "is_active", label: "Active", type: "checkbox" },
    {
      name: "definition",
      label: "Definition (JSON)",
      type: "textarea",
      rows: 14,
      required: true,
      hint: "A `state` workflow needs a `transitions` array, each entry with a `from` and a `to`. A `saga` has `steps`.",
    },
  ];
}

/**
 * Send `definition` as an object, not as a string.
 *
 * The route accepts either, but parsing here means a typo is reported as "not
 * readable JSON" against the field the reader is looking at rather than as a
 * shape complaint about a string the server could not read either.
 */
function toWorkflowBody(values) {
  let definition;
  try {
    definition = JSON.parse(values.definition);
  } catch (error) {
    throw new Error(`Definition is not readable JSON: ${error.message}`);
  }
  return { ...values, definition };
}

/** Re-indent stored JSON so a textarea shows it readably. */
function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** A state machine with one drawn edge — the smallest thing the route accepts. */
const EMPTY_WORKFLOW = JSON.stringify(
  { initial: "draft", states: ["draft", "active"], transitions: [{ from: "draft", to: "active" }] },
  null,
  2
);
