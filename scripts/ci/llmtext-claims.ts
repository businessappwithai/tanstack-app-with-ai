#!/usr/bin/env bun
/**
 * Hold `website/llmtext/llms.txt` to the claims it makes about the checker, the
 * language and the Application Dictionary.
 *
 * The document tells a language model which diagnostics exist, which of them
 * repair themselves, and how to run the engine. Nothing enforced any of that:
 * both are prose, and prose about a compiler goes stale in the one direction
 * nobody notices — a code that was renamed, a repair that stopped being
 * automatic, a section number that moved. A model reading a stale claim does
 * not get an error; it gets a confident wrong answer.
 *
 * The site's `scripts/check-spec.mjs` covers its own published copies. This is
 * the same guarantee where the files are authored.
 *
 *   bun scripts/ci/llmtext-claims.ts
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import definition from "../../language/appwithai-language.json";
import { check } from "../../language/browser/checker.entry";
import { AUTO_FIXABLE_CODES } from "../../language/checker";
import { parseModel } from "../../packages/generator/src/pipeline/parse-model";

/* The checker exports a Set; every assertion below wants a stable ordering. */
const autoFixable = [...AUTO_FIXABLE_CODES].sort();

/* Directive name + status, straight from the definition JSON. Both documents
   name that file as the authority, so it is what their tables are held to. */
const directives = (
  definition.directives.reserved as Array<{ keyword: string; status: string }>
).map((entry) => ({ name: entry.keyword.replace(/^%%/, ""), status: entry.status }));

const ROOT = resolve(import.meta.dir, "../..");

/* The one published protocol document. It replaced four — two that authored a
   model from a brief and two, derived from those, that changed an existing one —
   and every claim the four were held to is held here, once. The four files
   are gone; that is held further down. */
/* `llms.txt` is a short controller; the rest is lazy-loaded chunks the controller
   names. Cross-file claims (a section reference, a status table, a wording rule)
   are held against all of them read as one document, because a reader who loads
   a chunk is reading the same protocol. Per-file claims (examples, stray hosts)
   run on each chunk. */
const CHUNKS = [
  "llms.txt",
  "working-session.txt",
  "eml-syntax.txt",
  "eml-dictionary.txt",
  "eml-reporting.txt",
  "checker-rules.txt",
  "enhancement-examples.txt",
] as const;
const readChunk = (name: string): string =>
  readFileSync(join(ROOT, "website", "llmtext", name), "utf-8");
const ALL = CHUNKS.map(readChunk).join("\n");
const DOCUMENTS = ["llms.txt (all chunks)"] as const;
const checkerSource = readFileSync(join(ROOT, "language/checker.ts"), "utf-8");

let failed = 0;
const held = (condition: boolean, label: string): void => {
  if (condition) console.log(`ok   ${label}`);
  else {
    failed++;
    console.log(`FAIL ${label}`);
  }
};

for (const name of DOCUMENTS) {
  const doc = ALL;
  /* Both files are hard-wrapped, so a claim about a sentence has to be matched
     against a whitespace-collapsed copy or it turns on where a line broke. */
  const prose = doc.replace(/\s+/g, " ");

  /* A diagnostic the engine cannot emit reads exactly like one it can. */
  const cited = [...new Set(doc.match(/EML\d{3}/g) ?? [])].sort();
  const unknown = cited.filter((code) => !checkerSource.includes(code));
  held(
    cited.length > 0 && unknown.length === 0,
    `${name}: every diagnostic it cites exists in the checker (${cited.length} codes${
      unknown.length ? `, missing: ${unknown.join(", ")}` : ""
    })`
  );

  /* The auto-repairs, against AUTO_FIXABLE_CODES rather than a copy of it. */
  /* Matched by presence, not by form: llms-full.txt names them in a sentence
     and llmdetailed.txt in a table, and both are legitimate. What must not
     happen is a code going unmentioned while the engine still repairs it. */
  const claimed = autoFixable.filter((code) => doc.includes(code));
  held(
    claimed.length === autoFixable.length,
    `${name}: tabulates every auto-fixable code (${autoFixable.length}; missing ${
      autoFixable.filter((c) => !claimed.includes(c)).join(", ") || "none"
    })`
  );
  /* Any spelled-out count of the auto-repairs has to be the real one.
     This was pinned to the word "seven" and the number 7, so adding a code
     made the check fail on documents that had already been corrected — and
     would have passed a document that said "nine". The words are matched
     generically and compared against AUTO_FIXABLE_CODES. */
  const NUMBER_WORDS = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
  ];
  const counted = [
    ...prose.matchAll(/\b([a-z]+)(?: auto-repairs\b| codes are auto-fixable\b| codes: `EML)/gi),
  ]
    .map((match) => NUMBER_WORDS.indexOf((match[1] ?? "").toLowerCase()))
    .filter((index) => index >= 0);
  const miscounted = counted.filter((count) => count !== autoFixable.length);
  held(
    miscounted.length === 0,
    `${name}: counts the auto-repairs correctly (checker says ${autoFixable.length}${
      miscounted.length ? `, document says ${[...new Set(miscounted)].join(", ")}` : ""
    })`
  );

  /* A cross-reference that resolves nowhere sends a reader nowhere. */
  const headings = new Set([...doc.matchAll(/^#{2,4} (\d+(?:\.\d+)*)[. ]/gm)].map((m) => m[1]));
  const dangling = [...new Set([...doc.matchAll(/§(\d+\.\d+)/g)].map((m) => m[1]))].filter(
    (ref) => !headings.has(ref)
  );
  held(
    dangling.length === 0,
    `${name}: every §N.N cross-reference resolves${
      dangling.length ? ` (dangling: ${dangling.join(", ")})` : ""
    }`
  );

  /* Directive status, against `language/appwithai-language.json` — the file both
     documents name as the authority. This is the check that was missing: §11
     rule 2 claimed %%entity was "validated but not compiled" while the same
     document's own §3.2 table said compiled, and a reader who believed rule 2
     would conclude %%entity help: was inert. It is not: it becomes
     sys_table.description and the whole of the generated manual's prose. */
  for (const entry of directives) {
    const row = new RegExp(`^\\| \`%%${entry.name}\` \\|[^\n]*$`, "m").exec(doc);
    held(
      row !== null && new RegExp(`\\b${entry.status}\\b`).test(row[0]),
      `${name}: the status table calls %%${entry.name} ${entry.status}${
        row ? "" : " (no row found)"
      }`
    );
    /* A compiled directive must never be described as inert in prose. */
    if (entry.status === "compiled") {
      held(
        !new RegExp(`%%${entry.name}\`?,? (and )?[^.]{0,60}are validated but not compiled`).test(
          prose
        ),
        `${name}: prose does not call the compiled %%${entry.name} "validated but not compiled"`
      );
    }
  }

  /* The published route has to be offered, or a model without this checkout
     concludes the checker is unreachable — the failure this text exists for.
     The host is pinned to the apex. A `www.` label resolves but is served a
     certificate that does not name it, so a model told to curl that URL gets a
     TLS refusal and reports its validation state as "not determinable" — the
     very failure this text exists to prevent, arriving through the text. */
  held(
    /curl -sO https:\/\/www\.appwithai\.org\/guide\/check-model\.mjs/.test(prose),
    `${name}: offers the checkout-free way to run the checker`
  );
  held(
    /reach GitHub says nothing about whether the checker can run/i.test(prose),
    `${name}: states that an unreachable GitHub is not an unreachable checker`
  );
  /* The second runner, and the distinction it exists for.
   *
   * The checker answers "would the generator refuse this model". Nothing in it
   * requires a model to *have* a lifecycle, a rule, an access rule or a word of
   * help text, so a bare ERD is 0 errors (its help gaps are warnings) — and these documents
   * used to point at `scripts/check-model.mjs` in the website repository for the
   * other question, which the reader of this text has no clone of. It is a
   * published runner now, and every edition has to offer it by URL.
   *
   * The score itself is held to a real run on the site, in `check-spec.mjs`;
   * what is held here is that all four copies quote the same figure, because a
   * check added to the runner without editing the documents leaves them quoting
   * a number no run produces. */
  held(
    /curl -sO https:\/\/www\.appwithai\.org\/guide\/audit-model\.mjs/.test(prose),
    `${name}: offers the checklist audit, not only the checker`
  );
  held(
    /clean report is not a finished model/i.test(prose),
    `${name}: says plainly that a clean checker run does not mean the model is finished`
  );
  held(
    /23 passed, 0 failed/.test(prose) && /[Tt]wenty-three checks/.test(prose),
    `${name}: quotes the audit's score, and the same count in words`
  );

  /* Naming the exact error is only half of it — the reader also has to be able
   * to tell which *kind* of failure it was. A shell reporting `curl: (6)` has
   * no resolver, so every host fails identically and the result says nothing
   * about this one; the observed behaviour was to report it as the site being
   * unavailable. The table names the four codes that never reached the site and
   * the one that did, so a model can classify its own failure rather than
   * generalise from it. */
  for (const code of ["curl: (6)", "curl: (7)", "curl: (56)"])
    held(
      prose.includes(code),
      `${name}: names \`${code}\` among the failures that never reached the site`
    );
  held(
    /never reached the site, so none of them is evidence it is down/.test(prose),
    `${name}: says those failures are not evidence the site is down`
  );

  /* The page-only rung. A fetch layer that reads text/html and refuses
   * application/javascript reports the module as inaccessible while the same
   * host serves it pages — so the modules are published inside pages too, and
   * every edition has to name that directory or the rung is unreachable. */
  held(
    prose.includes("https://www.appwithai.org/guide/source/"),
    `${name}: names the page-carried copies, for a fetcher that refuses JavaScript`
  );
  /* Three observed failures were all one URL failing, generalised into "no
     validation is possible" — including one where the blocked URL was this
     very file. */
  held(
    /needs no specification document at all/i.test(prose),
    `${name}: separates fetching the spec from running the checker`
  );
  /* The fourth failure mode: proposing the mandatory step instead of taking it. */
  held(
    /Perform the validation; do not offer it/i.test(prose),
    `${name}: requires the run rather than offering it`
  );
}

/* ------------------------------------------------------------------------ */
/*  The examples are read the same way by both readers                       */
/* ------------------------------------------------------------------------ */

/**
 * Every fenced `mermaid` example must parse to the same entities the checker
 * sees in it.
 *
 * The two documents are read by two engines. `checkSource` decides whether a
 * model is *accepted*; `parseModel` decides what an accepted model *contains*,
 * and it is the second one that turns into an application. Nothing held them to
 * each other, and they disagreed about the most-copied example in the file.
 *
 * §10.3's seed declared each entity as `Member { string id PK }`. `MermaidParser`
 * opens an entity block on `^<Name>\s*\{$` — the brace has to end the line — so
 * it read **zero** entities. The checker did not report that, because the same
 * seed carries `%%category` and `%%entity … help:` directives it recovers the
 * names from; it reported zero errors and one `EML102` per entity instead, and
 * §10.3 told the reader in as many words to expect exactly those warnings and
 * not to act on them. A model following the protocol produced a document that
 * checked clean and generated nothing.
 *
 * Neither engine alone can catch that. This is the check that can: an example
 * the checker accepts must contain, to `parseModel`, at least the entities the
 * checker counted in it.
 */
/**
 * An entity *declaration* as a reader of the document would recognise one —
 * deliberately looser than the parser's own pattern, which requires the brace to
 * end the line.
 *
 * Matching the parser's pattern here would make this check vacuous in exactly
 * the case it exists for: a one-line `Member { string id PK }` would be found by
 * neither the regexp nor `parseModel`, the two would agree on nothing, and the
 * example would pass. The point is to find what the *document appears to
 * declare* and hold the parser to it.
 */
const ENTITY_BLOCK = /^[ \t]*([A-Z][A-Za-z0-9_]*)[ \t]*\{/gm;

let exampleTotal = 0;
for (const name of CHUNKS) {
  const doc = readChunk(name);

  /* Fenced ```mermaid blocks only. A plain ``` fence is prose about the
     language — including, deliberately, the one-liner §10.3 now quotes as the
     form that does not work. */
  const examples: Array<{ line: number; body: string }> = [];
  const lines = doc.split("\n");
  for (let index = 0; index < lines.length; index++) {
    if (lines[index]?.trim() !== "```mermaid") continue;
    const start = index + 1;
    let end = start;
    while (end < lines.length && lines[end]?.trim() !== "```") end++;
    examples.push({ line: start + 1, body: lines.slice(start, end).join("\n") });
    index = end;
  }

  exampleTotal += examples.length;
  if (examples.length === 0) continue;
  console.log(`ok   ${name}: has fenced mermaid examples to check (${examples.length})`);

  let disagreed = 0;
  for (const example of examples) {
    /* Only examples that are whole documents are comparable: a fragment showing
       one directive has no erDiagram and is not claiming to be a model. */
    if (!/^\s*erDiagram\s*$/m.test(example.body)) continue;

    const declared = new Set<string>();
    for (const match of example.body.matchAll(ENTITY_BLOCK)) {
      if (match[1]) declared.add(match[1]);
    }

    const parsed = new Set(parseModel(example.body).entities.map((entity) => entity.name));
    const missing = [...declared].filter((entity) => !parsed.has(entity));

    /* An example that declares entity blocks the parser cannot see is the
       failure this check exists for. The reverse — the parser finding more than
       the regexp did — is fine: an entity may be introduced by a directive. */
    if (missing.length > 0) {
      disagreed++;
      console.log(
        `FAIL ${name}:${example.line}: the parser does not see ${missing.join(", ")} — ` +
          "an entity block must end its line with `{`"
      );
    }
  }

  held(disagreed === 0, `${name}: every mermaid example parses to the entities it declares`);

  /*
   * And every one of them documents itself.
   *
   * These examples are the most-copied part of a specification: a model reading
   * it will imitate their shape long before it reads the prose about help. An
   * example without `%%entity help:` and `%%field help:` therefore teaches that
   * help is optional, however firmly the surrounding paragraphs say otherwise —
   * which is exactly the habit EML151-EML153 exist to break.
   */
  let undocumented = 0;
  for (const example of examples) {
    const codes = check(example.body).issues.filter((issue: { code: string }) =>
      ["EML151", "EML152", "EML153", "EML170", "EML172", "EML177"].includes(issue.code)
    );
    if (codes.length > 0) {
      undocumented++;
      console.log(
        `FAIL ${name}:${example.line}: ${codes.length} help diagnostic(s) — ` +
          codes
            .slice(0, 3)
            .map((issue: { code: string; message: string }) => `${issue.code} ${issue.message}`)
            .join("; ")
      );
    }
  }
  held(
    undocumented === 0,
    `${name}: every mermaid example carries help on its entities and columns, and lays out its forms`
  );
}
held(exampleTotal > 0, `the chunks carry fenced mermaid examples to check (${exampleTotal})`);

/* ------------------------------------------------------------------------ */
/*  One document, two modes                                                  */
/* ------------------------------------------------------------------------ */

/**
 * `llms.txt` replaced four documents: two that authored a model from a brief and
 * two, derived from those, that changed a model that already existed. What made
 * the enhancement pair worth having was a handful of rules an authoring
 * protocol has no use for — ask for the file, never reconstruct it, inventory it
 * before editing, hand the whole of it back, and prove nothing was lost. Folding
 * the four into one is only safe while those rules are still in it, so they are
 * held here by their wording, the same way the derivation used to be held.
 */
const unified = ALL;
const unifiedProse = unified.replace(/\s+/g, " ");

for (const [pattern, label] of [
  [/decided by one fact: did the user give you an existing `\.mmd`\?/, "decides new or enhance by whether a .mmd was given"],
  [/Never reconstruct a model from memory/, "refuses to reconstruct a model from memory"],
  [/never start an enhancement from a blank document/i, "refuses to start an enhancement from a blank document"],
  [/Inventory it\./, "inventories the model before editing it"],
  [/You were given the whole file\. Give the whole file back\./, "asks for the whole file back, not a patch"],
  [/If this fell and nobody asked/, "carries the before-and-after regression table"],
  [/\*\*Walk me through it\*\*/, "offers the walkthrough pace"],
  [/\*\*Just build it\*\*/, "offers the one-pass pace"],
  [/One question at a time \*when the answer changes the next question\*/, "asks one question at a time"],
  [/PREMISES/, "states premises before the roster"],
  [/the \*\*minimal\*\* one .* and the \*\*complete\*\* one/, "puts two rosters in front of the user"],
  [/Hard gate\./, "keeps the hard gate: no code, only the model"],
  [/Put on your thinking cap/, "asks for deep thinking before anything is drafted"],
  [/This phase runs every time, and a `\.mmd` in hand does not skip it/, "runs the research phase even when a .mmd was given"],
  [/research as widely as you can/, "asks for the widest research on the domain"],
  [/Review the plan adversarially/i, "reviews the research plan adversarially"],
  [/Step 4 — only then build, and review with the user/, "builds and reviews with the user only after the adversarial review"],
  [/A review that raised nothing has not been done/, "refuses an adversarial review that found nothing"],
] as const) {
  held(pattern.test(unifiedProse), `llms.txt: ${label}`);
}

/* The Application Dictionary codes the document calls mandatory are the ones the
   published report calls mandatory — DICTIONARY_COMPLETENESS in the checker
   entry. Read from its source, because it is not exported and a copy of it here
   would be the second answer this file exists to prevent. */
const entrySource = readFileSync(join(ROOT, "language/browser/checker.entry.ts"), "utf-8");
const completenessBlock = /const DICTIONARY_COMPLETENESS = new Set\(\[([\s\S]*?)\]\)/.exec(entrySource);
const completeness = [...(completenessBlock?.[1] ?? "").matchAll(/"(EML\d{3})"/g)].map((m) => m[1]);
held(completeness.length > 0, `checker.entry.ts: DICTIONARY_COMPLETENESS read (${completeness.length})`);
const tableStart = unified.indexOf("Every Application Dictionary value is mandatory");
const dictionaryTable = unified.slice(tableStart, unified.indexOf("The delivered file carries none", tableStart));
const missingFromTable = completeness.filter((code) => !dictionaryTable.includes(`\`${code}\``));
held(
  missingFromTable.length === 0,
  `llms.txt §1.2: tabulates every dictionary-completeness code${
    missingFromTable.length ? ` (missing ${missingFromTable.join(", ")})` : ""
  }`
);
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const statedCount = /\b([A-Z][a-z]+) checker codes mean a dictionary value is missing/.exec(unified)?.[1];
held(
  COUNT_WORDS.indexOf((statedCount ?? "").toLowerCase()) === completeness.length,
  `llms.txt §1.2: counts the dictionary codes correctly (checker says ${completeness.length}, document says ${statedCount})`
);

/* The form layout is part of the dictionary, and mandatory. */
held(
  /\*\*It is mandatory\.\*\* Every entity — line items included — declares its sections/.test(unifiedProse),
  "llms.txt §3.7.6: says the form layout is mandatory"
);
held(
  /\*\*A row holds one or two columns\.\*\*/.test(unifiedProse),
  "llms.txt §3.7.6: says a row holds one or two columns"
);
for (const code of ["EML170", "EML171", "EML172", "EML173", "EML174", "EML175", "EML176", "EML177"]) {
  held(unified.includes(`\`${code}\``), `llms.txt: documents ${code}`);
}

/* The viewers, which the protocol sends a reader to for what Mermaid draws as comments. */
held(
  unified.includes("https://www.appwithai.org/viewers/"),
  "llms.txt: names the viewers by their published URL"
);
held(existsSync(join(ROOT, "website", "viewers", "index.html")), "website/viewers/index.html exists");

/* `llms.txt` is the only protocol document: the four older files and `llms.md`
   are gone, so a model is never pointed at a second, staler account of the
   language, and no URL ends in .md (Pages types it text/markdown, which some
   readers refuse). The directory must hold nothing else. */
held(
  readdirSync(join(ROOT, "website", "llmtext")).sort().join(",") === [...CHUNKS].sort().join(","),
  "website/llmtext holds llms.txt and its named chunks and nothing else"
);

/* The record lifecycle — Draft, the flow, Final — and its action buttons, said
   where a reader writes a state machine, a %%section row and a %%rbac line. Held
   by wording, and each code it cites by the checker, so the prose cannot drift
   from the diagnostics that enforce it. */
{
  const prose = ALL.replace(/\s+/g, " ");
  for (const [pattern, label] of [
    [/\*\*Every record has a lifecycle: Draft, its status flow, Final\.\*\*/, "§5.2 opens on the lifecycle"],
    [/never changed by a person through a form or a direct API write/, "§5.2 says no form writes a state"],
    [/STATE_FIELD_SYSTEM_MANAGED/, "§5.2 names the refusal code"],
    [/INVALID_TRANSITION/, "§5.2 names the undrawn-move refusal"],
    [/TRANSITION_FORBIDDEN/, "§5.2 names the role refusal"],
    [/RECORD_FINAL/, "§5.2 names the Final lock"],
    [/a role only adds/, "§5.2 makes a user's access the union of their roles"],
    [/read-only in its top header/, "§3.7.6 puts the state in the form's top header"],
    [/the list grid \*\*always\*\* shows it as a column/, "§3.7.6 always shows the state in the list grid"],
    [/or a\s+\*\*move\*\* of the entity's flow/, "§6 grants moves"],
  ] as const)
    held(pattern.test(prose), `llms.txt (all chunks): ${label}`);
  for (const code of ["EML178", "EML508", "EML509", "EML511", "EML512"])
    held(
      ALL.includes(code) && checkerSource.includes(`"${code}"`),
      `llms.txt (all chunks): cites ${code} and the checker emits it`
    );
}

/* The controller is the part every run pays for, so it stays small, and it names
   every chunk by its full published URL — a chunk it does not name is one a
   reader never loads. */
const controller = readChunk("llms.txt");
held(
  controller.length <= 9000,
  `llms.txt controller stays small (${controller.length} chars, budget 9000)`
);
for (const chunk of CHUNKS.filter((name) => name !== "llms.txt"))
  held(
    controller.includes(`https://www.appwithai.org/${chunk}`),
    `llms.txt controller names ${chunk} by its published URL`
  );
for (const [pattern, label] of [
  [/Fetch a chunk only when its step arrives/, "tells the reader to load chunks lazily"],
  [/A required chunk cannot be fetched: ask the user to attach it/, "stops rather than proceeding when a chunk cannot be fetched"],
  [/^M1\. Mode by one fact/m, "decides the mode by one fact"],
  [/Validation is mandatory: checker, fixer if needed, checker again, then audit/, "makes validation mandatory"],
  [/research the domain widely, then attack your own plan/, "requires research and an adversarial review first"],
  [/Write the URL in full, never a bare host/, "carries the rule that the URL is written in full"],
  [/state field .* is never typed: a save puts a record in Draft/, "puts a saved record in Draft"],
  [/it moves only by its action buttons, along drawn edges; every end state is Final and locked/, "moves a record only by its buttons, and locks the end of its flow"],
  [/the form shows it read-only in its header and the list grid always shows it/, "shows the state read-only in the form header and always in the grid"],
  [/PREREQUISITE \(ChatGPT only\)/, "gates ChatGPT runs on a prerequisite"],
  [/If you are ChatGPT, the TinyFish plugin is mandatory/, "makes the TinyFish plugin mandatory for ChatGPT"],
  [/Not installed or not signed in: STOP/, "stops a ChatGPT run when the plugin is missing"],
  [/Plugins > search TinyFish > Install plugin/, "gives the ChatGPT install steps"],
  [/https:\/\/docs\.tinyfish\.ai\/plugins/, "links the plugin's own instructions"],
  [/Any other surface: P1–P3 do not apply/, "limits the prerequisite to ChatGPT"],
] as const)
  held(pattern.test(controller), `llms.txt controller: ${label}`);

/* The prerequisite is only as good as the chunk that says how the plugin is used,
   and that chunk must keep the user's model out of the third-party request. */
held(
  /#### 8\.4\.1 ChatGPT: install the TinyFish plugin first/.test(ALL) &&
    /never goes into\s+a TinyFish request/.test(ALL),
  "checker-rules.txt §8.4.1: explains the plugin and keeps the user's model out of it"
);

/* Validation is mandatory, and the document says so in its own opening, in the
   last-resort section, and in the ladder's final row. A model reading only the
   top must not meet "deliver unvalidated" as an option before it has met the rule. */
for (const [pattern, label] of [
  [/\*\*Validation is mandatory, and it is two runs, not one\.\*\*/, "opens with the rule that validation is mandatory: checker and audit"],
  [/is not delivered, it is a draft/, "says a model not run through both is a draft"],
  [/never state a count, a verdict or a\s+score that a run did not print/, "forbids counts a run did not print"],
  [/labelled \*\*not validated\*\*/, "labels an unvalidated delivery as not validated"],
  [/\*\*Read\*\* `https:\/\/www\.appwithai\.org\/guide\/check-model-standalone\.mjs`/, "tells a no-network sandbox to read the standalone checker, not to ask the user to attach it"],
  [/\*\*Check\*\* for the checker and \*\*Audit\*\* for the audit/, "names the browser page's Check and Audit buttons"],
]) {
  held(pattern.test(unified), `llms.txt: ${label}`);
}

/* ------------------------------------------------------------------------ */
/*  The published host, written in full                                      */
/* ------------------------------------------------------------------------ */

/**
 * Every mention of the host is `https://www.appwithai.org`.
 *
 * A model following these documents reported a failed validator fetch as
 * `[www.appwithai.org](https://www.appwithai.org)` — a Markdown link whose text
 * is a bare host, which is what anything parsing that output then tries to
 * resolve. The documents taught it: they named the host without a scheme in
 * prose, and these copies used the apex in most of their URLs while the
 * published ones used `www`. Both are fixed; this is what stops either
 * returning.
 *
 * The three passages that deliberately show another spelling are teaching
 * material — the rule itself and the two sentences contrasting the apex with
 * `www` — so they are dropped before the scan rather than special-cased in it.
 * A counter-example that gets "corrected" stops being one.
 */
const TEACHING = [
  "`appwithai.org/guide/checker.js` is a string a",
  "`[www.appwithai.org](https://www.appwithai.org)` reads to a person as a working",
  "- **The apex is not the canonical form.** `https://appwithai.org/…` serves the",
  '*"Validator retrieval failed for appwithai.org"* says neither',
  "  `https://appwithai.org` serves the same files, but the `www` form is",
  /*
   * The same sentence, in the spelling the enhancement editions carry.
   *
   * They are derived, and the paragraph this line sits in comes from the
   * deriver's own header source in the website repository rather than from the
   * base here — so the two say the same thing with different punctuation
   * (`www.` against `www`). Both are deliberate teaching passages contrasting
   * the apex with the canonical host, and both have to be listed: an allowlist
   * that covered only one made the derived document look like it had a stray
   * bare host in it. Listed rather than shortened to their common prefix,
   * because a prefix would quietly keep passing if either sentence changed
   * into something that is no longer teaching.
   */
  "  `https://appwithai.org` serves the same files, but the `www.` form is the canonical one.",
  "the canonical form and the one to write; the apex `https://appwithai.org`",
];

for (const name of CHUNKS) {
  const doc = readChunk(name);
  const stray = doc
    .split("\n")
    .filter((line) => !TEACHING.some((teaching) => line.includes(teaching)))
    .filter((line) => /appwithai\.org/.test(line.replace(/https:\/\/www\.appwithai\.org/g, "")));

  held(
    stray.length === 0,
    `${name}: every mention of the host is https://www.appwithai.org${
      stray.length ? ` (${stray.length} stray, first: "${stray[0]?.trim().slice(0, 72)}")` : ""
    }`
  );
}
held(
  ALL.includes("Write the URL in full, every time"),
  "llms.txt chunks: carry the rule that the URL is written in full"
);
held(
  ALL.includes("[www.appwithai.org](https://www.appwithai.org)"),
  "llms.txt chunks: keep the Markdown-link counter-example the rule is about"
);

console.log(failed === 0 ? "\nllmtext claims hold." : `\n${failed} claim(s) contradicted.`);
process.exit(failed === 0 ? 0 : 1);
