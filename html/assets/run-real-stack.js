/**
 * Assemble the real stack in this tab, then run it in a WebContainer.
 *
 * Two halves with very different confidence behind them, and the page says so
 * rather than presenting them as one thing:
 *
 *   1. Generation. The same pipeline the CLI runs, over `memory-fs`. This is
 *      exercised on every commit against the CLI's own output and matches it.
 *   2. Boot. `@webcontainer/api` mounts those files, installs, migrates and
 *      starts the backend. StackBlitz's hosts are unreachable from where this
 *      was written, so it has never been watched working — see `#limits` in the
 *      page, which says the same thing to the reader.
 *
 * The import of the WebContainer API is deliberately late and guarded. It is
 * served beside this page (`bun run vendor:webcontainer`), never from a CDN,
 * and a reader who only wants to see four hundred files appear should not be
 * stopped because that copy has not been placed. The runtime it then opens is
 * StackBlitz's own service, which is the one thing here that is not local.
 */

// The published validator — the same file `llms.txt` §1.3 points a model at.
// Checking here, when the model is chosen, rather than only inside
// `generateFullStack`: the reader is looking at the model now, and a document
// with an error is not going to become an application by pressing Assemble.
import { checkAndFix } from "../fixer.js";
import { generateFullStack, loadTemplates } from "./appwithai-fullstack.js";

const WEBCONTAINER_API = new URL("vendor/webcontainer-api/index.js", import.meta.url).href;

/** npm colours its output; the log below is already styled. Built from the
 * escape code rather than written literally, because a literal ESC in source
 * is invisible to anyone reading it. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

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

const state = { source: "", label: "", files: null, templates: null, container: null };

/* ---------------------------------------------------------------- progress */

/**
 * Weighted the way the wait actually falls.
 *
 * Assembling four hundred files is under a second; `npm install` is most of a
 * WebContainer run and the reason this page exists at all as a separate thing.
 * A bar that gave each phase a sixth would sit still for minutes at 50%.
 */
const PHASES = [
  { id: "model", label: "Read the model", weight: 3 },
  { id: "check", label: "Check it", weight: 3 },
  { id: "templates", label: "Fetch the templates", weight: 5 },
  { id: "assemble", label: "Assemble the application", weight: 7 },
  { id: "boot", label: "Boot the WebContainer", weight: 15 },
  { id: "install", label: "npm install", weight: 45 },
  { id: "migrate", label: "Migrate and seed", weight: 15 },
  { id: "serve", label: "Start the backend", weight: 10 },
];

const TOTAL = PHASES.reduce((sum, phase) => sum + phase.weight, 0);

const build = {
  status: Object.fromEntries(PHASES.map((phase) => [phase.id, "pending"])),
  within: 0,

  reset() {
    for (const phase of PHASES) this.status[phase.id] = "pending";
    this.within = 0;
    $("build").hidden = false;
    $("build-detail").textContent = "";
    this.paint();
  },

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
      if (this.status[phase.id] === "done") earned += phase.weight;
      else if (this.status[phase.id] === "active") earned += phase.weight * this.within;
    }
    const pct = Math.round((earned / TOTAL) * 100);
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
        : (active?.label ?? "Ready");
    $("build-bar").setAttribute("aria-valuenow", String(pct));
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

for (const [button, kind] of choices) button.addEventListener("click", () => selectChoice(kind));

async function selectChoice(kind) {
  for (const [button, candidate] of choices) {
    button.setAttribute("aria-pressed", String(candidate === kind));
  }
  $("dropzone").hidden = kind !== "upload";
  if (kind === "upload") return setModel("", "");

  const built = BUILT_IN[kind];
  setModel("", "");
  try {
    const response = await fetch(built.path, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    setModel(await response.text(), built.label);
    $("app-name").value = built.name;
  } catch (error) {
    fail(`Could not read <code>${built.path}</code> (${escapeHtml(error.message)}).`);
  }
}

$("file").addEventListener("change", (event) => {
  const input = event.target;
  const file = input.files?.[0];
  if (file) readFile(file);
  // See run-in-browser.js: without this, re-choosing the file you just fixed
  // fires no `change` and the stale findings simply stay on screen.
  input.value = "";
});
for (const type of ["dragenter", "dragover"]) {
  $("dropzone").addEventListener(type, (event) => {
    event.preventDefault();
    $("dropzone").classList.add("is-over");
  });
}
for (const type of ["dragleave", "drop"]) {
  $("dropzone").addEventListener(type, (event) => {
    event.preventDefault();
    $("dropzone").classList.remove("is-over");
    if (type === "drop" && event.dataTransfer.files[0]) readFile(event.dataTransfer.files[0]);
  });
}

async function readFile(file) {
  setModel(await file.text(), file.name);
  const guessed = file.name.replace(/\.(eml\.)?mmd$|\.md$|\.txt$/i, "").replace(/[-_]+/g, " ");
  if (guessed.trim()) {
    $("app-name").value = guessed.trim().replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function setModel(source, label) {
  state.source = source;
  state.label = label;
  state.files = null;
  $("result").className = "result";
  $("result").innerHTML = "";
  $("diagnostics").hidden = true;

  if (!source) {
    $("model-summary").hidden = true;
    $("build").hidden = true;
    setStep("step-generate", "idle");
    setStep("step-run", "idle");
    return;
  }

  build.reset();
  build.start("model", `Reading ${label}`);
  $("model-summary").hidden = false;
  $("model-summary").innerHTML =
    `<code>${escapeHtml(label)}</code> · ${source.split("\n").length.toLocaleString()} lines · ` +
    `${(new Blob([source]).size / 1024).toFixed(0)}KB`;

  setStep("step-model", "done");
  build.done("model");

  build.start("check", "Checking the model against the EML language definition");
  const review = checkModel(source);
  if (!review.ok) {
    build.fail("check", `${review.counts.errors} error(s) — nothing was assembled`);
    setStep("step-generate", "idle");
    setStep("step-run", "idle");
    return;
  }
  build.done("check", describeReview(review));

  setStep("step-generate", "active");
  setStep("step-run", "idle");
}

/**
 * Check the model, repairing what the fixer can repair.
 *
 * The repaired source replaces the loaded one, so what gets assembled is what
 * the reader is being shown findings about.
 */
function checkModel(source) {
  let review;
  try {
    const result = checkAndFix(source);
    review = { ...result, issues: result.remaining };
  } catch (error) {
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
  if (review.repaired) state.source = review.source;
  renderDiagnostics(review);
  return review;
}

function describeReview(review) {
  const { errors } = review.counts;
  return [`${errors} error${errors === 1 ? "" : "s"}`, ...describeRest(review)].join(" · ");
}

/** The counts other than errors — the header states that one itself. */
function describeRest(review) {
  const { warnings, infos } = review.counts;
  const applied = (review.fixes || []).filter((fix) => fix.applied).length;
  const parts = [];
  if (applied) parts.push(`${applied} auto-fix${applied === 1 ? "" : "es"} applied`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  if (infos) parts.push(`${infos} info`);
  return parts;
}

/* ------------------------------------------------------------------ step 2 */

$("generate").addEventListener("click", async () => {
  if (!state.source) return fail("Choose a model first.");

  const button = $("generate");
  button.disabled = true;
  button.innerHTML = '<span class="working"></span>Assembling';

  try {
    if (!state.templates) {
      build.start("templates", "Fetching the stack templates");
      state.templates = await loadTemplates();
      build.done("templates", `${Object.keys(state.templates).length} templates`);
    }

    build.start("assemble", "Running the generator");
    const result = await generateFullStack({
      source: state.source,
      templates: state.templates,
      name: $("app-name").value.trim() || "Generated App",
      description: "Generated application",
      onProgress: (_phase, detail) => detail && build.advance(0.5, detail),
    });

    state.files = result.files;
    showResult(result);
    build.done("assemble", `${result.summary.fileCount} files`);
    setStep("step-generate", "done");
    setStep("step-run", "active");
  } catch (error) {
    if (error.review) {
      renderDiagnostics(error.review);
      build.fail("assemble", `${error.review.counts.errors} error(s) — nothing was generated`);
      fail("The checker refused this model. The findings are with the model above.");
    } else {
      build.fail("assemble", error.message);
      fail(escapeHtml(error.message));
    }
  } finally {
    button.disabled = false;
    button.textContent = "Assemble";
  }
});

function showResult(result) {
  const { summary, overlay } = result;
  $("result").innerHTML = `
    <div class="tally">
      ${cell(summary.entities.length, "Entities")}
      ${cell(summary.rules.length, "Rules")}
      ${cell(summary.workflows.length, "Processes")}
      ${cell(summary.fileCount, "Files")}
      ${cell(`${(summary.bytes / 1048576).toFixed(1)}MB`, "Size")}
    </div>
    <p class="result__note">
      The WebAssembly overlay added ${overlay.added.length} files, rewrote
      ${overlay.rewritten.length} and moved ${overlay.debunned.length} scripts off Bun.
      Every other file is what <code>appwithai</code> generates, unchanged.
    </p>`;
  $("result").classList.add("is-shown");
}

const cell = (value, label) =>
  `<div class="tally__cell"><span class="tally__value">${value}</span><span class="tally__label">${label}</span></div>`;

function renderDiagnostics(review) {
  const box = $("diagnostics");
  const loud = review.issues.filter((issue) => issue.severity !== "info");
  if (review.ok && !loud.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.dataset.state = review.ok ? "ok" : "failed";
  const head = review.ok
    ? "The checker accepted this model"
    : `The checker refused this model — ${review.counts.errors} error${review.counts.errors === 1 ? "" : "s"}`;
  box.innerHTML =
    `<div class="diag__head"><b>${head}</b><span>${escapeHtml(describeRest(review).join(" · "))}</span></div>` +
    `<ul class="diags">${loud
      .map(
        (issue) => `<li class="diag diag--${issue.severity}">
          <span class="diag__sev">${issue.severity}</span>
          <span class="diag__code">${escapeHtml(issue.code)}</span>
          ${issue.line ? `<span class="diag__line">line ${issue.line}</span>` : ""}
          <span class="diag__msg">${escapeHtml(issue.message)}</span>
          ${issue.hint ? `<span class="diag__hint">${escapeHtml(issue.hint)}</span>` : ""}
        </li>`
      )
      .join("")}</ul>` +
    (review.ok
      ? ""
      : `<p class="diag__foot"><b>Nothing was assembled.</b> Fix the ${
          review.counts.errors === 1 ? "line above" : "lines above"
        } in your
           <code>.mmd</code> file, save it, and choose it again — this page re-checks every time
           a model is loaded, so you can correct and re-submit until it passes.</p>`);
}

/* ------------------------------------------------------------------ step 3 */

/** The file map, in the shape `container.mount` wants. */
function asTree(files) {
  const tree = {};
  for (const [path, contents] of Object.entries(files)) {
    const parts = path.split("/");
    let node = tree;
    for (const segment of parts.slice(0, -1)) {
      node[segment] ??= { directory: {} };
      node = node[segment].directory;
    }
    node[parts[parts.length - 1]] = { file: { contents } };
  }
  return tree;
}

/** Run a command and stream it into the log; resolve with its exit code. */
async function run(container, command, args, phase) {
  say(`$ ${command} ${args.join(" ")}`);
  const process = await container.spawn(command, args);
  let lines = 0;
  process.output.pipeTo(
    new WritableStream({
      write(chunk) {
        const text = String(chunk).replace(ANSI, "").trimEnd();
        if (!text) return;
        say(`  ${text.split("\n").slice(-1)[0]}`);
        // No progress to read out of npm, so the bar creeps: it is honest about
        // being an estimate and it moves, which a frozen bar does not.
        lines += 1;
        build.advance(Math.min(0.95, lines / 400));
      },
    })
  );
  const code = await process.exit;
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${code}`);
  build.done(phase);
  return code;
}

$("run").addEventListener("click", async () => {
  if (!state.files) return fail("Assemble the application first.");

  const button = $("run");
  button.disabled = true;
  button.innerHTML = '<span class="working"></span>Booting';
  $("log").hidden = false;
  $("log").innerHTML = "";

  try {
    if (!crossOriginIsolated) {
      throw new Error(
        "This page is not cross-origin isolated, which a WebContainer requires. It has to be served " +
          "with Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp — " +
          "`bun run wasm serve html` sets both for this page."
      );
    }

    build.start("boot", "Fetching the WebContainer runtime");
    say("Loading @webcontainer/api");
    const present = await fetch(WEBCONTAINER_API, { method: "HEAD" }).catch(() => null);
    if (!present?.ok) {
      throw new Error(
        `@webcontainer/api is not beside this page at ${WEBCONTAINER_API}, and it is never ` +
          "fetched from a CDN. Run `bun run vendor:webcontainer` and reload."
      );
    }
    const { WebContainer } = await import(/* @vite-ignore */ WEBCONTAINER_API);

    // One container per tab: booting a second throws, and the API says so in a
    // way nobody would connect to having pressed this button twice.
    state.container ??= await WebContainer.boot();
    const container = state.container;
    say("WebContainer booted", "ok");

    say(`Mounting ${Object.keys(state.files).length} files`);
    await container.mount(asTree(state.files));
    build.done("boot", "Files mounted");

    build.start("install", "npm install — this is the long part");
    await run(
      container,
      "npm",
      ["install", "--prefix", "backend", "--no-audit", "--no-fund"],
      "install"
    );

    build.start("migrate", "Migrating and seeding PostgreSQL (WebAssembly)");
    await run(container, "npm", ["run", "--prefix", "backend", "db:setup"], "migrate");

    build.start("serve", "Starting the NestJS backend");
    container.on("server-ready", (port, url) => {
      build.done("serve", `listening on ${url}`);
      $("frame").src = url;
      $("stage").classList.add("is-shown");
      $("stage-url").textContent = url;
      $("credentials").hidden = false;
      $("credentials").innerHTML =
        "Sign in as <b>admin@admin.com</b> with the password <b>admin123</b>. " +
        `The backend is on port ${port}, inside this tab.`;
      say(`The application is running at ${url}`, "ok");
    });
    // Not awaited: this is the long-running server, and `server-ready` above is
    // what says it worked.
    run(container, "npm", ["run", "--prefix", "backend", "start"], "serve").catch((error) => {
      build.fail("serve", error.message);
      say(error.message, "bad");
    });
  } catch (error) {
    const phase = PHASES.find((candidate) => build.status[candidate.id] === "active");
    build.fail(phase?.id ?? "boot", error.message);
    say(error.message, "bad");
    say(
      "The generation half of this page finished in your browser regardless — this failure is the " +
        "WebContainer, which needs the network and cross-origin isolation.",
      "bad"
    );
  } finally {
    button.disabled = false;
    button.textContent = "Boot the WebContainer";
  }
});

/* -------------------------------------------------------------------- bits */

function setStep(id, value) {
  $(id).dataset.state = value;
}

function fail(html) {
  $("result").innerHTML = `<div class="failure">${html}</div>`;
  $("result").classList.add("is-shown");
}

function say(message, tone = "") {
  const line = document.createElement("div");
  line.className = tone;
  line.textContent = message;
  $("log").appendChild(line);
  $("log").scrollTop = $("log").scrollHeight;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
  );
}

await selectChoice("crm");
