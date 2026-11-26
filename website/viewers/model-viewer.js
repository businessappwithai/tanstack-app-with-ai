/**
 * The viewer page.
 *
 * `website/llmtext/llms.txt` walks a reader through the gates of authoring or
 * changing a model, and between the gates they have a partial `.eml.mmd` and
 * no way to see it. Mermaid renders the ERD and nothing else: the `%%`
 * directives that carry the rules, the workflows, the enums and the access
 * control are comments to it, which is exactly the half a reader most needs to
 * check. This page draws all of it, and re-draws on every change.
 *
 * Three ways in, in the order a reader reaches for them:
 *
 *   watch    pick the `.eml.mmd` the model is writing and the page re-reads it
 *            whenever it changes on disk. This is the one the walkthrough is
 *            written around -- the picture keeps up with the phases.
 *   open     pick or drop a file once.
 *   paste    paste the block out of a chat window.
 *
 * Watching needs the File System Access API, which is Chromium-only today. The
 * button is hidden where it is missing rather than offered and broken, and the
 * other two ways work everywhere.
 */

import { el } from "./canvas.js";
import { formatReport, inspectModel } from "./eml-model.js";
import { describeEntity, ErdViewer } from "./erd-viewer.js";
import { actionList, RuleFlowViewer, ruleSummary } from "./rules-viewer.js";
import { hookList, StateMachineViewer, sagaLadder } from "./workflow-viewer.js";

/** How often a watched file is re-read, in milliseconds. */
const WATCH_INTERVAL = 1200;

/** How long the page waits after a keystroke before re-reading the source. */
const TYPING_SETTLE = 350;

export class ModelViewer {
  constructor(root) {
    this.root = root;
    this.source = "";
    this.model = null;
    this.report = null;
    this.watchHandle = null;
    this.watchTimer = null;
    this.watchStamp = 0;
    this.selectedEntity = null;
    this.selectedRule = null;
    this.selectedWorkflow = null;
    this.entityFilter = "";

    this.applyTheme();
    this.bindShell();
    this.showEmpty();
  }

  /**
   * Light or dark, decided by the host page.
   *
   * `data-awv-theme` on the root is the page stating which one it serves, and
   * it wins: this site is dark for everybody, so following the operating
   * system there would put a white diagram on a near-black page for every
   * reader whose machine is set to light. Where the page says nothing, the
   * operating system decides, and a change to it is followed live.
   */
  applyTheme() {
    const declared = this.root.dataset.awvTheme;
    if (declared === "dark" || declared === "light") {
      this.root.classList.toggle("is-dark", declared === "dark");
      return;
    }
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => this.root.classList.toggle("is-dark", dark.matches);
    follow();
    dark.addEventListener("change", follow);
  }

  /* ---------------------------------------------------------------- shell */

  bindShell() {
    const q = (selector) => this.root.querySelector(selector);

    this.els = {
      status: q("[data-role=status]"),
      verdict: q("[data-role=verdict]"),
      diagnostics: q("[data-role=diagnostics]"),
      stats: q("[data-role=stats]"),
      tabs: this.root.querySelectorAll("[data-tab]"),
      panels: this.root.querySelectorAll("[data-panel]"),
      erd: q("[data-role=erd-canvas]"),
      erdFilter: q("[data-role=erd-filter]"),
      inspector: q("[data-role=inspector]"),
      workflowList: q("[data-role=workflow-list]"),
      workflowDetail: q("[data-role=workflow-detail]"),
      ruleList: q("[data-role=rule-list]"),
      ruleDetail: q("[data-role=rule-detail]"),
      access: q("[data-role=access]"),
      sourceView: q("[data-role=source-view]"),
      paste: q("[data-role=paste]"),
      drop: q("[data-role=drop]"),
      fileInput: q("[data-role=file-input]"),
      watchButton: q("[data-role=watch]"),
      watchState: q("[data-role=watch-state]"),
      openButton: q("[data-role=open]"),
      reportButton: q("[data-role=copy-report]"),
      examples: this.root.querySelectorAll("[data-example]"),
    };

    this.erd = new ErdViewer(this.els.erd, {
      onSelect: (name) => {
        this.selectedEntity = name;
        this.renderInspector();
      },
    });

    for (const tab of this.els.tabs) {
      tab.addEventListener("click", () => this.showTab(tab.dataset.tab));
    }

    this.els.erdFilter.addEventListener("input", () => {
      this.entityFilter = this.els.erdFilter.value;
      if (this.model) this.erd.render(this.model, this.entityFilter);
    });

    let typing = null;
    this.els.paste.addEventListener("input", () => {
      clearTimeout(typing);
      typing = setTimeout(() => this.load(this.els.paste.value, "pasted"), TYPING_SETTLE);
    });

    this.els.openButton.addEventListener("click", () => this.els.fileInput.click());
    this.els.fileInput.addEventListener("change", async () => {
      const file = this.els.fileInput.files && this.els.fileInput.files[0];
      if (file) this.load(await file.text(), file.name);
    });

    // Dropping a file anywhere on the page: the dropzone is where a reader
    // aims, but the whole surface accepts it because a missed drop that opens
    // the file in the browser loses the page and the model with it.
    for (const type of ["dragenter", "dragover"]) {
      this.root.addEventListener(type, (event) => {
        event.preventDefault();
        this.els.drop.classList.add("is-over");
      });
    }
    for (const type of ["dragleave", "drop"]) {
      this.root.addEventListener(type, (event) => {
        event.preventDefault();
        this.els.drop.classList.remove("is-over");
      });
    }
    this.root.addEventListener("drop", async (event) => {
      const file = event.dataTransfer && event.dataTransfer.files[0];
      if (file) this.load(await file.text(), file.name);
    });

    if (typeof window.showOpenFilePicker === "function") {
      this.els.watchButton.hidden = false;
      this.els.watchButton.addEventListener("click", () => this.toggleWatch());
    }

    this.els.reportButton.addEventListener("click", () => this.copyReport());

    for (const button of this.els.examples) {
      button.addEventListener("click", () => this.loadExample(button.dataset.example));
    }
  }

  showTab(name) {
    for (const tab of this.els.tabs) tab.classList.toggle("is-active", tab.dataset.tab === name);
    for (const panel of this.els.panels) panel.hidden = panel.dataset.panel !== name;
    // The canvases re-measure themselves when their panel stops being hidden;
    // see the ResizeObserver in `Canvas`. Nothing to do here.
  }

  /* ----------------------------------------------------------------- input */

  async loadExample(path) {
    this.setStatus("Loading " + path.split("/").pop() + "…");
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) {
      this.setStatus("Could not load " + path + " (" + response.status + ")", "error");
      return;
    }
    const text = await response.text();
    this.els.paste.value = text;
    this.load(text, path.split("/").pop());
  }

  /**
   * Watch a file the author is writing.
   *
   * Polled rather than subscribed: the File System Access API has no change
   * event, so `lastModified` on a re-acquired handle is the only signal there
   * is. A little over a second is fast enough to feel live and slow enough that
   * a file being rewritten in place is read after the write, not during it.
   */
  async toggleWatch() {
    if (this.watchHandle) {
      clearInterval(this.watchTimer);
      this.watchHandle = null;
      this.watchTimer = null;
      this.els.watchButton.textContent = "Watch a file";
      this.els.watchState.hidden = true;
      return;
    }

    let handle;
    try {
      const picked = await window.showOpenFilePicker({
        types: [{ description: "EML model", accept: { "text/plain": [".mmd", ".md", ".txt"] } }],
        multiple: false,
      });
      handle = picked[0];
    } catch (error) {
      // The picker throws when the reader cancels; that is not a failure.
      if (error && error.name !== "AbortError") {
        this.setStatus("Could not open that file: " + error.message, "error");
      }
      return;
    }

    this.watchHandle = handle;
    this.els.watchButton.textContent = "Stop watching";
    this.els.watchState.hidden = false;
    this.els.watchState.textContent = "Watching " + handle.name;

    const read = async () => {
      try {
        const file = await this.watchHandle.getFile();
        if (file.lastModified === this.watchStamp) return;
        this.watchStamp = file.lastModified;
        const text = await file.text();
        this.els.paste.value = text;
        this.load(text, handle.name);
        this.els.watchState.textContent =
          "Watching " + handle.name + " · updated " + new Date().toLocaleTimeString();
      } catch (error) {
        this.setStatus("Lost the watched file: " + error.message, "error");
        this.toggleWatch();
      }
    };

    await read();
    this.watchTimer = setInterval(read, WATCH_INTERVAL);
  }

  /* --------------------------------------------------------------- reading */

  /** Read a document and redraw everything. */
  load(source, label) {
    this.source = source || "";
    if (!this.source.trim()) {
      this.showEmpty();
      return;
    }

    let result;
    try {
      result = inspectModel(this.source);
    } catch (error) {
      this.setStatus("Could not read that document: " + error.message, "error");
      return;
    }

    this.model = result.model;
    this.report = result.report;
    this.root.classList.add("has-model");

    this.setStatus(
      (this.model.meta.name || label || "Model") +
        " · " +
        this.model.stats.entities +
        " entities · " +
        this.model.stats.fields +
        " columns"
    );

    this.renderVerdict();
    this.renderStats();
    this.erd.render(this.model, this.entityFilter);
    this.renderInspector();
    this.renderWorkflows();
    this.renderRules();
    this.renderAccess();
    this.els.sourceView.textContent = this.source;

    if (window.awTrack) {
      window.awTrack("model_viewed", {
        entities: this.model.stats.entities,
        relationships: this.model.stats.relationships,
        rules: this.model.stats.rules,
        state_machines: this.model.stats.stateMachines,
        sagas: this.model.stats.sagas,
        errors: this.report.counts.errors,
        warnings: this.report.counts.warnings,
      });
    }
  }

  showEmpty() {
    this.model = null;
    this.report = null;
    this.root.classList.remove("has-model");
    this.setStatus("Paste a model, open one, or watch the file your assistant is writing.");
  }

  setStatus(text, tone) {
    this.els.status.textContent = text;
    this.els.status.className = "awv-status" + (tone ? " is-" + tone : "");
  }

  /* --------------------------------------------------------------- drawing */

  renderVerdict() {
    const counts = this.report.counts;
    this.els.verdict.className =
      "awv-verdict " + (this.report.ok ? (counts.warnings ? "is-warned" : "is-ok") : "is-failed");
    this.els.verdict.textContent = this.report.ok
      ? "Checker: OK — " + counts.errors + " errors, " + counts.warnings + " warnings"
      : "Checker: FAILED — " + counts.errors + " errors, " + counts.warnings + " warnings";

    this.els.diagnostics.innerHTML = "";
    const issues = this.report.issues.slice(0, 40);
    for (const issue of issues) {
      const row = el("li", "awv-diagnostic is-" + issue.severity);
      row.append(el("code", "awv-diagnostic-code", issue.code));
      row.append(
        el(
          "span",
          "awv-diagnostic-message",
          (issue.line ? "line " + issue.line + ": " : "") + issue.message
        )
      );
      if (issue.autoFixable) row.append(el("span", "awv-badge is-fixable", "fixer repairs this"));
      this.els.diagnostics.append(row);
    }
    if (this.report.issues.length > issues.length) {
      this.els.diagnostics.append(
        el("li", "awv-diagnostic", "+" + (this.report.issues.length - issues.length) + " more")
      );
    }

    // The compilers' own warnings sit with the checker's: "workflow X targets
    // unknown entity Y" is why a section the author just wrote is not drawn,
    // and it is not a diagnostic the checker produces.
    for (const warning of this.model.warnings) {
      const row = el("li", "awv-diagnostic is-warning");
      row.append(el("code", "awv-diagnostic-code", "reader"));
      row.append(el("span", "awv-diagnostic-message", warning));
      this.els.diagnostics.append(row);
    }
  }

  renderStats() {
    const stats = this.model.stats;
    const cells = [
      ["Entities", stats.entities],
      ["Columns", stats.fields],
      ["Relationships", stats.relationships],
      ["Enums", stats.enums],
      ["Rules", stats.rules],
      ["Hooks", stats.hooks],
      ["State machines", stats.stateMachines],
      ["Sagas", stats.sagas],
      ["Roles", stats.roles],
      ["Access rules", stats.accessRules],
    ];
    this.els.stats.innerHTML = "";
    for (const [label, value] of cells) {
      const cell = el("div", "awv-stat");
      cell.append(el("span", "awv-stat-value", String(value)));
      cell.append(el("span", "awv-stat-label", label));
      if (value === 0) cell.classList.add("is-zero");
      this.els.stats.append(cell);
    }
  }

  renderInspector() {
    const host = this.els.inspector;
    host.innerHTML = "";

    if (!this.model || !this.selectedEntity) {
      host.append(
        el(
          "p",
          "awv-hint",
          "Click an entity to see its relationships, the rules and hooks bound to it, and who may read it. Double-click one to show every column."
        )
      );
      return;
    }

    const detail = describeEntity(this.model, this.selectedEntity);
    if (!detail) {
      this.selectedEntity = null;
      return this.renderInspector();
    }

    host.append(el("h3", "awv-inspector-title", detail.entity.name));
    host.append(el("code", "awv-inspector-table", detail.entity.tableName));
    if (detail.entity.description) {
      host.append(el("p", "awv-inspector-help", detail.entity.description));
    }

    const section = (title, body) => {
      if (!body) return;
      const wrapper = el("section", "awv-inspector-section");
      wrapper.append(el("h4", null, title));
      wrapper.append(body);
      host.append(wrapper);
    };

    if (detail.links.length) {
      const list = el("ul", "awv-inspector-list");
      for (const link of detail.links) {
        const item = el("li");
        item.append(el("span", "awv-link-arrow", link.outgoing ? "→" : "←"));
        item.append(el("strong", null, link.other));
        item.append(el("span", "awv-link-card", link.cardinality));
        item.append(el("span", "awv-link-name", link.name));
        if (link.foreignKey) item.append(el("code", "awv-link-fk", link.foreignKey));
        list.append(item);
      }
      section("Relationships", list);
    }

    if (detail.workflows.length) {
      const list = el("ul", "awv-inspector-list");
      for (const workflow of detail.workflows) {
        const item = el("li");
        item.append(el("strong", null, workflow.name));
        item.append(
          el(
            "span",
            "awv-inspector-note",
            workflow.states.length +
              " states, " +
              workflow.transitions.length +
              " moves" +
              (workflow.statusColumn ? " on " + workflow.statusColumn : "")
          )
        );
        item.addEventListener("click", () => {
          this.selectedWorkflow = "state:" + workflow.name;
          this.renderWorkflows();
          this.showTab("workflows");
        });
        item.classList.add("is-clickable");
        list.append(item);
      }
      section("State machines", list);
    }

    if (detail.sagas.length) {
      const list = el("ul", "awv-inspector-list");
      for (const saga of detail.sagas) {
        const item = el("li", "is-clickable");
        item.append(el("strong", null, saga.name));
        item.append(el("span", "awv-inspector-note", saga.steps.length + " steps"));
        item.addEventListener("click", () => {
          this.selectedWorkflow = "saga:" + saga.name;
          this.renderWorkflows();
          this.showTab("workflows");
        });
        list.append(item);
      }
      section("Sagas", list);
    }

    if (detail.rules.length) {
      const list = el("ul", "awv-inspector-list");
      for (const rule of detail.rules) {
        const item = el("li", "is-clickable");
        item.append(el("strong", null, rule.name));
        item.append(el("span", "awv-inspector-note", rule.event + " · " + rule.operation));
        item.addEventListener("click", () => {
          this.selectedRule = rule.name;
          this.renderRules();
          this.showTab("rules");
        });
        list.append(item);
      }
      section("Rules", list);
    }

    if (detail.hooks.length) section("Lifecycle hooks", hookList(detail.hooks));

    if (detail.access.length) {
      const list = el("ul", "awv-inspector-list");
      for (const rule of detail.access) {
        const item = el("li");
        item.append(el("code", "awv-access-op", rule.operation));
        item.append(el("span", null, rule.roles.join(", ")));
        list.append(item);
      }
      section("Who may do what", list);
    } else {
      section(
        "Who may do what",
        el(
          "p",
          "awv-hint",
          "No %%rbac directive names this entity, so every signed-in user may read and write it."
        )
      );
    }
  }

  renderWorkflows() {
    const list = this.els.workflowList;
    list.innerHTML = "";

    const entries = [];
    for (const workflow of this.model.workflows) {
      entries.push({ key: "state:" + workflow.name, kind: "state", item: workflow });
    }
    for (const saga of this.model.sagas) {
      entries.push({ key: "saga:" + saga.name, kind: "saga", item: saga });
    }
    if (this.model.hooks.length) entries.push({ key: "hooks", kind: "hooks", item: null });

    if (entries.length === 0) {
      list.append(
        el("p", "awv-hint", "This model declares no workflows yet — no %%workflow, no %%hook.")
      );
      this.els.workflowDetail.innerHTML = "";
      return;
    }

    if (!entries.some((entry) => entry.key === this.selectedWorkflow)) {
      this.selectedWorkflow = entries[0].key;
    }

    for (const entry of entries) {
      const button = el("button", "awv-list-item");
      button.type = "button";
      button.classList.toggle("is-active", entry.key === this.selectedWorkflow);
      if (entry.kind === "hooks") {
        button.append(el("span", "awv-list-kind is-hook", "hooks"));
        button.append(el("span", "awv-list-name", "Lifecycle handlers"));
        button.append(el("span", "awv-list-note", this.model.hooks.length + " declared"));
      } else if (entry.kind === "state") {
        button.append(el("span", "awv-list-kind is-state", "state"));
        button.append(el("span", "awv-list-name", entry.item.name));
        button.append(
          el(
            "span",
            "awv-list-note",
            entry.item.entity + " · " + entry.item.states.length + " states"
          )
        );
        if (entry.item.undeclaredStates.length) {
          button.append(el("span", "awv-badge is-problem", "undeclared states"));
        }
      } else {
        button.append(el("span", "awv-list-kind is-saga", "saga"));
        button.append(el("span", "awv-list-name", entry.item.name));
        button.append(
          el(
            "span",
            "awv-list-note",
            entry.item.entity + " · " + entry.item.steps.length + " steps"
          )
        );
        if (entry.item.steps.some((step) => step.missing.length)) {
          button.append(el("span", "awv-badge is-problem", "incomplete step"));
        }
      }
      button.addEventListener("click", () => {
        this.selectedWorkflow = entry.key;
        this.renderWorkflows();
      });
      list.append(button);
    }

    const selected = entries.find((entry) => entry.key === this.selectedWorkflow);
    const host = this.els.workflowDetail;
    host.innerHTML = "";
    this.stateViewer = null;

    if (selected.kind === "hooks") {
      host.append(
        el(
          "p",
          "awv-hint",
          "Each handler is generated as a module the service calls at that point of the write. They run in the order the model declares them."
        )
      );
      host.append(hookList(this.model.hooks));
      return;
    }

    if (selected.kind === "state") {
      const machine = selected.item;
      const header = el("div", "awv-detail-head");
      header.append(el("h3", null, machine.title || machine.name));
      header.append(
        el(
          "p",
          "awv-detail-note",
          machine.statusColumn
            ? "Writes " +
                machine.entity +
                "." +
                machine.statusColumn +
                ". Every arrow is a move the generated API allows; a move with no arrow is refused with a 403, for every caller including the administrator."
            : "No column of " +
                machine.entity +
                " is bound to an enum carrying these states, so the generated application has nowhere to store them."
        )
      );
      host.append(header);

      if (machine.undeclaredStates.length) {
        host.append(
          el(
            "p",
            "awv-detail-problem",
            "Not declared by any %%enum: " +
              machine.undeclaredStates.join(", ") +
              ". A record can never hold these, so the moves onto them are dead."
          )
        );
      }

      const canvasHost = el("div", "awv-detail-canvas");
      host.append(canvasHost);
      this.stateViewer = new StateMachineViewer(canvasHost);
      this.stateViewer.render(machine);
      return;
    }

    const saga = selected.item;
    const header = el("div", "awv-detail-head");
    header.append(el("h3", null, saga.title || saga.name));
    header.append(
      el(
        "p",
        "awv-detail-note",
        saga.trigger === "rule"
          ? "Runs when a business rule emits trigger-workflow " + saga.name + "."
          : "Runs automatically on every " +
              saga.operation.toLowerCase() +
              " of " +
              saga.entity +
              "."
      )
    );
    host.append(header);
    host.append(sagaLadder(saga));
  }

  renderRules() {
    const list = this.els.ruleList;
    list.innerHTML = "";

    if (this.model.rules.length === 0) {
      list.append(el("p", "awv-hint", "This model declares no %%rule sections yet."));
      this.els.ruleDetail.innerHTML = "";
      return;
    }

    if (!this.model.rules.some((rule) => rule.name === this.selectedRule)) {
      this.selectedRule = this.model.rules[0].name;
    }

    for (const rule of this.model.rules) {
      const button = el("button", "awv-list-item");
      button.type = "button";
      button.classList.toggle("is-active", rule.name === this.selectedRule);
      button.append(el("span", "awv-list-kind is-rule", rule.operation.toLowerCase()));
      button.append(el("span", "awv-list-name", rule.name));
      button.append(el("span", "awv-list-note", rule.entity + " · " + rule.event));
      if (rule.actions.length) {
        button.append(el("span", "awv-badge is-actions", rule.actions.length + " actions"));
      }
      if (!rule.compiled) button.append(el("span", "awv-badge is-problem", "not compiled"));
      button.addEventListener("click", () => {
        this.selectedRule = rule.name;
        this.renderRules();
      });
      list.append(button);
    }

    const rule = this.model.rules.find((candidate) => candidate.name === this.selectedRule);
    const host = this.els.ruleDetail;
    host.innerHTML = "";

    const header = el("div", "awv-detail-head");
    header.append(el("h3", null, rule.title || rule.name));
    header.append(ruleSummary(rule));
    host.append(header);

    const canvasHost = el("div", "awv-detail-canvas");
    host.append(canvasHost);
    this.ruleViewer = new RuleFlowViewer(canvasHost);
    this.ruleViewer.render(rule);

    const actions = el("section", "awv-detail-actions");
    actions.append(el("h4", null, "What the rule emits"));
    actions.append(actionList(rule.actions));
    host.append(actions);
  }

  renderAccess() {
    const host = this.els.access;
    host.innerHTML = "";

    const access = this.model.access;
    if (!access.scoped) {
      host.append(
        el(
          "p",
          "awv-hint",
          "This model declares no %%rbac read rule, so every signed-in user sees every entity. Naming the roles a business has, and giving each entity a %%rbac … .read directive, is what turns the generated application into one where a support agent and a sales manager see different screens."
        )
      );
    }

    const table = el("table", "awv-access-table");
    const head = el("thead");
    const headRow = el("tr");
    headRow.append(
      el("th", null, "Role"),
      el("th", null, "Signs in as"),
      el("th", null, "Entities it can read")
    );
    head.append(headRow);
    table.append(head);

    const body = el("tbody");
    for (const role of access.roles) {
      const row = el("tr");
      if (role.isAdmin) row.classList.add("is-admin");
      row.append(el("td", null, role.name));
      const user = access.users.find((candidate) => candidate.roleName === role.name);
      row.append(el("td", null, user ? user.email : "—"));
      const count = access.entityCounts[role.name];
      row.append(
        el(
          "td",
          "awv-access-count",
          count === undefined ? "—" : count + " of " + this.model.stats.entities
        )
      );
      body.append(row);
    }
    table.append(body);
    host.append(table);

    if (this.model.rbac.transitions.length) {
      const section = el("section", "awv-access-transitions");
      section.append(el("h4", null, "Moves restricted by role"));
      const list = el("ul", "awv-inspector-list");
      for (const rule of this.model.rbac.transitions) {
        const item = el("li");
        item.append(el("strong", null, rule.entity + " · " + rule.transition));
        item.append(
          el(
            "span",
            "awv-inspector-note",
            rule.edges.map((edge) => edge.from + " → " + edge.to).join(", ")
          )
        );
        item.append(el("span", "awv-access-roles", rule.roles.join(", ")));
        list.append(item);
      }
      section.append(list);
      host.append(section);
    }
  }

  /** The checker's report, as text, for pasting back to whoever wrote the model. */
  async copyReport() {
    if (!this.report) return;
    const text = formatReport(this.report);
    try {
      await navigator.clipboard.writeText(text);
      this.els.reportButton.textContent = "Report copied";
    } catch {
      // Refused in a private window or over plain http. Show it instead of
      // failing silently: the reader can still select it.
      this.els.sourceView.textContent = text;
      this.showTab("source");
      this.els.reportButton.textContent = "Report shown below";
    }
    setTimeout(() => {
      this.els.reportButton.textContent = "Copy the checker's report";
    }, 2500);
  }
}
