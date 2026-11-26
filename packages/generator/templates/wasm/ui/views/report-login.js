/**
 * The reporting application's sign-in — the second login.
 *
 * Drawn as the Enterprise Reporting platform draws its own (`src/routes/login.tsx`):
 * a centred card, the chart mark in a brand circle, "Welcome back", email and
 * password, one full-width button. The accounts are different accounts from
 * the application's, in different tables, with a different password.
 *
 * Two things sit below the card that the platform's screen does not have, and
 * both are there because this is a preview. Every seeded account is listed —
 * the administrator reads every table, so a reporting platform you can only
 * sign into as the administrator is one whose access control you cannot see;
 * `support.agent@… — 5 of 17 tables` is the invitation. And a line says what
 * this is: the platform's reports and roles in the platform's layout, served
 * from this tab, with the real platform one download away.
 */

import { el, mount, toast } from "../dom.js";
import { reportApi, setReportToken } from "../api.js";
import { alert, icon } from "./er-kit.js";

export async function reportLoginView(root, { project, onSignedIn, onLeave }) {
  let config = null;
  try {
    config = await reportApi.get("/report-auth/config");
  } catch {
    // The screen still works without the hint — the form is the point.
  }

  const accounts = config?.accounts ?? [];
  const password = config?.password ?? "admin";
  const administrator = accounts.find((account) => account.isAdmin) ?? accounts[0] ?? null;

  const emailInput = el("input.er-input", {
    type: "email",
    id: "report-email",
    name: "email",
    placeholder: "name@example.com",
    autocomplete: "email",
    value: administrator?.email ?? "",
    required: true,
  });
  const passwordInput = el("input.er-input", {
    type: "password",
    id: "report-password",
    name: "password",
    autocomplete: "current-password",
    value: password,
    required: true,
  });
  const errorSlot = el("div");
  const submit = el("button.er-btn.er-btn--default.er-btn--size-default.er-btn--block", { type: "submit" }, "Sign In");

  const form = el(
    "form.er-card.er-login__card",
    {
      onsubmit: async (event) => {
        event.preventDefault();
        submit.disabled = true;
        mount(submit, el("span.er-spinner.er-spinner--inline", { "aria-hidden": "true" }), "Sign In");
        mount(errorSlot);
        try {
          const result = await reportApi.post("/report-auth/login", {
            email: emailInput.value.trim(),
            password: passwordInput.value,
          });
          // Before anything else calls the API: the next request loads this
          // role's reports, and without the token it is a 401 that reads as
          // "your session ended" a quarter-second after signing in.
          setReportToken(result.token);
          onSignedIn(result.user);
        } catch (error) {
          mount(errorSlot, alert(error.message || "Invalid credentials", null, "destructive"));
          toast(error.message, "error");
          submit.disabled = false;
          mount(submit, "Sign In");
          passwordInput.focus();
        }
      },
    },
    el(
      "div.er-card__header.er-login__header",
      el("div.er-login__mark", icon("barChart3", "er-icon--lg")),
      el("h1.er-login__title", "Welcome back"),
      el("p.er-card__description", "Sign in to your Enterprise Reporting account")
    ),
    el(
      "div.er-card__content.er-login__fields",
      errorSlot,
      el("div.er-field", el("label.er-label-strong", { for: "report-email" }, "Email"), emailInput),
      el("div.er-field", el("label.er-label-strong", { for: "report-password" }, "Password"), passwordInput)
    ),
    el("div.er-card__footer", submit)
  );

  const accountList =
    accounts.length > 0
      ? el(
          "div.er-card.er-login__accounts",
          el(
            "p.er-text",
            `${accounts.length} reporting account${accounts.length === 1 ? "" : "s"}, password `,
            el("code", password),
            config?.scoped
              ? ". A reporting role decides which of the application's tables its queries may read — pick one to try it."
              : ". Pick one to fill the form."
          ),
          el(
            "ul.er-accounts",
            ...accounts.map((account) =>
              el(
                "li",
                el(
                  "button.er-accounts__row",
                  {
                    type: "button",
                    onclick: () => {
                      emailInput.value = account.email;
                      passwordInput.value = password;
                      passwordInput.focus();
                    },
                  },
                  el("span.er-strong", account.role ?? account.name),
                  el("span.er-accounts__email", account.email),
                  el(
                    "span.er-label",
                    account.isAdmin
                      ? `all ${account.total} tables`
                      : /* Zero is a real answer, not a missing seed: this is
                           the account holding no functional role, so no
                           `read` rule admits it and its queries may read
                           nothing. Said plainly, because a row reading
                           "0 of 17 tables" and nothing else looks like the
                           generator failed. */
                        account.tables === 0
                        ? "no tables — signed in, holding no reporting role"
                        : `${account.tables} of ${account.total} tables`
                  )
                )
              )
            )
          )
        )
      : el(
          "p.er-text.er-login__note",
          "No reporting accounts were seeded, which means this model declares no %%rbac roles. " +
            "Sign in as the administrator to read every table."
        );

  mount(
    root,
    el(
      "div.er.er-login",
      el(
        "div.er-login__column",
        form,
        accountList,
        el(
          "p.er-login__note",
          icon("info", "er-icon--sm"),
          el(
            "span",
            `Browser preview of Enterprise Reporting, over ${config?.application?.name ?? project.name}. ` +
              "Deployed, this is the platform itself — built unmodified from its own source beside the " +
              "application, from the deployable archive or the orchestrator."
          )
        ),
        onLeave
          ? el(
              "button.er-btn.er-btn--ghost.er-btn--size-sm",
              { type: "button", onclick: () => onLeave() },
              icon("arrowLeft"),
              `Back to ${project.name}`
            )
          : null
      )
    )
  );

  emailInput.focus();
}
