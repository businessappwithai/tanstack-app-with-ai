/**
 * The page that generates and runs an application without a server.
 *
 * Three moving parts, in order:
 *
 *   1. A model is read — from `models/*.eml.mmd` beside this page, or from a
 *      file the reader picks. Reading a picked file never leaves the tab.
 *   2. `appwithai-wasm.js` compiles it. That bundle is built from the same
 *      source the CLI uses, so the application produced here is the application
 *      `appwithai-wasm generate` would have written.
 *   3. The files are posted to a Service Worker, which serves them as if they
 *      had come off a web server, and an iframe is pointed at the result.
 *
 * The third step is the one worth explaining. The obvious shortcut is to write
 * the application into a blob URL and skip the worker — but then the app's own
 * `fetch("/api/…")` calls have no origin to go to, and the whole property being
 * demonstrated (that this is a server the front end is talking to, not a library
 * it is calling) quietly stops being true. Going through the Service Worker
 * keeps the generated application byte-identical to the one you would deploy.
 */

// The published validator, not the copy inside the generator bundle. Same engine
// either way — but this is the file `llms.txt` §1.3 tells a model to validate
// against, so the page and the protocol cannot drift into disagreeing about
// whether a document is acceptable. `fixer.js` carries the checker with it,
// which is what lets it re-check what it repaired.
import { checkAndFix } from "../fixer.js";
import { generateFromSource } from "./appwithai-wasm.js";

const BASE = new URL("wasm-app/run/", window.location.href).pathname;
const SW_URL = new URL("wasm-app/sw.js", window.location.href).pathname;
const SW_SCOPE = new URL("wasm-app/", window.location.href).pathname;

const BUILT_IN = {
  crm: { path: "models/crm.eml.mmd", label: "crm.eml.mmd", name: "Acme CRM" },
  drug: {
    path: "models/drug-discovery.eml.mmd",
    label: "drug-discovery.eml.mmd",
    name: "Drug Discovery",
  },
  investment: {
    path: "models/investment-planning-wealth-management-system.eml.mmd",
    label: "investment-planning-wealth-management-system.eml.mmd",
    name: "Investment Planning and Wealth Management",
  },
};

const $ = (id) => document.getElementById(id);

const state = {
  source: "",
  label: "",
  files: null,
  summary: null,
  registration: null,
  review: null,
};

/* ---------------------------------------------------------------- progress */

/**
 * The build, as a bar.
 *
 * Six phases, weighted by how long they actually take rather than evenly: the
 * first four together are a fraction of a second on any model this page will be
 * given, and booting Postgres is ten seconds or more. An evenly divided bar
 * would sit at 66% for the entire wait, which is worse than no bar — it would be
 * reporting the number of steps rather than the progress through them.
 *
 * The weights come from measuring the CRM model, and they are honest about
 * being estimates for everything except `boot`, which reports its own sub-steps
 * from inside the frame and is the only phase long enough for that to matter.
 */
const PHASES = [
  { id: "model", label: "Read the model", weight: 4 },
  { id: "check", label: "Check it", weight: 8 },
  { id: "compile", label: "Compile the application", weight: 12 },
  { id: "mount", label: "Serve the files", weight: 6 },
  { id: "boot", label: "Start Postgres and the server", weight: 62 },
  { id: "ready", label: "Application running", weight: 8 },
];

const TOTAL_WEIGHT = PHASES.reduce((sum, phase) => sum + phase.weight, 0);

const build = {
  /** phase id -> "pending" | "active" | "done" | "failed" */
  status: Object.fromEntries(PHASES.map((phase) => [phase.id, "pending"])),
  /** Fraction 0..1 through the phase currently active. */
  within: 0,

  reset() {
    for (const phase of PHASES) this.status[phase.id] = "pending";
    this.within = 0;
    $("build").hidden = false;
    $("build-detail").textContent = "";
    this.paint();
  },

  /** Mark a phase started; everything before it is finished by definition. */
  start(id, detail = "") {
    const index = PHASES.findIndex((phase) => phase.id === id);
    PHASES.forEach((phase, position) => {
      if (position < index && this.status[phase.id] !== "failed") this.status[phase.id] = "done";
    });
    this.status[id] = "active";
    this.within = 0;
    if (detail) $("build-detail").textContent = detail;
    this.paint();
  },

  /** Progress within the active phase, for the one phase long enough to need it. */
  advance(fraction, detail = "") {
    this.within = Math.max(0, Math.min(1, fraction));
    if (detail) $("build-detail").textContent = detail;
    this.paint();
  },

  done(id, detail = "") {
    this.status[id] = "done";
    this.within = 0;
    if (detail) $("build-detail").textContent = detail;
    this.paint();
  },

  fail(id, detail) {
    this.status[id] = "failed";
    if (detail) $("build-detail").textContent = detail;
    this.paint();
  },

  paint() {
    let earned = 0;
    for (const phase of PHASES) {
      const status = this.status[phase.id];
      if (status === "done") earned += phase.weight;
      else if (status === "active") earned += phase.weight * this.within;
    }
    const pct = Math.round((earned / TOTAL_WEIGHT) * 100);
    const failed = PHASES.some((phase) => this.status[phase.id] === "failed");
    const active = PHASES.find((phase) => this.status[phase.id] === "active");
    const complete = PHASES.every((phase) => this.status[phase.id] === "done");

    $("build-fill").style.width = `${pct}%`;
    $("build").dataset.state = failed ? "failed" : complete ? "done" : "running";
    $("build-pct").textContent = failed ? "stopped" : `${pct}%`;
    $("build-label").textContent = failed
      ? "Build stopped"
      : complete
        ? "Application running"
        : (active?.label ?? "Ready to build");

    const bar = $("build-bar");
    bar.setAttribute("aria-valuenow", String(pct));

    $("build-phases").innerHTML = PHASES.map(
      (phase) =>
        `<li class="build__phase" data-phase="${phase.id}" data-state="${this.status[phase.id]}">` +
        `<span class="build__tick"></span>${escapeHtml(phase.label)}</li>`
    ).join("");
  },
};

/* ------------------------------------------------------------------ step 1 */

const choices = [
  [$("choice-crm"), "crm"],
  [$("choice-drug"), "drug"],
  [$("choice-investment"), "investment"],
  [$("choice-upload"), "upload"],
];

for (const [button, kind] of choices) {
  button.addEventListener("click", () => selectChoice(kind));
}

async function selectChoice(kind) {
  for (const [button, candidate] of choices) {
    button.setAttribute("aria-pressed", String(candidate === kind));
  }
  $("dropzone").hidden = kind !== "upload";

  if (kind === "upload") {
    setModel("", "");
    return;
  }

  const built = BUILT_IN[kind];
  setModel("", "");
  try {
    const response = await fetch(built.path, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    setModel(await response.text(), built.label);
    $("app-name").value = built.name;
  } catch (error) {
    fail(
      `Could not read <code>${built.path}</code> (${error.message}). ` +
        "This page has to be opened over http:// — from a file:// URL the browser refuses to read " +
        "the model beside it. Try <code>bun run wasm serve html</code>."
    );
  }
}

const dropzone = $("dropzone");
$("file").addEventListener("change", (event) => {
  const input = event.target;
  const file = input.files?.[0];
  if (file) readFile(file);
  // Clearing the value is what makes "fix it and choose it again" work. A file
  // input fires no `change` when the same filename is picked twice, so a reader
  // who edited the file the checker just refused and re-selected it would sit
  // looking at the stale findings with nothing having happened.
  input.value = "";
});
for (const type of ["dragenter", "dragover"]) {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-over");
  });
}
for (const type of ["dragleave", "drop"]) {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-over");
    if (type === "drop" && event.dataTransfer.files[0]) readFile(event.dataTransfer.files[0]);
  });
}

async function readFile(file) {
  const text = await file.text();
  setModel(text, file.name);
  const guessed = file.name.replace(/\.(eml\.)?mmd$|\.md$|\.txt$/i, "").replace(/[-_]+/g, " ");
  if (guessed.trim()) $("app-name").value = titleCase(guessed.trim());
}

function setModel(source, label) {
  state.source = source;
  state.label = label;
  state.files = null;
  state.summary = null;
  state.review = null;

  $("download").disabled = true;
  $("result").className = "result";
  $("result").innerHTML = "";
  $("diagnostics").hidden = true;

  const summary = $("model-summary");
  const preview = $("preview");

  if (!source) {
    summary.hidden = true;
    preview.hidden = true;
    $("build").hidden = true;
    setStep("step-generate", "idle");
    setStep("step-run", "idle");
    return;
  }

  build.reset();
  build.start("model", `Reading ${label}`);

  summary.hidden = false;
  summary.innerHTML =
    `<code>${escapeHtml(label)}</code> · ${source.split("\n").length.toLocaleString()} lines · ` +
    `${(new Blob([source]).size / 1024).toFixed(0)}KB`;

  preview.hidden = false;
  preview.open = false;
  $("preview-code").textContent = source;

  setStep("step-model", "done");
  build.done("model");

  // Checked here rather than at the point of generating, because this is the
  // moment the reader is looking at the model — and because a model with an
  // error is not going to become a working application by pressing Generate.
  build.start("check", "Checking the model against the EML language definition");
  const review = checkModel(source);
  if (!review.ok) {
    build.fail("check", `${review.counts.errors} error(s) — nothing was generated`);
    setStep("step-generate", "idle");
    setStep("step-run", "idle");
    return;
  }
  build.done("check", describeReview(review));

  setStep("step-generate", "active");
  setStep("step-run", "idle");
}

/* -------------------------------------------------- checker + fixer feedback */

/**
 * Run the checker over the model and show what it found.
 *
 * This is the same engine as `bun language/checker.ts`, and the same repairs as
 * `bun language/fixer.ts` — bundled, not reimplemented. A model that passes says
 * nothing beyond a line in the build detail; a model that does not gets every
 * finding with its code, line and hint, because "generation failed" on its own
 * leaves the reader with a file and no idea which line of it is wrong.
 *
 * The repaired source replaces the loaded one when the fixer applied anything,
 * so what gets compiled is what the reader is being shown findings about.
 */
function checkModel(source) {
  let review;
  try {
    // `checkAndFix` repairs the five auto-fixable codes and then re-checks, so
    // what is reported describes the document that will actually be compiled
    // rather than the one that arrived. `remaining` is that second reading.
    const result = checkAndFix(source);
    review = { ...result, issues: result.remaining };
  } catch (error) {
    // A document the parser cannot read at all — not a finding, a refusal.
    review = {
      ok: false,
      repaired: false,
      source,
      fixes: [],
      counts: { errors: 1, warnings: 0, infos: 0 },
      issues: [
        {
          severity: "error",
          code: "EML000",
          message: `This file could not be read as EML: ${error.message}`,
          hint: "An EML document is a Mermaid file with an erDiagram section.",
        },
      ],
    };
  }

  state.review = review;
  if (review.repaired) {
    state.source = review.source;
    $("preview-code").textContent = review.source;
  }
  renderDiagnostics(review);
  return review;
}

function describeReview(review) {
  const { errors } = review.counts;
  return [`${errors} error${errors === 1 ? "" : "s"}`, ...describeRest(review)].join(" · ");
}

/**
 * The counts other than errors.
 *
 * Split out because the diagnostics header already states the error count in its
 * own sentence, and repeating it in the sub-line read as "refused this model —
 * 1 error · 1 error".
 */
function describeRest(review) {
  const { warnings, infos } = review.counts;
  const applied = review.fixes.filter((fix) => fix.applied).length;
  const parts = [];
  if (applied) parts.push(`${applied} auto-fix${applied === 1 ? "" : "es"} applied`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  if (infos) parts.push(`${infos} info`);
  return parts;
}

const SEVERITY_LABEL = { error: "error", warning: "warning", info: "info" };

function renderDiagnostics(review) {
  const box = $("diagnostics");
  const applied = review.fixes.filter((fix) => fix.applied);
  // Infos are the generator announcing its own inferences — a foreign key it
  // will add anyway. Shown, but folded away, so the two lines that stop the
  // build are not buried under thirty that do not.
  const loud = review.issues.filter((issue) => issue.severity !== "info");
  const quiet = review.issues.filter((issue) => issue.severity === "info");

  if (!applied.length && !loud.length && !quiet.length) {
    box.hidden = true;
    return;
  }

  const issueRow = (issue) => `
    <li class="diag diag--${issue.severity}">
      <span class="diag__sev">${SEVERITY_LABEL[issue.severity]}</span>
      <span class="diag__code">${escapeHtml(issue.code)}</span>
      ${issue.line ? `<span class="diag__line">line ${issue.line}</span>` : ""}
      <span class="diag__msg">${escapeHtml(issue.message)}</span>
      ${issue.hint ? `<span class="diag__hint">${escapeHtml(issue.hint)}</span>` : ""}
    </li>`;

  box.hidden = false;
  box.dataset.state = review.ok ? "ok" : "failed";
  box.innerHTML = `
    <div class="diag__head">
      <b>${
        review.ok
          ? "The checker accepted this model"
          : `The checker refused this model — ${review.counts.errors} error${review.counts.errors === 1 ? "" : "s"}`
      }</b>
      <span>${escapeHtml(describeRest(review).join(" · "))}</span>
    </div>
    ${
      applied.length
        ? `<ul class="diags">${applied
            .map(
              (fix) => `<li class="diag diag--fixed">
                 <span class="diag__sev">fixed</span>
                 <span class="diag__code">${escapeHtml(fix.code)}</span>
                 <span class="diag__msg">${escapeHtml(fix.description)}</span>
               </li>`
            )
            .join("")}</ul>`
        : ""
    }
    ${loud.length ? `<ul class="diags">${loud.map(issueRow).join("")}</ul>` : ""}
    ${
      quiet.length
        ? `<details class="diag__more"><summary>${quiet.length} informational finding${quiet.length === 1 ? "" : "s"}</summary>
             <ul class="diags">${quiet.map(issueRow).join("")}</ul></details>`
        : ""
    }
    ${
      review.ok
        ? ""
        : `<p class="diag__foot"><b>Nothing was generated.</b> Fix the ${
            review.counts.errors === 1 ? "line above" : "lines above"
          } in your
             <code>.mmd</code> file, save it, and choose it again — this page re-checks every
             time a model is loaded, so you can correct and re-submit until it passes. The
             command-line tool stops here too: <code>appwithai-wasm generate</code> refuses a
             model with errors unless you pass <code>--skip-check</code>.</p>`
    }`;
}

/* ------------------------------------------------------------------ step 2 */

$("generate").addEventListener("click", () => {
  if (!state.source) {
    fail("Choose a model first.");
    return;
  }

  if (state.review && !state.review.ok) {
    fail("This model has errors the checker refused. Fix them and load it again.");
    return;
  }

  const button = $("generate");
  button.disabled = true;
  button.innerHTML = '<span class="working"></span>Generating';
  build.start("compile", "Compiling the model into an application");

  // A frame so the button's state paints before the compiler blocks the thread.
  // Generation is milliseconds on a small model and long enough to notice on a
  // large one, and a button that never showed it was pressed reads as broken.
  requestAnimationFrame(() => {
    try {
      const result = generateFromSource({
        source: state.source,
        name: $("app-name").value.trim() || "Generated App",
        adminEmail: $("admin-email").value.trim() || "admin@admin.com",
        adminPassword: $("admin-password").value || "admin",
        adminName: ($("admin-email").value.split("@")[0] || "admin").trim(),
        pgliteUrl: state.pgliteUrl,
      });

      state.files = result.files;
      state.summary = result.summary;
      showResult(result);
      $("download").disabled = false;
      setStep("step-generate", "done");
      setStep("step-run", "active");
      build.done(
        "compile",
        `${result.summary.fileCount} files · ${(result.summary.bytes / 1024).toFixed(0)}KB`
      );
    } catch (error) {
      // A ModelCheckError carries the findings; anything else is a compiler
      // failure, which is a different thing and should not be dressed as one.
      if (error.review) {
        state.review = error.review;
        renderDiagnostics(error.review);
        build.fail("check", `${error.review.counts.errors} error(s) — nothing was generated`);
        fail("The checker refused this model. The findings are with the model above.");
      } else {
        build.fail("compile", error.message);
        fail(escapeHtml(error.message));
      }
      setStep("step-run", "idle");
    } finally {
      button.disabled = false;
      button.textContent = "Generate";
    }
  });
});

function showResult(result) {
  const { summary, warnings } = result;
  const box = $("result");

  box.innerHTML = `
    <div class="tally">
      ${cell(summary.entities.length, "Entities")}
      ${cell(summary.relationships, "Relationships")}
      ${cell(summary.rules.length, "Rules")}
      ${cell(summary.workflows.length + summary.sagas.length, "Processes")}
      ${cell(summary.hooks, "Hooks")}
      ${cell(summary.accessRules, "Access rules")}
      ${cell(summary.fileCount, "Files")}
      ${cell(`${(summary.bytes / 1024).toFixed(0)}KB`, "Size")}
    </div>

    <h4>Entities</h4>
    <div class="chips">${summary.entities.map((name) => chip(name)).join("")}</div>

    ${summary.categories.length ? `<h4>Groups</h4><div class="chips">${summary.categories.map((name) => chip(name)).join("")}</div>` : ""}
    ${summary.rules.length ? `<h4>Rules</h4><div class="chips">${summary.rules.map((name) => chip(name, "rule")).join("")}</div>` : ""}
    ${
      summary.workflows.length || summary.sagas.length
        ? `<h4>Processes</h4><div class="chips">${[...summary.workflows, ...summary.sagas]
            .map((name) => chip(name, "flow"))
            .join("")}</div>`
        : ""
    }

    ${
      warnings.length
        ? `<div class="warnings"><b>${warnings.length} thing${warnings.length === 1 ? "" : "s"} the compiler skipped</b>
             <ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></div>`
        : ""
    }

    <details class="preview"><summary>All ${summary.fileCount} files</summary>
      <div class="filelist">
        ${Object.entries(state.files)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(
            ([name, contents]) =>
              `<div><span>${escapeHtml(name)}</span><span>${(contents.length / 1024).toFixed(1)}KB</span></div>`
          )
          .join("")}
      </div>
    </details>`;

  box.classList.add("is-shown");
}

const cell = (value, label) =>
  `<div class="tally__cell"><span class="tally__value">${value}</span><span class="tally__label">${label}</span></div>`;
const chip = (name, kind = "") =>
  `<span class="chip${kind ? ` chip--${kind}` : ""}">${escapeHtml(name)}</span>`;

function fail(html) {
  const box = $("result");
  box.innerHTML = `<div class="failure">${html}</div>`;
  box.classList.add("is-shown");
}

/**
 * Hand the reader the generated application.
 *
 * A zip would be nicer and would mean shipping a zip encoder to a page whose
 * whole point is that it has no dependencies. A single self-extracting shell
 * script is the honest trade: it is readable before it is run, which a zip is
 * not.
 *
 * It cannot carry PGlite's seventeen megabytes of WebAssembly, so the download
 * is generated again without this page's PGlite URL — which would point the
 * application at this host — and is started with `npm install && npm start`:
 * the application's own server then serves the installed package.
 */
$("download").addEventListener("click", () => {
  if (!state.files) return;
  const { files } = generateFromSource({
    source: state.source,
    name: $("app-name").value.trim() || "Generated App",
    adminEmail: $("admin-email").value.trim() || "admin@admin.com",
    adminPassword: $("admin-password").value || "admin",
    adminName: ($("admin-email").value.split("@")[0] || "admin").trim(),
  });
  const name = ($("app-name").value.trim() || "generated-app")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const script = [
    "#!/bin/sh",
    `# Generated by APPWITHAI (browser stack). Writes the application into ./${name}`,
    "# Read it before you run it; every file below is plain text.",
    "set -e",
    `mkdir -p "${name}"`,
    `cd "${name}"`,
    "",
    ...Object.entries(files).flatMap(([path, contents]) => [
      `mkdir -p "$(dirname "${path}")"`,
      `cat > "${path}" <<'ERDWITHAI_EOF'`,
      contents.replace(/\r/g, ""),
      "ERDWITHAI_EOF",
      "",
    ]),
    `echo "Wrote ${Object.keys(files).length} files into ${name}/"`,
    `echo "Start it (npm install fetches PostgreSQL, which ships as an npm package):"`,
    `echo "  cd ${name} && npm install && npm start"`,
    "",
  ].join("\n");

  const url = URL.createObjectURL(new Blob([script], { type: "text/x-shellscript" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.sh`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ------------------------------------------------------------------ step 3 */

$("run").addEventListener("click", () => run(false));
$("reset").addEventListener("click", () => run(true));

async function run(fresh) {
  if (!state.files) {
    fail("Generate the application first.");
    return;
  }
  if (!state.pgliteUrl) {
    fail(
      "PostgreSQL (PGlite) is not beside this page, and it is never fetched from a CDN. " +
        "Run `bun run vendor:pglite`, reload, and run again — or download the application."
    );
    return;
  }

  const button = $("run");
  button.disabled = true;
  button.innerHTML = '<span class="working"></span>Starting';

  const log = $("log");
  log.hidden = false;
  log.innerHTML = "";
  build.start("mount", "Handing the files to the Service Worker");

  try {
    say("Registering the HTTP layer");
    const registration = await ensureServiceWorker();
    say("Service Worker active", "ok");

    say(`Mounting ${Object.keys(state.files).length} files at ${BASE}`);
    const mounted = await ask(registration.active, {
      type: "mount",
      basePath: BASE,
      files: state.files,
    });
    if (!mounted.ok) throw new Error(mounted.error || "the Service Worker refused the files");
    say(`Mounted ${mounted.files} files`, "ok");
    build.done("mount", `${mounted.files} files served from ${BASE}`);
    build.start("boot", "Starting the application");

    say(
      "Starting the application — Postgres is about ten megabytes of WebAssembly, so give it a moment"
    );

    const frame = $("frame");
    const url = `${BASE}index.html${fresh ? "?ephemeral" : ""}`;
    frame.src = "about:blank";
    // A frame so the blank navigation commits first; assigning twice in one
    // task leaves the iframe on the old document with the new URL in its bar.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    frame.src = url;

    $("stage").classList.add("is-shown");
    $("stage-url").textContent = new URL(url, window.location.href).href;
    $("reset").hidden = false;

    $("credentials").hidden = false;
    $("credentials").innerHTML =
      `Sign in as <b>${escapeHtml($("admin-email").value.trim() || "admin@admin.com")}</b> ` +
      `with the password <b>${escapeHtml($("admin-password").value || "admin")}</b>. ` +
      (fresh
        ? "This run uses a fresh in-memory database."
        : "The database persists in this browser, so a reload picks up where you left off.");

    setStep("step-run", "done");
    $("stage").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    build.fail("mount", error.message);
    say(error.message, "bad");
    say(
      "This page needs to be served over http:// or https:// — a Service Worker cannot be registered " +
        "from a file:// URL.",
      "bad"
    );
  } finally {
    button.disabled = false;
    button.textContent = "Run the application";
  }
}

/* -------------------------------------------------------------- boot phases */

/**
 * The sub-steps the application announces while it starts.
 *
 * Booting is sixty per cent of the bar, and the marks below are where its
 * sub-steps fall. The application already narrates them on its own boot screen;
 * `boot.js` posts the same lines to whoever embedded it, so this bar can move
 * through the wait instead of sitting still until the frame paints.
 *
 * The fractions come from measuring, and they were badly wrong. Opening
 * Postgres and running the DDL took 6 of the 251 seconds a thirty-entity model
 * spent booting, and seeding took the other 245 — yet the marks gave the first
 * two 70% of the bar and seeding a tenth. That ratio is structural rather than
 * a property of the machine: opening PGlite and running DDL is a fixed cost,
 * while seeding inserts a row at a time and grows with the model. So seeding
 * now owns most of the bar.
 *
 * Matching on the status text is a soft coupling, and deliberately so: an
 * unrecognised status still shows in the detail line and simply does not advance
 * the bar. The alternative — a numbered protocol between the page and the
 * runtime — buys nothing that a stalled bar does not already communicate.
 */
const BOOT_MARKS = [
  [/http layer|service worker/i, 0.05],
  [/backend worker|node-api/i, 0.1],
  [/request pipe/i, 0.15],
  [/postgres/i, 0.25],
  [/migrat|schema/i, 0.45],
  [/seed/i, 0.6],
  [/interface/i, 0.98],
];

/**
 * Seeding, reported as a fraction rather than as a single mark.
 *
 * The marks above are milestones, and one of them was hiding almost the whole
 * wait: `seed` put the bar at 85% and nothing moved it again until the frame
 * was ready. Measured on the thirty-entity hospital model, that was 246 of the
 * 253 seconds the boot took — a bar sitting still for 97% of the wait, which is
 * what the phase weighting exists to prevent. It is not a slow-machine problem;
 * a faster machine shortens the same frozen stretch.
 *
 * `migrate.js` now counts the rows it seeds and says so. This reads that count
 * and spreads it across the band between the `seed` mark and the one after it,
 * so the bar moves for the part of the boot that actually takes the time. A
 * runtime that does not report a count still matches `/seed/i` above and
 * behaves exactly as before.
 */
const SEED_COUNT = /seeding\s*[—-]\s*(\d+)\s+of\s+(\d+)/i;
const SEED_BAND = [0.6, 0.97];

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.source !== "appwithai-boot") return;

  if (message.type === "status" || message.type === "log") {
    const text = message.status ?? message.message ?? "";
    if (message.type === "log") say(`  ${text}`);
    else say(text);
    const counted = SEED_COUNT.exec(text);
    if (counted) {
      const done = Number(counted[1]);
      const total = Number(counted[2]);
      if (total > 0) {
        const [from, to] = SEED_BAND;
        build.advance(from + (to - from) * Math.min(1, done / total), text);
        return;
      }
    }

    for (const [pattern, fraction] of BOOT_MARKS) {
      if (pattern.test(text)) build.advance(fraction, text);
    }
    return;
  }

  if (message.type === "running") {
    build.done("boot", "The server is answering requests");
    build.start("ready");
    build.done("ready", `${message.project?.name ?? "The application"} is running`);
    say("The application is running", "ok");
    return;
  }

  if (message.type === "failed") {
    build.fail("boot", message.message);
    say(message.message, "bad");
  }
});

/**
 * Register the worker and wait for it to be genuinely active.
 *
 * `navigator.serviceWorker.ready` is the usual way and is wrong here: it
 * resolves with the registration controlling *this* page, and this page sits
 * outside the worker's scope on purpose — the worker serves the generated
 * application, not the guide around it. So the activation is watched directly.
 */
async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error(
      "This browser has no Service Worker support, which is what serves the application."
    );
  }

  const registration =
    state.registration || (await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE }));
  state.registration = registration;

  if (registration.active) return registration;

  const pending = registration.installing || registration.waiting;
  if (!pending) throw new Error("The Service Worker registered but never started");

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The Service Worker did not activate")), 15000);
    pending.addEventListener("statechange", () => {
      if (pending.state === "activated") {
        clearTimeout(timer);
        resolve();
      }
      if (pending.state === "redundant") {
        clearTimeout(timer);
        reject(new Error("The Service Worker was discarded before it activated"));
      }
    });
  });

  return registration;
}

/** postMessage with an answer, over a one-shot channel. */
function ask(worker, message, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(
      () => reject(new Error("The Service Worker did not answer")),
      timeoutMs
    );
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

$("open-tab").addEventListener("click", () => {
  window.open($("stage-url").textContent, "_blank", "noopener");
});

/* -------------------------------------------------------------------- bits */

function setStep(id, value) {
  $(id).dataset.state = value;
}

function say(message, tone = "") {
  const log = $("log");
  const line = document.createElement("div");
  line.className = tone;
  line.innerHTML = tone === "ok" ? `<b>${escapeHtml(message)}</b>` : escapeHtml(message);
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
  );
}

const titleCase = (value) => value.replace(/\b\w/g, (character) => character.toUpperCase());

/**
 * Find the PGlite served beside this page.
 *
 * Postgres is never fetched from a CDN. `bun run vendor:pglite` puts a copy
 * under `assets/vendor/pglite/` — not in git, it is seventeen megabytes — and a
 * deployment of this page carries it the same way. Without it the page still
 * generates an application, and says before the run step why it cannot start
 * one here.
 */
async function findLocalPglite() {
  const url = new URL("assets/vendor/pglite/index.js", window.location.href).href;
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (response.ok) {
      state.pgliteUrl = url;
      say(`Using the local PostgreSQL build at ${url}`);
      return;
    }
  } catch {
    // Reported below, the same as a 404.
  }
  say(
    `PostgreSQL (PGlite) is not beside this page at ${url}. Run \`bun run vendor:pglite\` ` +
      "to put it there; until then an application can be generated and downloaded, not run here.",
    "warn"
  );
}

await findLocalPglite();
await selectChoice("crm");
