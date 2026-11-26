/**
 * The admin screens' shared editor: one form builder and one two-step delete.
 *
 * The dictionary, the rules, the processes and the reports all now offer
 * create, edit and delete, and all four want the same three things — a form
 * whose fields come from a description rather than from markup, a save that
 * reports the server's refusal rather than swallowing it, and a delete that
 * cannot happen on one misplaced click. Written once here rather than four
 * times, because four copies is how three of them come to disagree about what
 * "cancel" does.
 *
 * ## No `confirm()` and no `prompt()`
 *
 * This application runs inside an iframe on the page that generated it, and a
 * modal dialog is not guaranteed to appear there — the same reason the
 * dashboard's purge control is two-step rather than a `confirm()`. So a delete
 * arms itself on the first click and commits on the second, and anything that
 * needs typing gets a real field in a real form.
 *
 * ## The server is the validator
 *
 * These forms check almost nothing. Every rule about what a rule, a workflow or
 * a report may contain lives in the routes — the six events the engine
 * dispatches on, the read-only SQL guard, a chart needing both axes — and a
 * second copy here would be a second answer that drifts. What the form does is
 * put the server's refusal where the reader can act on it: beside the field
 * they are editing, not in a toast that vanishes.
 */

import { el, mount, toast } from "./dom.js";

/**
 * Build a form from a field description.
 *
 * `fields` is an array of `{ name, label, type, options, hint, rows, required }`.
 * `type` is one of `text`, `number`, `textarea`, `select`, `checkbox`; anything
 * else renders as `text`, because a typo in a field description should cost a
 * plain input rather than a blank screen.
 *
 * `onSave` receives the collected values and may throw — the message is shown
 * in the form and the form stays open with what the reader typed still in it.
 * That is the whole reason this returns a node rather than a promise: a save
 * that fails must not lose the work.
 */
export function editorForm({ title, lede, fields, values = {}, saveLabel = "Save", onSave, onCancel }) {
  const inputs = new Map();
  const error = el("p.editor__error", { hidden: true });

  const controls = fields.map((field) => {
    const id = `editor-${field.name}`;
    const current = values[field.name];
    let input;

    if (field.type === "textarea") {
      input = el("textarea.field__input.field__input--code", {
        id,
        rows: field.rows ?? 8,
        spellcheck: "false",
      });
      input.value = current == null ? "" : String(current);
    } else if (field.type === "select") {
      input = el(
        "select.field__input",
        { id },
        ...(field.options || []).map((option) => {
          const value = typeof option === "string" ? option : option.value;
          const label = typeof option === "string" ? option : option.label;
          const node = el("option", { value }, label);
          if (String(current ?? "") === String(value)) node.selected = true;
          return node;
        })
      );
    } else if (field.type === "checkbox") {
      input = el("input", { id, type: "checkbox" });
      input.checked = current !== false;
    } else {
      input = el("input.field__input", {
        id,
        type: field.type === "number" ? "number" : "text",
      });
      input.value = current == null ? "" : String(current);
    }

    inputs.set(field.name, { input, field });

    return el(
      "div.field",
      el(
        "div.field__head",
        el("label.field__label", { for: id }, field.label),
        field.required ? el("span.chip.chip--text", "Required") : null
      ),
      input,
      field.hint ? el("p.field__hint", field.hint) : null
    );
  });

  function collect() {
    const out = {};
    for (const [name, { input, field }] of inputs) {
      if (field.type === "checkbox") {
        out[name] = input.checked;
        continue;
      }
      const raw = input.value;
      if (field.type === "number") {
        out[name] = raw === "" ? undefined : Number(raw);
        continue;
      }
      const text = typeof raw === "string" ? raw.trim() : raw;
      /* An empty optional field is sent as "" rather than omitted, so clearing
         one actually clears it — `undefined` would leave the old value in
         place, which reads as the save having silently failed. */
      out[name] = field.required && text === "" ? "" : text;
    }
    return out;
  }

  const save = el("button.btn.btn--primary", { type: "submit" }, saveLabel);
  const form = el(
    "form.editor",
    {
      onsubmit: async (event) => {
        event.preventDefault();
        error.hidden = true;
        save.disabled = true;
        save.textContent = "Saving…";
        try {
          await onSave(collect());
        } catch (failure) {
          /* The server's own words. It knows why it refused and this screen
             does not, so paraphrasing here can only lose information. */
          error.textContent = failure?.message || String(failure);
          error.hidden = false;
          save.disabled = false;
          save.textContent = saveLabel;
        }
      },
    },
    el("h3.section-title", title),
    lede ? el("p.lede", lede) : null,
    ...controls,
    error,
    el(
      "div.editor__actions",
      save,
      el("button.btn", { type: "button", onclick: () => onCancel?.() }, "Cancel")
    )
  );

  /* Focus the first field so a keyboard reader can start typing, and so opening
     the form is visibly *about* that form rather than a section that appeared
     somewhere on the page. */
  queueMicrotask(() => inputs.values().next().value?.input?.focus());
  return form;
}

/**
 * A delete that takes two clicks.
 *
 * The first arms it and says what will happen; the second does it. A third
 * click anywhere else disarms it, because a control left armed across a scroll
 * is a control waiting to be hit by accident.
 */
export function deleteButton(label, description, onDelete) {
  const button = el("button.btn.btn--danger.btn--small", { type: "button" }, label);
  let armed = false;

  const disarm = () => {
    armed = false;
    button.textContent = label;
    button.classList.remove("is-armed");
    document.removeEventListener("click", away, true);
  };
  const away = (event) => {
    if (event.target !== button) disarm();
  };

  button.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      button.textContent = description || "Really delete?";
      button.classList.add("is-armed");
      document.addEventListener("click", away, true);
      return;
    }
    disarm();
    button.disabled = true;
    try {
      await onDelete();
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
    }
  });

  return button;
}

/**
 * Put an editor where the reader is looking.
 *
 * The form replaces the panel's contents rather than appearing above or below
 * it: on a list of thirty reports, a form rendered at the top is a form the
 * reader has to go and find.
 */
export function openEditor(host, form) {
  mount(host, form);
  host.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
