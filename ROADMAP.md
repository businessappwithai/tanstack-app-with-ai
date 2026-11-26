# Roadmap to 1.0.0

Five items remain before the release is production grade. One follows it.
[appwithai.org/todo.html](https://appwithai.org/todo.html) carries the same list
in summary; this document holds the scope and acceptance criteria.

Each item states a **Done when** condition that a third party can verify. That
condition is the completion criterion, not a description: an item is not marked
complete until the condition holds, and weakening a condition invalidates the
record. No target dates are given.

## Versioning

`VERSION` currently reads **5.1.1**; the root `package.json` reads 5.1.0. That
number tracked releases rather than production readiness, which a consumer
cannot distinguish from outside. The production-grade release is therefore
**1.0.0** — a deliberate reset. Preserve this reasoning if the version changes.

Two earlier planning documents are superseded and are not part of this roadmap:
`docs/ROADMAP.md` (a "Version 6.0" plan predating the reset) and `TODOS.md`
(deferred work targeting an OpenUI5/OData application this repository no longer
generates).

---

## 1. Comprehensive test coverage

**Current state.** CI generates an application from a model, builds its backend
and front end, migrates a database, starts the server and runs a generated suite
against it — twice, the second time on WebAssembly Postgres with no database
server. This is a foundation, not coverage.

**Scope.**

- End-to-end coverage of the modelling tool's own interface: the project wizard,
  the rule and workflow editors, the automation builder.
- Regeneration over an application whose generated source has already been
  modified.
- Removal of failure tolerance in test and setup paths. `src/migrate.ts` in a
  generated backend logs a failed seed and continues, so `bun run migrate` exits
  0 regardless of whether seeding succeeded.
- Coverage of every documented language directive. `%%loop` is specified in
  `language/spec/03-workflows.md` and referenced by the checker's help text, but
  the multi-line `%%step <id> type: …` form the specification shows is rejected
  by `EML261`, and in the compact form the `in:` property that binds a step to a
  loop is rejected by `EML268` on every step type. No model can use it and pass
  the checker.

**Done when.** Every user-facing path has a test that fails when that path
regresses; no suite or setup script continues past a failed step; and every
directive the language documents is exercised by a model in `language/examples/`
that passes the checker.

## 2. Security assessment

**Scope.** Two dependency trees with different exposure: defects in the platform
are ours; defects in generated applications are deployed by users who relied on
the generator. The second carries the greater risk.

- **Access control enforcement.** `sys_workflow_transitions` is absent from the
  `scaffold` array in
  `packages/generator/src/generators/tanstack-start-nestjs/nestjs-backend.generator.ts`,
  so `012_add_workflow_transitions.ts.hbs` is never rendered, the `05b` seed
  fails, and the topology enforcement block in `entity-access.guard.ts.hbs`
  queries an absent table. Because it refuses only when `validEdges.length > 0`,
  all state transitions are permitted. Remediation is one entry in that array.
- **Negative test coverage for every guard.** A permitted action succeeding does
  not exercise a guard; only a forbidden action being refused does. This is the
  control that would have detected the defect above.
- **Deployment defaults.** Generated applications seed an administrator account
  with a demo password. Appropriate for evaluation, unacceptable in a deployed
  system; the generator should distinguish the two.
- **Secrets and configuration.** `SESSION_SECRET`, `JWT_SECRET` and
  `DB_ENCRYPTION_KEY` handling; the guarantees a generated `.env.example`
  implies; exposure through logs, process listings and committed files.
- **Standard surface.** `requireProjectAccess` coverage on every route that
  touches a project; injection through model-supplied identifiers; rate
  limiting; dependency vulnerability scanning across both trees.
- **Licence compliance**, which the same dependency walk resolves. Each
  dependency's licence read from the package; build-time versus runtime
  classification; compatibility with Apache 2.0 in that role; and whether it
  reaches a generated application, which determines the terms under which the
  user holds their own output. A copyleft runtime dependency introduced through
  a template would remove the user's right to relicense what they generated.

**Done when.** Every access rule the product advertises has a test asserting
refusal of a forbidden action; a generated application cannot be deployed with a
demo credential active; dependency and licence scanning gate CI across both
trees; and all findings, including those still open, are published rather than
summarised.

## 3. Complete product documentation

**Current state.** The twelve-chapter guide builds a CRM. `website/llmtext/llms.txt`
specifies the EML language for language models. Neither documents the product.

**Scope.**

- Installation; the project wizard and the inputs each step expects; the rule and
  workflow editors; the automation builder; the enhance and deploy steps.
- The generation output, and how to continue development against a generated
  application.
- Behaviour that is not self-evident: two stacks produced from one model, the
  browser stack having no per-entity source to edit, and generated applications
  carrying their own manual, test suite and migrations.

**Done when.** A person unfamiliar with the project can go from a clone to a
deployed application they have modified, using the documentation alone, without
consulting the source to determine what a screen does.

## 4. DeepSeek harness integration

**Current state.** The generator targets an OpenAI-compatible endpoint and the
multi-agent pipeline is stack-agnostic by design.

**Scope.** Run the complete pipeline on the DeepSeek harness and keep it there:
every agent, the retrieval that supplies them, the human-in-the-loop review and
the subsequent generation, exercised end to end and verified in CI. This is an
integration, not a configuration change.

Usability is in scope alongside it: infer inputs that can be inferred rather than
prompting for them, report errors as required actions rather than failure
states, and produce models the checker accepts without manual correction.

**Done when.** A plain-language business description entered into the tool
produces a model the checker passes with zero errors and zero warnings, and an
application that runs, on the DeepSeek harness, with no manual correction at any
stage — with identical results from the hosted page and the CLI.

## 5. Reporting application

**Current state.** Enterprise reporting is built as a separate application,
[`businessappwithai/enterprise_reporting_tanstack`](https://github.com/businessappwithai/enterprise_reporting_tanstack).
It is not covered by this repository's CI and is not reachable from a generated
application.

**Scope.**

- Complete test coverage of the reporting application in its own right.
- Integration with AppWithAI: reports defined against the Application Dictionary
  rather than against hand-written SQL, so a report follows the model it was
  built from.
- The access rules a report inherits. A report is a read path over business
  data, so `%%rbac … .read` has to constrain it exactly as it constrains the
  screens — a report that returns rows a role cannot see in the application is a
  hole in the same access control item 2 exists to close.
- How reporting reaches a generated application: shipped with it, or run
  alongside it, and what that implies for deployment and for the licence audit.

**Done when.** The reporting application has end-to-end coverage in CI; a report
built against a generated application's dictionary runs against that application
without hand-written SQL; report output honours the same role visibility as the
application's own screens; and the integration is documented in the manual item 3
delivers.

---

# After 1.0.0

## 6. Autonomous application delivery

An application that builds, tests, documents and deploys itself continuously,
with an agent driving the loop currently driven by an operator.

**Components.**

- **OpenClaw** as the agent runtime: scheduled activation, installable skills and
  persistent memory, against a configured model backend.
- **[NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell)** as the containment
  layer: kernel-level isolation, declarative policy over filesystem, network and
  process execution, enforcement external to the agent, and a complete audit
  trail of allow and deny decisions. It runs OpenClaw unmodified, which makes the
  pairing an integration rather than a reimplementation.

**Dependency on item 2.** An agent authorised to install packages, acquire
skills at runtime, spawn subagents, execute `docker compose` and push to a
repository can perform each of those operations incorrectly, and self-propagating
attacks across agent ecosystems are documented in the literature. Granting that
authority while an access guard fails open is not acceptable, which is why the
security assessment precedes this work.

**Open questions, to be resolved explicitly.**

1. **Autonomy versus human-in-the-loop review**, which the product identifies as
   a differentiator. The working boundary is autonomy over the mechanical loop —
   regenerate, build, test, document, deploy, maintain CI — with human approval
   retained ahead of the model itself. Any change to that boundary is to be
   stated publicly.
2. **OpenShell is early-preview software.** The dependency is a considered risk
   and requires a fallback position.

**Done when.** The agent takes a model from approved to deployed and maintains it
with no human in the mechanical path; every action it performed is reconstructable
from the sandbox audit trail; the policy denies by default, so an ungranted
capability produces a refusal rather than an omission; and removing the agent
leaves a repository that can still be developed manually.
