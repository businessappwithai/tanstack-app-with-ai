/**
 * Enterprise Reporting's Administration section, in the browser preview.
 *
 * Users, Roles, Permissions, Data Sources and System Logs — the five of the
 * platform's seven administration screens that a browser tab can honestly
 * offer, because the data behind them is here: `rpt_user`, `rpt_role`,
 * `rpt_role_tables` (enforced on every reporting request) and
 * `rpt_activity_log`. Each is drawn after the platform's own page — its title,
 * its description, its columns — and each writes through `/report-admin`,
 * which refuses anyone who is not a reporting administrator.
 *
 * Trigger Board and Settings are the two that are not here. One is the
 * platform's job queue and the other its server configuration, and neither
 * exists in a tab; they open the page that says where the real ones are.
 *
 * No `confirm()` and no `prompt()`: this application runs in an iframe on the
 * page that generated it, where a modal dialog is not guaranteed to appear. A
 * delete is two clicks on the same button, and a form is a dialog drawn here.
 */

import { el, mount, toast } from "../dom.js";
import { reportApi } from "../api.js";
import {
  alert,
  badge,
  button,
  card,
  cardContent,
  cardHeader,
  emptyState,
  icon,
  loading,
  pageHeader,
  table,
} from "./er-kit.js";

const when = (value) => (value ? new Date(value).toLocaleString() : "—");
const day = (value) => (value ? new Date(value).toLocaleDateString() : "—");

/** A delete that asks twice by changing its own label, then reverts. */
function deleteButton(onConfirm) {
  let armed = false;
  let timer = null;
  const node = button("Delete", { variant: "ghost", size: "sm" });
  node.classList.add("er-btn--danger");
  node.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!armed) {
      armed = true;
      node.textContent = "Confirm delete";
      node.classList.add("is-armed");
      timer = setTimeout(() => {
        armed = false;
        node.textContent = "Delete";
        node.classList.remove("is-armed");
      }, 4000);
      return;
    }
    clearTimeout(timer);
    node.disabled = true;
    await onConfirm();
  });
  return node;
}

/**
 * `components/ui/dialog.tsx`, as a panel over the page. Returns a closer.
 * `fields` is [{ name, label, type, value, options }]; `onSubmit` gets the
 * values and throws to keep the dialog open with the server's refusal in it.
 */
function dialog({ title, description, fields, submitLabel, onSubmit }) {
  const inputs = new Map();
  const errorSlot = el("div");
  const submit = el("button.er-btn.er-btn--default.er-btn--size-default", { type: "submit" }, submitLabel);

  const body = fields.map((field) => {
    let input;
    if (field.type === "select") {
      input = el(
        "select.er-select",
        { id: `erf-${field.name}` },
        ...field.options.map((option) => el("option", { value: option.value }, option.label))
      );
      input.value = field.value ?? "";
    } else {
      input = el("input.er-input", {
        id: `erf-${field.name}`,
        type: field.type || "text",
        value: field.value ?? "",
        placeholder: field.placeholder ?? null,
        autocomplete: field.type === "password" ? "new-password" : "off",
      });
    }
    inputs.set(field.name, input);
    return el(
      "div.er-field",
      el("label.er-label-strong", { for: `erf-${field.name}` }, field.label),
      input,
      field.hint ? el("p.er-label", field.hint) : null
    );
  });

  const overlay = el("div.er-dialog-overlay");
  const close = () => overlay.remove();
  const form = el(
    "form.er-card.er-dialog",
    {
      role: "dialog",
      "aria-modal": "true",
      "aria-label": title,
      onsubmit: async (event) => {
        event.preventDefault();
        submit.disabled = true;
        mount(errorSlot);
        const values = Object.fromEntries([...inputs].map(([name, input]) => [name, input.value]));
        try {
          await onSubmit(values);
          close();
        } catch (error) {
          mount(errorSlot, alert(error.message || String(error), null, "destructive"));
          submit.disabled = false;
        }
      },
    },
    el(
      "div.er-card__header",
      el("h2.er-card__title", title),
      description ? el("p.er-card__description", description) : null
    ),
    el("div.er-card__content.er-dialog__body", errorSlot, ...body),
    el(
      "div.er-card__footer.er-dialog__footer",
      button("Cancel", { variant: "outline", onclick: close }),
      submit
    )
  );
  overlay.appendChild(form);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  (document.querySelector(".er") ?? document.body).appendChild(overlay);
  inputs.values().next().value?.focus();
  return close;
}

function titled(iconName, text) {
  return el("span.er-titled", icon(iconName, "er-icon--md"), text);
}

// ─── Users — admin/users/index.tsx ───────────────────────────────────────────

export async function usersPage(main, { me, rerender }) {
  mount(main, el("div.er-stack", pageHeader("User Management", "Manage user accounts and assign roles"), card(loading())));
  const [users, roles] = await Promise.all([reportApi.get("/report-admin/users"), reportApi.get("/report-admin/roles")]);
  const roleOptions = [{ value: "", label: "No role — reads nothing" }, ...roles.map((role) => ({ value: role.id, label: role.name }))];

  const addUser = () =>
    dialog({
      title: "Add User",
      description: "A reporting account. It signs into this reporting application only, never the application it reports on.",
      submitLabel: "Create User",
      fields: [
        { name: "name", label: "Name", placeholder: "Jane Doe" },
        { name: "email", label: "Email", type: "email", placeholder: "name@example.com" },
        { name: "password", label: "Password", type: "password", hint: "At least five characters." },
        { name: "roleId", label: "Role", type: "select", options: roleOptions, value: "" },
      ],
      onSubmit: async (values) => {
        await reportApi.post("/report-admin/users", { ...values, roleId: values.roleId || null });
        toast("User created", "success");
        await rerender();
      },
    });

  const editUser = (user) =>
    dialog({
      title: `Edit ${user.name}`,
      description: user.email,
      submitLabel: "Save Changes",
      fields: [
        { name: "name", label: "Name", value: user.name },
        { name: "roleId", label: "Role", type: "select", options: roleOptions, value: user.roleId ?? "" },
        { name: "password", label: "New password", type: "password", hint: "Leave empty to keep the current one." },
      ],
      onSubmit: async (values) => {
        const changes = { name: values.name };
        if ((values.roleId || null) !== (user.roleId ?? null)) changes.roleId = values.roleId || null;
        if (values.password) changes.password = values.password;
        await reportApi.patch(`/report-admin/users/${user.id}`, changes);
        toast("User updated", "success");
        await rerender();
      },
    });

  const toggleActive = async (user) => {
    try {
      await reportApi.patch(`/report-admin/users/${user.id}`, { isActive: !user.isActive });
      toast(user.isActive ? "User deactivated" : "User activated", "success");
      await rerender();
    } catch (error) {
      toast(error.message, "error");
    }
  };

  mount(
    main,
    el(
      "div.er-stack",
      pageHeader("User Management", "Manage user accounts and assign roles", {
        actions: button("Add User", { iconName: "users", onclick: addUser }),
      }),
      card(
        cardHeader(titled("users", `Users (${users.length})`)),
        el(
          "div.er-card__flush",
          table(
            ["Name", "Email", "Status", "Roles", "Last sign-in", "Created", "Actions"],
            users.map((user) => [
              el("span.er-strong", user.name, user.id === me.id ? el("span.er-label", " (you)") : null),
              user.email,
              user.isActive ? badge("Active", "default") : badge("Inactive", "neutral"),
              user.role ? badge(user.role, user.isAdmin ? "default" : "secondary") : badge("No role", "outline"),
              when(user.lastSignIn),
              day(user.createdAt),
              el(
                "div.er-rowactions",
                button("Edit", { variant: "ghost", size: "sm", onclick: () => editUser(user) }),
                user.id === me.id
                  ? null
                  : button(user.isActive ? "Deactivate" : "Activate", {
                      variant: "ghost",
                      size: "sm",
                      onclick: () => toggleActive(user),
                    }),
                user.id === me.id
                  ? null
                  : deleteButton(async () => {
                      try {
                        await reportApi.delete(`/report-admin/users/${user.id}`);
                        toast("User deleted", "success");
                      } catch (error) {
                        toast(error.message, "error");
                      }
                      await rerender();
                    })
              ),
            ])
          )
        )
      )
    )
  );
}

// ─── Roles — admin/roles/index.tsx ───────────────────────────────────────────

export async function rolesPage(main, { rerender, href, tableTotal }) {
  mount(main, el("div.er-stack", pageHeader("Role Management", "Manage roles and their granular permissions"), card(loading())));
  const roles = await reportApi.get("/report-admin/roles");

  const roleForm = (role) =>
    dialog({
      title: role ? `Edit ${role.name}` : "Create Role",
      description: role
        ? null
        : "A new reporting role reads nothing until it is granted tables under Permissions.",
      submitLabel: role ? "Save Changes" : "Create Role",
      fields: [
        { name: "name", label: "Role Name", value: role?.name ?? "" },
        { name: "description", label: "Description", value: role?.description ?? "" },
      ],
      onSubmit: async (values) => {
        if (role) await reportApi.patch(`/report-admin/roles/${role.id}`, values);
        else await reportApi.post("/report-admin/roles", values);
        toast(role ? "Role updated" : "Role created", "success");
        await rerender();
      },
    });

  mount(
    main,
    el(
      "div.er-stack",
      pageHeader("Role Management", "Manage roles and their granular permissions", {
        actions: button("Create Role", { iconName: "shield", onclick: () => roleForm(null) }),
      }),
      alert(
        "Roles mirror the model",
        "Each seeded role is one %%rbac role of the application, with the same name. A reporting role decides " +
          "which of the application's tables its queries may read — change that under Permissions, and it " +
          "applies to the next query."
      ),
      card(
        cardHeader(titled("shield", `Roles (${roles.length})`)),
        el(
          "div.er-card__flush",
          table(
            ["Role Name", "Description", "Permissions", "Users", "Actions"],
            roles.map((role) => [
              el(
                "div",
                el("span.er-strong", role.name),
                role.declaredAs ? el("div.er-label", `%%rbac ${role.declaredAs}`) : null
              ),
              el("span.er-clamp", role.description || "-"),
              role.isAdmin
                ? badge("All tables · admin:*", "default")
                : el(
                    "a.er-badge.er-badge--secondary",
                    { href: href("permissions", role.id) },
                    `${role.tables.length} of ${tableTotal} tables`
                  ),
              String(role.users),
              el(
                "div.er-rowactions",
                button("Edit", { variant: "ghost", size: "sm", onclick: () => roleForm(role) }),
                role.isAdmin
                  ? null
                  : el("a.er-btn.er-btn--ghost.er-btn--size-sm", { href: href("permissions", role.id) }, "Permissions"),
                role.isAdmin
                  ? null
                  : deleteButton(async () => {
                      try {
                        await reportApi.delete(`/report-admin/roles/${role.id}`);
                        toast("Role deleted — its users now hold no role", "success");
                      } catch (error) {
                        toast(error.message, "error");
                      }
                      await rerender();
                    })
              ),
            ])
          )
        )
      )
    )
  );
}

// ─── Permissions — admin/permissions/index.tsx ───────────────────────────────

export async function permissionsPage(main, { rerender, href, selectedRoleId }) {
  mount(main, el("div.er-stack", pageHeader("Permission Management", "Manage resource-level permissions for roles"), card(loading())));
  const [roles, sources] = await Promise.all([
    reportApi.get("/report-admin/roles"),
    reportApi.get("/report-admin/data-sources"),
  ]);
  const tables = sources[0]?.tables ?? [];
  const scoped = roles.filter((role) => !role.isAdmin);
  const role = scoped.find((candidate) => candidate.id === selectedRoleId) ?? scoped[0] ?? null;

  const header = pageHeader("Permission Management", "Manage resource-level permissions for roles");
  if (!role) {
    return void mount(main, el("div.er-stack", header, card(cardContent(emptyState("No scoped roles", "Create a role first.")))));
  }

  const picker = el(
    "select.er-select.er-select--inline",
    {
      "aria-label": "Role",
      onchange: (event) => {
        window.location.hash = href("permissions", event.currentTarget.value);
      },
    },
    ...scoped.map((candidate) => el("option", { value: candidate.id }, candidate.name))
  );
  picker.value = role.id;

  const granted = new Set(role.tables);
  const boxes = new Map();
  const counter = el("span.er-label");
  const recount = () => {
    const count = [...boxes.values()].filter((box) => box.checked).length;
    counter.textContent = `${count} of ${tables.length} tables selected`;
  };

  // Grouped by the model's categories, which is how the application's own
  // dashboard groups the same entities.
  const groups = new Map();
  for (const tableInfo of tables) {
    const key = tableInfo.category || "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tableInfo);
  }

  const save = button("Save Permissions", {
    onclick: async () => {
      save.disabled = true;
      try {
        const chosen = [...boxes].filter(([, box]) => box.checked).map(([name]) => name);
        await reportApi.put(`/report-admin/roles/${role.id}/tables`, { tables: chosen });
        toast(`${role.name} may now read ${chosen.length} table${chosen.length === 1 ? "" : "s"}`, "success");
        await rerender();
      } catch (error) {
        toast(error.message, "error");
        save.disabled = false;
      }
    },
  });

  mount(
    main,
    el(
      "div.er-stack",
      header,
      card(
        cardHeader(
          titled("shield", "Table access"),
          "Which of the application's tables this role's queries may read — permission level select. " +
            "A report, chart or dashboard tile whose query names any other table is not offered to the role, " +
            "and is refused if asked for.",
          el("div.er-inline", el("span.er-label", "Role"), picker)
        ),
        cardContent(
          ...[...groups].map(([group, members]) =>
            el(
              "fieldset.er-grantgroup",
              el("legend.er-nav__heading", group),
              el(
                "div.er-grantgrid",
                ...members.map((tableInfo) => {
                  const box = el("input", { type: "checkbox", checked: granted.has(tableInfo.table), onchange: recount });
                  boxes.set(tableInfo.table, box);
                  return el(
                    "label.er-grant",
                    box,
                    el(
                      "span",
                      el("span.er-strong", tableInfo.displayName),
                      el("span.er-label.er-block", `${tableInfo.table} · ${tableInfo.rows ?? "?"} rows`)
                    )
                  );
                })
              )
            )
          ),
          el("div.er-toolbar.er-mt", save, counter)
        )
      )
    )
  );
  recount();
}

// ─── Data Sources — data-sources/index.tsx ───────────────────────────────────

export async function dataSourcesPage(main) {
  const title = "Data Sources";
  const description = "Manage database connections for reports and queries";
  mount(main, el("div.er-stack", pageHeader(title, description), card(loading())));
  const sources = await reportApi.get("/report-admin/data-sources");

  mount(
    main,
    el(
      "div.er-stack",
      pageHeader(title, description),
      card(
        el(
          "div.er-card__flush",
          table(
            ["Name", "Type", "Description", "Status", "Tables"],
            sources.map((source) => [
              el("span.er-strong", source.name),
              badge("PostgreSQL", "outline"),
              el("span.er-clamp", source.description || "-"),
              badge("Connected", "default"),
              String(source.tables.length),
            ])
          )
        )
      ),
      ...sources.map((source) =>
        card(
          cardHeader(
            titled("database", `${source.name} — entities`),
            `${source.engine}. The platform registers this same database as its data source, with its ` +
              "connection details encrypted; here it is the database in this tab."
          ),
          el(
            "div.er-card__flush",
            table(
              ["Entity", "Table", "Category", "Rows", "Description"],
              source.tables.map((tableInfo) => [
                el("span.er-strong", tableInfo.displayName),
                el("code", tableInfo.table),
                tableInfo.category || "-",
                tableInfo.rows === null ? "—" : tableInfo.rows.toLocaleString(),
                el("span.er-clamp", tableInfo.description || "-"),
              ])
            )
          )
        )
      )
    )
  );
}

// ─── System Logs — logs.tsx ──────────────────────────────────────────────────

const OUTCOME_BADGE = { ok: ["OK", "default"], refused: ["Refused", "warning"], failed: ["Failed", "destructive"] };

export async function logsPage(main, { rerender }) {
  const title = "System Logs";
  const description = "View system logs and debugging information";
  mount(main, el("div.er-stack", pageHeader(title, description), card(loading())));
  const filter = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("outcome") ?? "";
  const logs = await reportApi.get(`/report-admin/logs${filter ? `?outcome=${encodeURIComponent(filter)}` : ""}`);

  const picker = el(
    "select.er-select.er-select--inline",
    {
      "aria-label": "Outcome",
      onchange: (event) => {
        const value = event.currentTarget.value;
        window.location.hash = `#/report/logs${value ? `?outcome=${value}` : ""}`;
      },
    },
    el("option", { value: "" }, "All outcomes"),
    el("option", { value: "ok" }, "OK"),
    el("option", { value: "refused" }, "Refused"),
    el("option", { value: "failed" }, "Failed")
  );
  picker.value = filter;

  mount(
    main,
    el(
      "div.er-stack",
      pageHeader(title, description, {
        actions: [picker, button("Refresh", { variant: "outline", size: "sm", iconName: "refresh", onclick: () => rerender() })],
      }),
      card(
        cardHeader(
          titled("squareTerminal", `Reporting activity (${logs.length})`),
          "Sign-ins, report and chart runs — refusals included — and every change made under Administration. " +
            "The deployed platform's log also carries its server's own messages; this one records what this tab did."
        ),
        el(
          "div.er-card__flush",
          logs.length === 0
            ? emptyState("No activity yet")
            : table(
                ["Level", "Timestamp", "User", "Action", "Message"],
                logs.map((entry) => {
                  const [label, variant] = OUTCOME_BADGE[entry.outcome] ?? [entry.outcome, "secondary"];
                  return [
                    badge(label, variant),
                    when(entry.at),
                    entry.email || "—",
                    el("span.er-strong", entry.action),
                    [entry.target, entry.detail, entry.durationMs != null ? `${entry.durationMs}ms` : null]
                      .filter(Boolean)
                      .join(" · ") || "—",
                  ];
                })
              )
        )
      )
    )
  );
}
