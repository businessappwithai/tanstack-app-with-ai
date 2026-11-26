/**
 * The record panel — fields, controls and validation, all from the dictionary.
 *
 * It renders above the grid rather than replacing it, and its header carries
 * the field count and how many are required, exactly as the React application's
 * does. Each field wears a chip naming its type. That chip is not decoration:
 * in a dictionary-driven application the reason a control is a dropdown rather
 * than a text box lives in a table, and showing the reason next to the control
 * is what makes the dictionary legible from the screen it produced.
 *
 * Three things here are worth knowing.
 *
 * A field renders as a dropdown when its column carries a list reference, which
 * is what `%%enum` compiles to; the values come from `/sys/ref-list` rather than
 * from anything baked into this file, so adding a value to the model adds it to
 * the form.
 *
 * A rule refusal comes back as a 422 with the rule's own violations, and they
 * are shown attached to the record rather than as a generic error, because "the
 * server said no" and "the rule you wrote said no, and here it is" are different
 * messages to the person who wrote the rule.
 *
 * And the transitions panel offers only the moves the record's state machine
 * allows from where it actually is, marking the ones the caller's roles do not
 * permit. Offering a button the server will refuse is worse than offering none.
 */

import { el, helpToast, mount, spinner, toast, displayValue } from "../dom.js";
import { api } from "../api.js";
import { setActions, childEntitiesOf } from "../main.js";
import { fieldLogicState } from "../../server/lib/field-logic.js";

const referenceCache = new Map();
const lookupCache = new Map();

async function refList(referenceId) {
  if (!referenceCache.has(referenceId)) {
    referenceCache.set(referenceId, await api.get(`/sys/ref-list?referenceId=${referenceId}`));
  }
  return referenceCache.get(referenceId);
}

/**
 * The rows a Table Direct column can point at.
 *
 * `sys_column.ref_table_name` says which table; this asks the server for its
 * ids and labels. An empty table is a real answer, not a failure — the control
 * says so and disables itself rather than presenting a box for a uuid nobody
 * can be expected to type.
 */
async function lookupOptions(table) {
  if (!lookupCache.has(table)) {
    lookupCache.set(
      table,
      api.get(`/sys/lookup?table=${encodeURIComponent(table)}`).catch(() => ({ options: [] }))
    );
  }
  const result = await lookupCache.get(table);
  const options = result?.options ?? [];
  /* An empty table is the one answer worth asking again for: it is the state
     the user is about to change, by going and creating the record the lookup
     had none of. Caching it means they come back, find the same "No X records
     yet", and have no way to tell the form otherwise short of reloading. */
  if (options.length === 0) lookupCache.delete(table);
  return options;
}

/** `bus_purchase_order` -> `Purchase Order`, for a message about an empty table. */
function tableLabel(table) {
  return String(table)
    .replace(/^bus_/, "")
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The controls a reference type asks the browser for.
 *
 * `color` (27) is deliberately absent: `<input type="color">` has no way to say
 * "no colour", so every optional colour column a user never touched would save
 * as black. It stays a text box until the form can offer a swatch that clears.
 */
const INPUT_BY_REFERENCE = { 24: "url", 29: "password", 30: "email", 31: "tel" };

/** The label shown on a field's type chip, and the class that colours it. */
function typeChip(attribute, field) {
  if (field.sys_reference_id >= 1000 || attribute.enumValues?.length) return ["List", "list"];
  if (attribute.refTable || /_id$/.test(attribute.columnName)) return ["Direct Lookup", "lookup"];
  switch (Number(field.sys_reference_id)) {
    case 24: return ["URL", "text"];
    case 27: return ["Colour", "text"];
    case 29: return ["Password", "text"];
    case 30: return ["Email", "text"];
    case 31: return ["Phone", "text"];
    default: break;
  }
  switch (attribute.type) {
    case "integer": return ["Integer", "number"];
    case "decimal": return ["Amount", "number"];
    case "boolean": return ["Yes/No", "bool"];
    case "date": return ["Date", "date"];
    case "datetime": return ["Date/Time", "date"];
    case "json": return ["JSON", "number"];
    case "text": return ["Long Text", "text"];
    default: return ["Text", "text"];
  }
}

export async function recordPanel(root, { entity, id, onClose, onSaved, navigate }) {
  const isNew = !id || id === "new";
  mount(root, el("div.record", el("div.record__body", spinner(isNew ? "Preparing the form" : "Loading the record"))));

  let fields;
  let record = {};
  /* The state field, when the entity has a state machine. It is never among
     the form fields — no person changes it — so it is read from the grid
     fields, which always carry it, and shown in the header. */
  let stateField = null;
  try {
    fields = await api.get(`/bus/${entity.routeName}/fields/form`);
    if (!isNew) record = await api.get(`/bus/${entity.routeName}/${id}`);
    try {
      const grid = await api.get(`/bus/${entity.routeName}/fields/grid`);
      stateField = grid.find((field) => field.is_state_field) ?? null;
    } catch {
      stateField = null;
    }
  } catch (error) {
    mount(root, el("div.empty", el("h3", "Could not open this record"), el("p", error.message)));
    return;
  }

  const editable = fields.filter(
    (field) => !["id", "version"].includes(field.column_name) && !field.is_state_field
  );
  // Optimistic locking: the version this form opened the record at. A save
  // sends it as If-Match and the server refuses it with 409 if someone has
  // saved since; "Overwrite" moves it to the version that conflict reported.
  let openedVersion = record.version;
  const inputs = new Map();
  const violationBox = el("div.violations", { hidden: true });

  const controls = await Promise.all(
    editable.map((field) => control(field, record, entity, inputs))
  );

  /*
   * Field logic — Compiere's Display, Read Only and Mandatory Logic.
   *
   * Each field may carry `@column@=value` conditions over the record being
   * edited (`%%field … display: | readonly: | mandatory:`). They are evaluated
   * against what the form holds now, not what was loaded, and again on every
   * change, so a field appears, locks or becomes required as the record is
   * edited — the dependency refresh Compiere's GridField does. The server
   * judges the same logic on save (bus.routes.js `enforceFieldLogic`); this is
   * what lets a person see the rule before they break it.
   */
  const requiredLabel = el("span.record__required");
  const currentValues = () => {
    const values = { ...record };
    for (const [column, input] of inputs) {
      values[column] = input.type === "checkbox" ? input.checked : input.value;
    }
    return values;
  };
  const applyLogic = () => {
    const values = currentValues();
    let required = 0;
    for (const [field, node] of controls) {
      const state = fieldLogicState(field, values);
      const input = inputs.get(field.column_name);
      node.hidden = !state.displayed;
      if (input) {
        input.disabled = input.dataset.baseDisabled === "true" || state.readOnly;
        // `required` only on a field that is shown: a hidden required input
        // stops the browser submitting a form nobody can see the fault in.
        if (input.type !== "checkbox") input.required = state.mandatory && !input.disabled;
      }
      /* The marker exists exactly while the field is required — added and
         removed, never hidden — so `.field:has(.field__required)` keeps
         naming the required fields and nothing else. */
      const marker = node.querySelector(".field__required");
      if (state.mandatory && !marker) {
        node.querySelector(".field__label")?.after(requiredMarker());
      } else if (!state.mandatory && marker) {
        marker.remove();
      }
      node.classList.toggle("field--logic-locked", state.readOnly && !field.is_read_only);
      if (state.mandatory) required += 1;
    }
    requiredLabel.textContent = required ? `${required} required` : "";
    requiredLabel.hidden = !required;
  };
  applyLogic();
  for (const input of inputs.values()) {
    input.addEventListener("input", applyLogic);
    input.addEventListener("change", applyLogic);
  }

  /* Which fields the person has changed since the record opened. A button press
     saves these first (see the transition route) — so what was typed is kept
     even when a workflow bound to the next status refuses the move. */
  const touched = new Set();
  for (const [column, input] of inputs) {
    const mark = () => touched.add(column);
    input.addEventListener("input", mark);
    input.addEventListener("change", mark);
  }

  /* `%%section`: the model's own headings, in its order, each a two-column
     grid in which a field alone on its row spans both columns. A model with
     no sections has one ungrouped "General" list, as it always did. */
  const grouped = new Map();
  for (const [field, node] of controls) {
    const name = field.group_name || "General";
    if (!grouped.has(name)) {
      grouped.set(name, {
        description: field.group_name ? field.group_description : null,
        columns: field.group_columns || 0,
        collapsed: !!field.group_collapsed,
        nodes: [],
      });
    }
    if (field.col_span > 1) node.classList.add("field--wide");
    grouped.get(name).nodes.push(node);
  }

  const submit = async () => {
    violationBox.hidden = true;
    setActions({ ...currentActions, busy: true });

    const payload = {};
    for (const [column, input] of inputs) {
      payload[column] = input.type === "checkbox" ? input.checked : input.value;
    }

    try {
      const saved = isNew
        ? await api.post(`/bus/${entity.routeName}`, payload)
        : await api.put(
            `/bus/${entity.routeName}/${id}`,
            payload,
            openedVersion == null ? {} : { "If-Match": `"${openedVersion}"` }
          );
      toast(isNew ? `${entity.singularName} created` : "Saved", "success");
      /* This row may be what some other entity's lookup is missing, and its
         label may be what an existing option now reads as. Neither is worth a
         reload to discover. */
      lookupCache.clear();
      await onSaved(saved);
      if (isNew) navigate(`/entity/${entity.routeName}/${saved.id}`, { replace: true });
    } catch (error) {
      if (error.status === 409 && error.details?.code === "VERSION_CONFLICT") {
        await showConflict(violationBox, {
          entity,
          id,
          fields: editable,
          base: record,
          mine: payload,
          onReload: () => recordPanel(root, { entity, id, onClose, onSaved, navigate }),
          onOverwrite: (theirs) => {
            openedVersion = theirs.version;
            submit();
          },
        });
      } else {
        showProblem(violationBox, error);
      }
    } finally {
      setActions({ ...currentActions, busy: false });
    }
  };

  const currentActions = {
    onSave: submit,
    saveLabel: isNew ? "Create" : "Save",
    onNew: () => navigate(`/entity/${entity.routeName}/new`),
    newLabel: entity.singularName,
  };
  setActions(currentActions);

  const saveButton = el(
    "button.btn.btn--primary",
    { type: "submit" },
    isNew ? "Create" : "Save changes"
  );

  const form = el(
    "form",
    {
      onsubmit: (event) => {
        event.preventDefault();
        submit();
      },
    },
    el(
      "div.record__meta",
      `${editable.length} field${editable.length === 1 ? "" : "s"}`,
      requiredLabel,
      el("button.btn.btn--primary.btn--small", { type: "submit" }, isNew ? "Create" : "Save")
    ),
    violationBox,
    el(
      "div.record__body",
      [...grouped.entries()].map(([group, section]) => {
        const fieldsGrid = el(
          section.columns === 2 ? "div.group__fields.group__fields--2" : "div.group__fields",
          section.nodes
        );
        const description = section.description || `${group} information fields`;
        /* A collapsed section is a <details>: closed until opened, and a
           browser's own control rather than one more thing to wire. */
        return section.collapsed
          ? el(
              "details.group",
              el("summary.group__name", group),
              el("p.group__desc", description),
              fieldsGrid
            )
          : el("section", el("h3.group__name", group), el("p.group__desc", description), fieldsGrid);
      })
    ),
    el(
      "div.record__actions",
      isNew
        ? null
        : el(
            "button.btn.btn--danger",
            {
              type: "button",
              onclick: async () => {
                if (!confirm(`Delete this ${entity.singularName}?`)) return;
                try {
                  await api.delete(`/bus/${entity.routeName}/${id}`);
                  toast("Deleted", "success");
                  await onSaved(null);
                  onClose();
                } catch (error) {
                  showProblem(violationBox, error);
                }
              },
            },
            "Delete"
          ),
      el("button.btn", { type: "button", onclick: onClose }, "Cancel"),
      saveButton
    )
  );

  /*
   * The line items belonging to this record.
   *
   * Rendered under the form rather than as a separate screen, because that is
   * what `parent:` means: an invoice line is part of the invoice you are
   * looking at. Only for a saved record — a child of a parent with no id yet
   * has nothing to hang from, and offering the tab would be offering a list
   * that cannot exist.
   */
  const detailSlot = el("div");
  if (!isNew) void renderDetails(detailSlot, entity, id, navigate);

  /*
   * What has been done to this record, at the foot of it.
   *
   * The trail is written on every create, update and delete; showing it here
   * is what makes it answerable rather than archival — "who changed this, and
   * to what" is a question asked about a record you are looking at, not one
   * anybody goes to an admin screen to ask.
   */
  const auditSlot = el("div");
  const notesSlot = el("div");
  if (!isNew) {
    void renderNotes(notesSlot, entity, id);
    void renderAudit(auditSlot, entity, id);
  }

  form.touchedValues = () => {
    const values = {};
    for (const column of touched) {
      const input = inputs.get(column);
      if (input) values[column] = input.type === "checkbox" ? input.checked : input.value;
    }
    return values;
  };

  mount(
    root,
    el(
      "div.record",
      el(
        "header.record__head",
        el("h2.record__title", isNew ? `New ${entity.singularName}` : recordTitle(record, editable, entity)),
        stateBadge(stateField, record, entity, isNew),
        el("button.record__close", { title: "Close", "aria-label": "Close", onclick: onClose }, "✕")
      ),
      form,
      detailSlot,
      notesSlot,
      auditSlot
    ),
    isNew ? null : el("div.split", el("div"), el("aside.side", await sidePanels(entity, id, record, onSaved, form, () => recordPanel(root, { entity, id, onClose, onSaved, navigate }))))
  );
}

/**
 * Notes on a record: what a person wanted to say about it.
 *
 * Above the history rather than inside it, and deliberately so. The trail
 * records what the system observed and must not be editable; a note is
 * somebody's sentence, and belongs beside that account without becoming part
 * of it. Both are stamped with who and when, which is the only thing they
 * genuinely have in common.
 *
 * A note cannot be edited or removed once left. That is not an omission: a
 * note somebody can quietly rewrite is worth about as much as a conversation
 * nobody remembers.
 */
async function renderNotes(slot, entity, id) {
  const path = `/audit/notes/${entity.tableName}/${encodeURIComponent(id)}`;

  const listSlot = el("div.notes__list");
  const box = el("textarea.notes__input", {
    rows: 2,
    placeholder: `Add a note about this ${entity.singularName}…`,
    "aria-label": `Add a note about this ${entity.singularName}`,
    maxlength: 4000,
  });
  const addButton = el("button.btn.btn--primary.btn--small", { type: "button" }, "Add note");

  const when = (value) => {
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? String(value ?? "") : at.toLocaleString();
  };

  const paint = (entries) =>
    mount(
      listSlot,
      entries.length
        ? el(
            "ol.notes__items",
            entries.map((entry) =>
              el(
                "li.note",
                el(
                  "div.note__line",
                  el("span.note__who", entry.userEmail || "unknown"),
                  el("span.note__when", when(entry.at))
                ),
                /* textContent, not markup: a note is whatever somebody typed. */
                el("p.note__text", entry.note)
              )
            )
          )
        : el("p.notes__empty", "No notes yet.")
    );

  let entries;
  try {
    entries = (await api.get(path)).data ?? [];
  } catch {
    return; // No read access to the entity means no notes panel.
  }
  paint(entries);

  addButton.addEventListener("click", async () => {
    const note = box.value.trim();
    if (!note) return;
    addButton.disabled = true;
    try {
      const created = await api.post(path, { note });
      entries = [created, ...entries];
      box.value = "";
      paint(entries);
      toast("Note added", "success");
    } catch (error) {
      toast(error.message || "Could not add the note", "error");
    } finally {
      addButton.disabled = false;
    }
  });

  mount(
    slot,
    el(
      "section.notes",
      el("div.notes__head", el("h3.notes__title", "Notes")),
      el("div.notes__compose", box, addButton),
      listSlot
    )
  );
}

const AUDIT_LABEL = { CREATE: "Created", UPDATE: "Updated", DELETE: "Deleted" };

/**
 * This record's history: who changed it, when, and which columns moved.
 *
 * Fifty entries at most and newest first, because the question is nearly always
 * "what happened to it recently". Each update lists the columns that actually
 * changed — the server works that out by comparing before and after, so a save
 * that touched one field does not read as a rewrite of the whole record.
 *
 * A role that may not read the entity is refused the trail with it, and the
 * section simply does not appear: its absence is the access rules working.
 */
async function renderAudit(slot, entity, id) {
  let entries;
  try {
    const answer = await api.get(`/audit/record/${entity.tableName}/${encodeURIComponent(id)}`);
    entries = answer.data ?? [];
  } catch {
    return;
  }
  if (!entries.length) return;

  const when = (value) => {
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? String(value ?? "") : at.toLocaleString();
  };

  mount(
    slot,
    el(
      "section.audit",
      el(
        "div.audit__head",
        el("h3.audit__title", "History"),
        el("span.audit__count", `${entries.length} change${entries.length === 1 ? "" : "s"}`)
      ),
      el(
        "ol.audit__list",
        entries.map((entry) => {
          const changed = (entry.changedFields || []).filter(
            (column) => !["updated_at", "updated_by", "version"].includes(column)
          );
          return el(
            "li.audit__entry",
            { "data-action": entry.action, "data-failed": entry.success ? null : "true" },
            el(
              "div.audit__line",
              el("span.audit__action", AUDIT_LABEL[entry.action] ?? entry.action),
              el("span.audit__who", entry.userEmail || "unknown"),
              el("span.audit__when", when(entry.at))
            ),
            /* Which columns moved, and to what. The old value is worth the room
               only when there was one — a create has nothing to compare. */
            changed.length
              ? el(
                  "ul.audit__fields",
                  changed.slice(0, 8).map((column) =>
                    el(
                      "li.audit__field",
                      el("span.audit__col", column),
                      entry.before && entry.before[column] !== undefined
                        ? el("span.audit__from", String(entry.before[column] ?? "—"))
                        : null,
                      el("span.audit__arrow", "→"),
                      el(
                        "span.audit__to",
                        String((entry.after && entry.after[column]) ?? "—")
                      )
                    )
                  )
                )
              : null,
            entry.success ? null : el("p.audit__error", entry.error || "This attempt failed.")
          );
        })
      )
    )
  );
}

/**
 * The detail tabs: one per entity that named this one as its `parent:`.
 *
 * Each asks the server for exactly the rows whose link column holds this
 * record's id — the same equality filter the grid's column filters already use,
 * so no new endpoint and no new contract. A row opens the child in its own
 * window; the child has no dashboard card, but it is still a record with a form.
 */
async function renderDetails(slot, entity, id, navigate) {
  const children = childEntitiesOf(entity.name);
  if (!children.length) return;

  const sections = [];
  for (const child of children) {
    if (!child.parentLinkColumn) continue;
    try {
      const [fields, page] = await Promise.all([
        api.get(`/bus/${child.routeName}/fields/grid`),
        api.get(`/bus/${child.routeName}?${child.parentLinkColumn}=${encodeURIComponent(id)}&limit=100`),
      ]);
      const columns = fields.filter((field) => field.column_name !== child.parentLinkColumn);

      sections.push(
        el(
          "section.detail",
          el(
            "div.detail__head",
            el("h3.detail__title", child.displayName),
            el("span.detail__count", `${page.total} row${page.total === 1 ? "" : "s"}`)
          ),
          page.data.length
            ? el(
                "div.table-wrap",
                el(
                  "table.table",
                  el("thead", el("tr", columns.map((column) => el("th", column.name)))),
                  el(
                    "tbody",
                    page.data.map((row) =>
                      el(
                        "tr.table__row",
                        { onclick: () => navigate(`/entity/${child.routeName}/${row.id}`) },
                        columns.map((column) => {
                          const label = page.labels?.[column.column_name]?.[row[column.column_name]];
                          return el(
                            "td",
                            label === undefined
                              ? displayValue(row[column.column_name], column)
                              : el("span.cell--ref", { title: row[column.column_name] }, label)
                          );
                        })
                      )
                    )
                  )
                )
              )
            : el("p.detail__empty", `No ${child.displayName} on this ${entity.singularName} yet.`)
        )
      );
    } catch {
      // A child the signed-in role may not read is simply not shown. The 403 is
      // the access rules working, not a fault worth putting on screen.
    }
  }

  if (sections.length) mount(slot, ...sections);
}

/* What the last press of a record's button came to, kept until the next press:
   the panel is drawn again after every press, and a refusal has to survive that. */
const pressNotices = new Map();

function pressNotice(notice) {
  return el(
    "div.side__notice",
    { role: "alert", "data-testid": "press-refused" },
    el("strong", `${notice.label} did not go through`),
    el(
      "p",
      `${notice.saved ? "Your changes were saved. " : ""}` +
        `${notice.workflow ? `Workflow "${notice.workflow}" failed: ` : ""}${notice.message}. ` +
        "The status did not change. Fix it and press the button again."
    )
  );
}

async function sidePanels(entity, id, record, onSaved, form, reload) {
  const panels = [];

  try {
    const workflow = await api.get(`/workflows/entity/${entity.routeName}/${id}/transitions`);
    if (workflow.workflow) {
      /* The record's action buttons: the moves this person may press from
         where it is, from the server, which judges every press again. One
         move or several, each a button; Reopen apart, at a locked end. */
      let actions = [];
      try {
        actions = await api.get(`/bus/${entity.routeName}/${id}/actions`);
      } catch {
        actions = [];
      }
      const noticeKey = `${entity.routeName}:${id}`;
      const press = async (action, button) => {
        button.disabled = true;
        pressNotices.delete(noticeKey);
        /* A move saves what was typed first, then runs the sagas bound to the
           status it reaches; Reopen is not a save and leaves the form alone. */
        const typed = action.kind === "move" && form?.touchedValues ? form.touchedValues() : {};
        const data = Object.keys(typed).length ? typed : undefined;
        try {
          await api.post(
            `/bus/${entity.routeName}/${id}/transition`,
            { event: action.event || undefined, to: action.to, ...(data ? { data } : {}) },
            record.version == null ? {} : { "If-Match": `"${record.version}"` }
          );
          toast(action.kind === "reopen" ? "Reopened — the record is a draft again." : `${action.label} — done.`, "success");
        } catch (error) {
          /* The refusal stays on the record, beside the buttons: the person has
             to act on it, and a toast is gone before they have read it. */
          const details = error.details || {};
          pressNotices.set(noticeKey, {
            label: action.label,
            saved: details.phase === "workflow" && !!data,
            workflow: details.workflow || null,
            message: details.workflow ? details.reason || error.message : error.message || "The move was refused.",
          });
        }
        /* The list beside it, and this panel: the record has moved (or was
           read afresh after a refusal), so its buttons are drawn again. */
        await onSaved(null);
        if (reload) await reload();
      };
      const moves = actions.filter((action) => action.kind === "move");
      const reopen = actions.find((action) => action.kind === "reopen");
      const button = (action, tone) => {
        const node = el(
          `button.btn.btn--small${tone}`,
          { type: "button", "data-testid": `record-action-${action.event || action.to}` },
          action.label
        );
        node.onclick = () => press(action, node);
        return node;
      };

      if (workflow.locked && form) {
        /* The end of a flow is Final and locked: nothing on the form can be
           changed until the record is reopened. */
        for (const control of form.querySelectorAll("input, select, textarea, button")) control.disabled = true;
      }

      panels.push(
        el(
          "div.side__card",
          { "data-testid": "record-actions" },
          el("h3.side__title", "Process"),
          el(
            "p.side__meta",
            { "data-testid": "record-lifecycle", "data-phase": workflow.phase ?? "" },
            workflow.locked
              ? `Final — ${title(workflow.current ?? "")}. Locked; reopen it to change it.`
              : `${workflow.workflow} — currently ${title(workflow.current ?? "unset")}`
          ),
          pressNotices.has(noticeKey) ? pressNotice(pressNotices.get(noticeKey)) : null,
          moves.length || reopen
            ? el(
                "div.side__actions",
                moves.length > 1 ? el("p.side__meta", "Choose where this record goes next:") : null,
                ...moves.map((move) => button(move, ".btn--primary")),
                reopen ? button(reopen, "") : null
              )
            : el(
                "p.side__empty",
                workflow.locked
                  ? "Only an administrator, or a role allowed to reopen it, can reopen this record."
                  : workflow.transitions.length
                    ? "Its next moves belong to another role."
                    : "This is a final state."
              )
        )
      );
    }
  } catch {
    // A model with no workflows simply has no panel.
  }

  panels.push(
    el(
      "div.side__card",
      el("h3.side__title", "Record"),
      el(
        "dl.side__list",
        el("dt", "Created"), el("dd", displayValue(record.created_at)),
        el("dt", "Updated"), el("dd", displayValue(record.updated_at)),
        el("dt", "Version"), el("dd", displayValue(record.version)),
        el("dt", "Id"), el("dd", String(record.id ?? "—").slice(0, 8))
      )
    )
  );

  return panels;
}

async function control(field, record, entity, inputs) {
  const attribute = entity.attributes.find((item) => item.columnName === field.column_name) || {};
  const value = record[field.column_name];
  const id = `field-${field.column_name}`;
  const [chipLabel, chipKind] = typeChip(attribute, field);
  let input;

  const values = attribute.enumValues?.length
    ? attribute.enumValues.map((item) => ({ value: item, name: title(item) }))
    : field.sys_reference_id >= 1000
      ? (await refList(field.sys_reference_id)).map((row) => ({ value: row.value, name: row.name }))
      : null;

  if (values) {
    input = el(
      "select.field__input",
      { id, name: field.column_name },
      el("option", { value: "" }, field.is_mandatory ? `Select ${field.name}...` : "—"),
      values.map((option) =>
        el("option", { value: option.value, selected: String(value ?? "") === option.value }, option.name)
      )
    );
  } else if (field.ref_table_name) {
    /* A Table Direct column. Until this existed the field fell through to the
       plain-text branch below, so a reference rendered as an empty box that
       said "Direct Lookup" on its chip and accepted anything typed into it. */
    const options = await lookupOptions(field.ref_table_name);
    const current = value == null ? "" : String(value);
    const known = options.some((option) => String(option.id) === current);

    if (options.length === 0) {
      input = el(
        "select.field__input",
        { id, name: field.column_name, disabled: true },
        el("option", { value: "" }, `No ${tableLabel(field.ref_table_name)} records yet`)
      );
    } else {
      input = el(
        "select.field__input",
        { id, name: field.column_name },
        el("option", { value: "" }, field.is_mandatory ? `Select ${field.name}...` : "—"),
        /* A value the list does not contain — an older row, or one beyond the
           page — is kept as its own option, so opening a record and saving it
           cannot quietly drop the reference. */
        !known && current
          ? [el("option", { value: current, selected: true }, `${current} (not in the list)`)]
          : [],
        options.map((option) =>
          el(
            "option",
            { value: String(option.id), selected: String(option.id) === current },
            option.label == null || option.label === "" ? String(option.id) : String(option.label)
          )
        )
      );
    }
  } else if (attribute.type === "boolean") {
    input = el("input.field__checkbox", { id, type: "checkbox", checked: value === true });
  } else if (attribute.type === "text") {
    input = el("textarea.field__input.field__input--area", { id, rows: 4 }, value ?? "");
  } else if (INPUT_BY_REFERENCE[Number(field.sys_reference_id)]) {
    /* The dictionary knows this column is an address, a number to ring, a link
       or a secret — `email`, `phone`, `url` and `password` in the model. Every
       one of them is a `string` by the time it reaches SQL, so the reference is
       the only thing left that can ask the browser for the right keyboard on a
       phone and the right masking on a password. */
    input = el("input.field__input", {
      id,
      type: INPUT_BY_REFERENCE[Number(field.sys_reference_id)],
      value: value == null ? "" : String(value),
      maxlength: attribute.maxLength || null,
      required: field.is_mandatory || null,
      autocomplete: Number(field.sys_reference_id) === 29 ? "new-password" : null,
    });
  } else {
    input = el("input.field__input", {
      id,
      type:
        attribute.type === "integer" || attribute.type === "decimal"
          ? "number"
          : attribute.type === "date"
            ? "date"
            : attribute.type === "datetime"
              ? "datetime-local"
              : "text",
      step: attribute.type === "decimal" ? "any" : null,
      value: normalizeForInput(value, attribute.type),
      maxlength: attribute.maxLength || null,
      required: field.is_mandatory || null,
    });
  }

  if (field.is_read_only || (record.id && field.is_updateable === false)) input.disabled = true;
  /* What the dictionary fixes, kept apart from what read-only logic decides
     from moment to moment — `applyLogic` re-derives `disabled` from both. */
  input.dataset.baseDisabled = input.disabled ? "true" : "false";
  inputs.set(field.column_name, input);

  return [
    field,
    el(
      `div.field${attribute.type === "text" ? ".field--wide" : ""}`,
      el(
        "div.field__head",
        el("label.field__label", { for: id }, field.name),
        field.is_mandatory ? requiredMarker() : null,
        el(`span.chip.chip--${chipKind}`, chipLabel),
        el(
          "button.field__help",
          {
            type: "button",
            title: `Help for ${field.name}`,
            "aria-label": `Help for ${field.name}`,
            onclick: () => helpToast(`${field.name} — Help`, fieldHelpBody(field, attribute)),
          },
          "?"
        )
      ),
      input
    ),
  ];
}

function requiredMarker() {
  return el("span.field__required", { title: "Required" }, "*");
}

/**
 * What a field's `?` says: the dictionary's own help text, then what the
 * column actually is.
 *
 * Both halves used to be somewhere else. `field.description` — the model's
 * `%%field … help:` text, and the only prose the dictionary carries about a
 * column — rendered as a permanent note under the input, so a form with help
 * on every field was twice as tall as the form. The type and length sat in the
 * `?` button's `title` attribute, which is a tooltip: it appears on hover, on
 * a pointer, after a delay, and not at all on a phone.
 *
 * One `?`, one panel, both halves.
 */
function fieldHelpBody(field, attribute) {
  const facts = [`Column: ${field.column_name}`, `Type: ${attribute.type ?? "text"}`];
  if (attribute.maxLength) facts.push(`Up to ${attribute.maxLength} characters`);
  if (field.is_mandatory) facts.push("Required");
  if (field.is_read_only) facts.push("Read-only");
  /* The dictionary's logic, as written — what makes the field appear, lock or
     become required, which is otherwise invisible from the form. */
  if (field.display_logic) facts.push(`Shown when ${field.display_logic}`);
  if (field.read_only_logic) facts.push(`Read-only when ${field.read_only_logic}`);
  if (field.mandatory_logic) facts.push(`Required when ${field.mandatory_logic}`);
  if (attribute.enumValues?.length) facts.push(`One of: ${attribute.enumValues.join(", ")}`);
  if (attribute.refTable) facts.push(`References ${attribute.refTable}`);

  return el(
    "div",
    field.description ? el("p.field__helptext", field.description) : null,
    el(
      "ul.field__helpfacts",
      facts.map((fact) => el("li", fact))
    )
  );
}

function normalizeForInput(value, type) {
  if (value == null) return "";
  if (type === "date") return String(value).slice(0, 10);
  if (type === "datetime") return String(value).slice(0, 16);
  return String(value);
}

/** Same value across the shapes a field takes: a NUMERIC string and a number. */
function sameValue(a, b) {
  if (a === b) return true;
  if (a == null || b == null || a === "" || b === "") return (a ?? "") === (b ?? "");
  if (Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Number(a) === Number(b)) return true;
  return String(a) === String(b);
}

/**
 * Someone else saved this record after the form opened it.
 *
 * Inline, not a modal: this application runs in an iframe on the page that
 * generated it, where `confirm()` is not guaranteed to appear — the same reason
 * the delete and purge controls are two-step. Lists the fields the other save
 * changed (marking the ones this user changed too), then offers the two ways
 * out: reload their version, or overwrite it with this one. Overwrite is still
 * checked, against the version just read, so a third save is caught again.
 */
async function showConflict(box, { entity, id, fields, base, mine, onReload, onOverwrite }) {
  let theirs;
  try {
    theirs = await api.get(`/bus/${entity.routeName}/${id}`);
  } catch (error) {
    showProblem(box, error);
    return;
  }
  const rows = fields
    .map((field) => {
      const column = field.column_name;
      if (sameValue(base[column], theirs[column])) return null;
      const mineValue = column in mine ? mine[column] : base[column];
      const clash = !sameValue(base[column], mineValue) && !sameValue(mineValue, theirs[column]);
      return { field, theirs: theirs[column], mine: mineValue, clash };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.clash) - Number(a.clash));
  const shown = (value) => (value == null || value === "" ? "—" : displayValue(value));
  const clashes = rows.filter((row) => row.clash).length;

  mount(
    box,
    el("h4.violations__title", `This ${entity.singularName.toLowerCase()} was changed while you were editing`),
    el(
      "p",
      `Someone else saved it first (it is now at version ${theirs.version ?? "?"}). ` +
        (rows.length === 0
          ? "None of the fields on this form differ."
          : clashes
            ? `${clashes} of the fields below were changed by both of you.`
            : "They changed the fields below; you did not.")
    ),
    rows.length
      ? el(
          "table.conflict",
          el("thead", el("tr", el("th", "Field"), el("th", "Their saved value"), el("th", "Your value"))),
          el(
            "tbody",
            rows.map((row) =>
              el(
                row.clash ? "tr.conflict__clash" : "tr",
                el("td", row.field.name || row.field.column_name, row.clash ? el("small", " · both changed") : null),
                el("td", shown(row.theirs)),
                el("td", shown(row.mine))
              )
            )
          )
        )
      : null,
    el(
      "div.conflict__actions",
      el("button.btn", { type: "button", "data-action": "conflict-reload", onclick: () => onReload() }, "Reload their version"),
      el(
        "button.btn.btn--primary",
        { type: "button", "data-action": "conflict-overwrite", onclick: () => onOverwrite(theirs) },
        "Overwrite with mine"
      )
    )
  );
  box.hidden = false;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showProblem(box, error) {
  const items = error.violations?.length
    ? error.violations.map((violation) =>
        el("li", el("strong", violation.ruleId || "Rule"), ` — ${violation.message}`)
      )
    : error.detail?.length
      ? error.detail.map((line) => el("li", typeof line === "string" ? line : line.message))
      : [el("li", error.message)];

  mount(
    box,
    el("h4.violations__title", error.status === 422 ? "A business rule refused this" : "This could not be saved"),
    el("ul.violations__list", items)
  );
  box.hidden = false;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/**
 * The record's state, read-only, in the form's header.
 *
 * A state field is changed only by the application's background workflows, so
 * it is never an input: it is shown here beside the title, and as a column of
 * the list. A new record shows the state it will start in.
 */
function stateBadge(field, record, entity, isNew) {
  if (!field) return null;
  const value = isNew ? null : record[field.column_name];
  const label = value == null || value === "" ? null : title(value);
  return el(
    "span.record__state",
    {
      "data-testid": "record-state",
      title: `${field.name} — changed only by the application's workflows, never by hand`,
      "aria-label": `${field.name}: ${label ?? "set when saved"}`,
    },
    label ?? "Set when saved"
  );
}

function recordTitle(record, fields, entity) {
  const identifier = fields.find((field) =>
    ["name", "title", "code", "reference", "first_name"].includes(field.column_name)
  );
  return identifier && record[identifier.column_name]
    ? String(record[identifier.column_name])
    : entity.singularName;
}

const title = (value) =>
  String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
