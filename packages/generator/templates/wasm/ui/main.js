/**
 * The shell: masthead, action bar, breadcrumb, and which screen is on show.
 *
 * The arrangement is the React application's, not an invention — a masthead
 * carrying the application's name, a global search and the signed-in user; an
 * action bar of Search / New / Save; a breadcrumb under it; the screen below.
 * Two applications generated from one model should not look like two products,
 * so where this file had a choice it copied rather than improved.
 *
 * Routing is hash-based. A history-API router would need the Service Worker to
 * return `index.html` for every unknown path, which it happily would — but this
 * application is also embedded in an iframe on the page that generated it, and
 * a pushState there rewrites the *host* page's URL. A hash cannot.
 */

import { el, helpToast, mount, toast } from "./dom.js";
import { themeControl } from "./theme.js";
import { api, configure, setToken } from "./api.js";
import { loginView } from "./views/login.js";
import { dashboardView } from "./views/dashboard.js";
import { entityListView } from "./views/entity-list.js";
import { dictionaryView, rulesView, processesView, auditView, modelView } from "./views/admin.js";
import { reportsView } from "./views/reports.js";
import { reportAppView, reportSessionEnded, resetReportView } from "./views/report-app.js";

const state = {
  user: null,
  model: null,
  entities: [],
  project: null,
  /** Set by whichever screen is showing, so the action bar can drive it. */
  actions: {},
  /**
   * Which render is current.
   *
   * Screens keep loading after the render that started them has returned — a
   * grid fetches, a record panel fetches — and each calls `setActions` when it
   * is ready. Without a token, a screen the reader had already navigated away
   * from would repaint the action bar behind the new one, leaving a live "Save"
   * over a rules listing that has nothing to save.
   */
  renderId: 0,
  /** The current screen's help, and what to call it in the toaster. */
  helpText: "",
  helpTitle: "Help",
};

export async function start({ basePath, project }) {
  state.project = project;
  configure({
    basePath,
    onUnauthorized: () => {
      if (state.user) {
        state.user = null;
        state.model = null;
        toast("Your session ended — sign in again", "error");
        render();
      }
    },
    /* The reporting application's session, expiring separately. Losing it must
       not touch `state.user`: the reader is still signed into the application,
       and signing them out of it because a reporting call came back 401 is the
       confusion two sessions exist to prevent.

       `reportSessionEnded` answers whether there was a session at all — the
       reporting shell probes `/report-auth/me` on entry and a "no" to that is
       an ordinary 401, not an expiry. Announcing it would toast once per probe
       and repaint once per toast, and the repaint probes again. */
    onReportUnauthorized: () => {
      if (!reportSessionEnded()) return;
      if (isReportRoute(window.location.hash)) {
        toast("Your reporting session ended — sign in again", "error");
        render();
      }
    },
  });

  document.getElementById("app").hidden = false;
  window.addEventListener("hashchange", render);

  try {
    state.user = await api.get("/auth/me");
  } catch {
    state.user = null;
  }

  await render();
}

export function navigate(path, options = {}) {
  const target = `#${path}`;
  if (options.replace) window.location.replace(target);
  else window.location.hash = path;
  if (window.location.hash === target) render();
}

/** Screens register what the action bar's buttons should do. */
export function setActions(actions, token = state.renderId) {
  if (token !== state.renderId) return;
  state.actions = actions || {};
  paintActionBar();
}

/** The token a screen should carry if it wants to set actions later. */
export const currentRender = () => state.renderId;

/**
 * The line-item entities belonging to one parent.
 *
 * Read from the same list the dashboard filters them out of, so the two cannot
 * disagree about what is a child. Empty for an entity nobody declared a
 * `parent:` against, which is most of them.
 */
export function childEntitiesOf(parentName) {
  return state.entities.filter((entity) => entity.parentEntity === parentName);
}

/**
 * Is this route the reporting application?
 *
 * Matched exactly, never as a prefix. The application's own admin screen is
 * `#/reports` — the `%%report` questions it serves itself — and
 * `"#/reports".startsWith("#/report")` is true, so a prefix test sent every
 * reader who clicked Reports in the application to the reporting platform's
 * sign-in screen instead.
 */
function isReportRoute(hash) {
  const route = (hash || "").replace(/^#/, "");
  return route === "/report" || route.startsWith("/report/");
}

async function render() {
  const root = document.getElementById("app");

  /*
   * The reporting application, before the application's own sign-in gate.
   *
   * Deliberately first. `#/report` is the second of the two applications this
   * model generates, and it has its own accounts — so reaching it must not
   * require a session in the *other* one. Putting this check after the gate
   * below would mean the reporting platform could only be opened by somebody
   * already signed into the application, which is exactly the shared-login
   * arrangement the two products do not have.
   */
  if (isReportRoute(window.location.hash)) {
    // The shell owns the whole root here: it has a masthead of its own, and a
    // second one above it would say the two are one application with a section.
    return void (await reportAppView(root, {
      project: state.project,
      onLeave: () => {
        // Nothing is signed out. The reader keeps their reporting session and
        // arrives at the application needing that one, which is the truth
        // about the pair rather than a convenience.
        resetReportView();
        mount(root);
        navigate("/");
      },
    }));
  }

  if (!state.user) {
    await loginView(root, {
      project: state.project,
      onSignedIn: async (user) => {
        state.user = user;
        await render();
      },
    });
    return;
  }

  if (!state.model) {
    state.model = await api.get("/model");
    state.entities = state.model.entities.map((entity) => ({
      ...entity,
      routeName: entity.route,
      displayName: entity.displayName || entity.name,
      singularName: singular(entity.displayName || entity.name),
      category: categoryOf(state.model, entity.name),
      attributes: entity.attributes.map((attribute) => ({
        columnName: attribute.name,
        displayName: attribute.label,
        type: attribute.type,
        required: attribute.required,
        enumValues: attribute.enumValues,
        maxLength: attribute.maxLength,
        refTable: attribute.refTable,
      })),
    }));
  }

  const shell = ensureShell(root);
  const outlet = shell.querySelector(".outlet");
  const route = (window.location.hash || "#/").slice(1);
  state.actions = {};
  state.renderId += 1;
  state.helpText = "";
  state.helpTitle = "Help";

  try {
    const [, section, ...rest] = route.split("/");

    if (!section) {
      setCrumbs([]);
      /*
       * Line items are not on the dashboard.
       *
       * `%%entity <E> parent: <P>` says the child has no life away from its
       * parent, so a card offering a list of every invoice line ever written
       * is an invitation to a screen nobody wants. They are reached through
       * the parent's window, as a tab under the record they belong to.
       */
      const topLevel = state.entities.filter((entity) => !entity.parentEntity);
      return void (await dashboardView(outlet, { entities: topLevel, navigate, project: state.project, user: state.user }));
    }

    if (section === "entity") {
      const entity = state.entities.find((item) => item.routeName === rest[0]);
      if (!entity) {
        setCrumbs([{ label: "Unknown" }]);
        return void mount(outlet, el("div.empty", el("h3", "No such entity")));
      }
      setCrumbs([{ label: entity.displayName }]);
      return void (await entityListView(outlet, { entity, recordId: rest[1], navigate }));
    }

    const admin = {
      dictionary: ["Application Dictionary", dictionaryView],
      rules: ["Business Rules", rulesView],
      processes: ["Processes", processesView],
      audit: ["Audit Log", auditView],
      reports: ["Reports", reportsView],
      model: ["The Model", modelView],
    }[section];

    if (admin) {
      setCrumbs([{ label: admin[0] }]);
      /* The admin screens are read-only except one: the dictionary offers the
         field-visibility toggle, which is administrator-only. The server
         refuses a non-admin write regardless (`sys.routes.js` guards on the
         method), so this decides whether the control is *offered*, not whether
         it is allowed. */
      return void (await admin[1](outlet, { user: state.user }));
    }

    setCrumbs([{ label: "Not found" }]);
    mount(outlet, el("div.empty", el("h3", "Nothing here"), el("p", `No screen for /${section}`)));
  } catch (error) {
    console.error(error);
    mount(outlet, el("div.empty", el("h3", "Something went wrong"), el("p", error.message)));
  } finally {
    paintActionBar();
  }
}

function ensureShell(root) {
  const existing = root.querySelector(".shell");
  if (existing) return existing;

  const search = el("input", {
    type: "search",
    placeholder: "Search…",
    "aria-label": "Search this application",
    onkeydown: (event) => {
      if (event.key !== "Enter") return;
      const term = event.target.value.trim();
      if (!term) return;
      // Search lands on the first entity that has text columns to search.
      const target =
        state.entities.find((entity) =>
          entity.attributes.some((attribute) => ["string", "text"].includes(attribute.type))
        ) ?? state.entities[0];
      if (target) navigate(`/entity/${target.routeName}?q=${encodeURIComponent(term)}`);
    },
  });

  const shell = el(
    "div.shell",
    el(
      "header.masthead",
      el("a.masthead__name", { href: "#/", title: "Dashboard" }, state.project.name),
      el("div.masthead__spacer"),
      el("div.masthead__search", search),
      // Light / dark / system. The attribute lands on <html>, so this one
      // control changes every screen rather than the masthead.
      themeControl(),
      el(
        "div.masthead__user",
        el("span.avatar", initials(state.user.name || state.user.email)),
        el(
          "div",
          el("div.masthead__who", state.user.name || state.user.email),
          el("div.masthead__roles", (state.user.roles || []).join(", ") || "no roles")
        ),
        el(
          "button.btn.btn--ghost.btn--icon",
          {
            title: "Sign out",
            "aria-label": "Sign out",
            onclick: async () => {
              await api.post("/auth/logout").catch(() => {});
              setToken(null);
              state.user = null;
              state.model = null;
              mount(document.getElementById("app"));
              await render();
            },
          },
          "⇥"
        )
      )
    ),
    el("div.actionbar"),
    el("nav.crumbs"),
    el("main.outlet")
  );

  mount(root, shell);
  return shell;
}

/**
 * Set the breadcrumb. Always rooted at Dashboard, because every screen in this
 * application is reached from it and a breadcrumb with one entry is a label.
 */
function setCrumbs(trail) {
  state.helpTitle = trail.length ? trail[trail.length - 1].label : "Dashboard";
  const crumbs = document.querySelector(".crumbs");
  if (!crumbs) return;
  mount(
    crumbs,
    el("a", { href: "#/" }, "⌂ Dashboard"),
    trail.flatMap((item, index) => [
      el("span.crumbs__sep", "/"),
      item.href && index < trail.length - 1
        ? el("a", { href: item.href }, item.label)
        : el("span.crumbs__current", item.label),
    ]),
    state.helpText ? helpButton() : null
  );
}

/**
 * The `?`. The only control in this application that shows help.
 *
 * It opened a `toast(..., "info")` before, which took the text away after four
 * seconds. Now it opens the help toaster: top right, no timeout, closed by its
 * own close button.
 */
function helpButton() {
  return el(
    "button.crumbs__help",
    {
      type: "button",
      title: `Help for ${state.helpTitle}`,
      "aria-label": `Help for ${state.helpTitle}`,
      onclick: () => helpToast(`${state.helpTitle} — Help`, state.helpText),
    },
    "?"
  );
}

export function setHelp(text) {
  state.helpText = text;
  const crumbs = document.querySelector(".crumbs");
  if (crumbs && !crumbs.querySelector(".crumbs__help") && text) {
    crumbs.appendChild(helpButton());
  }
}

function paintActionBar() {
  const bar = document.querySelector(".actionbar");
  if (!bar) return;
  const { onNew, onSave, onSearch, saveLabel, newLabel, busy } = state.actions;

  mount(
    bar,
    el(
      "button.btn",
      { disabled: !onSearch, onclick: () => onSearch && onSearch() },
      "⌕ Search"
    ),
    el(
      "button.btn",
      { disabled: !onNew, onclick: () => onNew && onNew() },
      `+ ${newLabel || "New"}`
    ),
    el(
      "button.btn.btn--primary",
      { disabled: !onSave || busy, onclick: () => onSave && onSave() },
      busy ? "Saving…" : `▤ ${saveLabel || "Save"}`
    ),
    el("div.actionbar__spacer"),
    el(
      "button.btn.btn--ghost.btn--icon",
      { title: "Reload this screen", "aria-label": "Reload", onclick: () => render() },
      "⟳"
    )
  );
}

function categoryOf(model, entityName) {
  const category = (model.categories || []).find((item) => (item.entities || []).includes(entityName));
  return category ? category.name : "General";
}

const singular = (value) => (value.endsWith("ies") ? `${value.slice(0, -3)}y` : value.replace(/s$/, ""));

const initials = (value) =>
  String(value)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => (word[0] || "").toUpperCase())
    .join("") || "U";
