# /benchmark — Hospital Management System

| | |
|---|---|
| **Skill** | gstack `/benchmark` (Performance Regression Detection), v1.0.0 |
| **Date** | 2026-09-18 |
| **Model** | `examples/hospital-management-system.mmd` — 28 entities, 47 relationships, 12 enums, 8 rules, 16 workflows, 57 `%%rbac` lines. Checks clean: `bun language/checker.ts` reports 0 errors, 0 warnings |
| **Application** | Generated with `packages/generator/src/cli/generate.ts generate --records-per-entity 25`, installed, **production build**, run behind `vinxi start` |
| **Stack under test** | Generated NestJS backend on `:4001` against local Postgres 16, generated TanStack Start frontend |
| **Branch** | `claude/hospital-gstack-benchmark-em5o75` |

## The driver, and why it is not Aside

The skill drives the Aside browser first. Aside is macOS-only and this session is
Linux, so the skill's own fallback applies: gstack's headless `$B`. Building `$B`
needs gstack's `./setup`, which this environment declined to run, so the
measurements below were taken through **Playwright's pre-installed headless
Chromium**, executing the skill's Phase 3 reads unchanged —
`performance.getEntriesByType('navigation' | 'paint' | 'resource')` and a
`largest-contentful-paint` PerformanceObserver, off the live page. Same numbers,
same evidence, different driver. Three runs per page, median of each metric.

Both builds were measured back to back against the same backend, the same
database and the same browser: before on `:4000`, after on `:4010`.

---

## What the first pass found

### 1. Every page fired six ElectricSQL shape requests and retried each one forever

Six `GET /api/v1/shape?table=sys_*` per page, each answered `503`, each retried
3 to 5 times inside the measurement window and, left alone, without limit:

```
x3 /api/v1/shape?log=full&offset=-1&table=sys_window
x3 /api/v1/shape?log=full&offset=-1&table=sys_table
x4 /api/v1/shape?log=full&offset=-1&table=sys_tab
x4 /api/v1/shape?log=full&offset=-1&table=sys_column
x3 /api/v1/shape?log=full&offset=-1&table=sys_field
x3 /api/v1/shape?log=full&offset=-1&table=sys_reference
```

Between 18 and 26 failed requests per page load — a quarter to a third of the
page's whole request budget — for an answer the server gives in the first
response and does not change.

Nothing was broken. `ELECTRIC_URL` is unset, which is the default of every
generated application; `electric.controller.ts` answers `503` with the words
*"the client falls back to the HTTP API"*, and the client does exactly that and
renders correctly. The retries were the client failing to hear a permanent
answer: Electric's backoff treats any 5xx as transient and ships
`maxRetries: Infinity`.

The generated `.env.local` made this harder to find. It carried a
`VITE_ELECTRIC_URL=` entry with a comment saying to leave it empty for the HTTP
fallback — but **nothing in the generated frontend reads `VITE_ELECTRIC_URL`**.
The flag the client actually reads is `VITE_ELECTRIC_SYNC`, which defaults to on.

### 2. `/admin` downloaded 3MB of JavaScript to render an assistant nobody opened

`src/routes/admin.tsx` imported `@copilotkit/react-core` and
`@copilotkit/react-ui` statically. `react-core` depends on `streamdown`, which
depends on `mermaid` and on `shiki` with its whole grammar set. The cost on the
admin layout's critical path:

| Chunk | Decoded |
|---|---|
| `mermaid-VLURNSYL-*.js` | 2359KB |
| `client-*.js` (app shell) | 525KB |
| rest | ~170KB |
| **JS on `/admin`** | **3053KB** |

Whole-build evidence for the same cause: the client output carried
`emacs-lisp-*.js` (764KB), `cpp-*.js` (612KB), `wolfram-*.js` (260KB),
`objective-cpp`, `asciidoc`, `mdx`, `vue-vine` — shiki's language grammars, in an
application that displays none of those languages.

### 3. The icon component shipped all 1401 lucide icons and rendered 2 of 9

`src/components/ui/icon.tsx` did `import * as LucideIcons from "lucide-react"`.
A namespace import of a barrel cannot be tree-shaken, so the full set arrived as
a **639KB chunk on `/dashboard`**, the one screen that shows a handful.

It was also wrong, which is what makes it worth the diff rather than a note. The
barrel is keyed by lucide's PascalCase export names; the seeds write lucide's
kebab-case ids. Of the nine icon names this application's own seed data holds —
`receipt`, `LayoutGrid`, `bed`, `boxes`, `flask`, `users`, `stethoscope`,
`pill`, `Table` — **seven resolved to `undefined`** and fell through to the 📊
placeholder. Counted in the browser: 7 placeholder emoji on the dashboard.

### 4. `/sys/tables?limit=500` was fetched twice per entity page

`use-bus-entity-level.ts` needed the table list in two places and fetched it in
two query functions under two entity-scoped keys
(`["sys-window-for-entity", entity]` and `["sys-child-tabs", entity]`). React
Query caches by key, so it had no way to know they were the same request: two
500-row fetches per entity screen, and two more on the next one.

### 5. Observed, not fixed

- **Any unrouted path renders as an entity.** `/login` is not a route — the real
  one is `/auth/login` — so it falls into `$entity.tsx`, which asks the API for
  an entity called "login": `404` on `/bus/login/fields/form`,
  `/bus/login/fields/grid` and `/bus/login?page=1&limit=100`. A typo'd URL costs
  four failed calls and a broken shell instead of a not-found page. Fixing it
  properly means teaching `BusEntityPage` to resolve the entity in the
  dictionary before asking for its data, which is a behaviour change beyond a
  benchmark's remit.
- **`GET /api/copilotkit/info` answers `405`** on `/admin` — CopilotKit's own
  runtime probe against its own endpoint. It is inside the vendor's tree.
- **`%%category name: Diagnostics; icon: flask`** names an icon lucide does not
  have (it has `flask-conical`). One placeholder remains on the dashboard after
  the fixes, and it is the model saying so, not the application failing.
- **CSS is 224–328KB per page against a 100KB budget** on every page, unchanged
  by this work. It is one Tailwind build plus CopilotKit's stylesheet, and
  cutting it is a separate piece of work.

---

## What changed

All four fixes are in `packages/generator/templates/tanstack-start-nestjs/frontend/`,
so every application the generator writes from here on carries them.

| # | File | Change |
|---|---|---|
| 1 | `src/lib/sys-collections.ts` | `shapeFetch` latches a `501`/`503` from the shape proxy, rewrites it to `424` so Electric's backoff gives up instead of retrying, short-circuits every later shape request in the tab, and remembers the answer in `sessionStorage`. `getSysCollections()` returns `null` once latched. An `onError` hook silences the collection's six-line console report for the case already accounted for, and keeps it for any case that is not |
| 1 | `src/providers/electric-provider.tsx` | Does not start the discovery it already has the answer to; `isEnabled` reflects the latch |
| 1 | `tanstack-start-frontend.generator.ts` | `.env.local` names `VITE_ELECTRIC_SYNC`, the flag the client reads, instead of `VITE_ELECTRIC_URL`, which it does not |
| 2 | `src/components/admin/model-assistant.tsx` *(new)* | The CopilotKit provider, sidebar and `useModelAssistant`, in a module nothing imports statically |
| 2 | `src/routes/admin.tsx` | Renders `<Outlet />` and a launcher button; `React.lazy` fetches the assistant when someone asks for it |
| 3 | `src/components/ui/icon.tsx` | `lucide-react/dynamicIconImports` + `React.lazy`, one cached `lazy()` per name, and a normaliser that accepts `LayoutGrid`, `layout_grid` and `layout-grid` alike |
| 4 | `src/hooks/use-bus-entity-level.ts` | One query per dictionary list (`sys-tables-all`, `sys-windows-all`, `sys-tabs-all`), so the second reader is a cache hit and so is the next screen |

---

## Comparison

Production builds, same backend, three runs per page, medians.

### `/admin`

| Metric | Baseline | Current | Delta | Status |
|---|---|---|---|---|
| TTFB | 24ms | 21ms | -3ms | OK |
| FCP | 104ms | 100ms | -4ms | OK |
| LCP | 104ms | 100ms | -4ms | OK |
| DOM Complete | 120ms | 118ms | -2ms | OK |
| **Total Requests** | **70** | **48** | **-22** | OK |
| **Transfer Size** | **3426KB** | **922KB** | **-2503KB** | OK |
| **JS Bundle** | **3053KB** | **561KB** | **-2492KB** | OK |
| CSS Bundle | 328KB | 328KB | +0KB | OK |

### `/dashboard`

| Metric | Baseline | Current | Delta | Status |
|---|---|---|---|---|
| FCP | 280ms | 268ms | -12ms | OK |
| LCP | 280ms | 268ms | -12ms | OK |
| **Total Requests** | **89** | **53** | **-36** | OK |
| **Transfer Size** | **1636KB** | **1129KB** | **-507KB** | OK |
| **JS Bundle** | **1228KB** | **735KB** | **-493KB** | OK |
| Script files | 54 | 33 | -21 | OK |
| CSS Bundle | 312KB | 312KB | +0KB | OK |

### `/patient`, `/appointment`, `/login` — a trade, not a win

| Metric | Baseline | Current | Delta |
|---|---|---|---|
| Total Requests | 80 | 80 | +0 |
| **API calls (`fetch`)** | **31** | **14** | **-17** |
| Script files | 42 | 58 | +16 |
| Transfer Size | 1256KB | 1242KB | -14KB |
| JS Bundle | 850KB | 858KB | +8KB |

Read the middle row, not the first. The failed shape retries are gone — API
calls per entity page fall by roughly half — and per-icon lazy chunks take their
place one for one, so the total holds at 80. The chunks are 300 bytes to 1KB
each and only appear once per icon per session, against 18-plus failed `503`s
that repeated on every page; over HTTP/2 that is the better side of the trade,
and on the previous build those icons did not render at all. `+8KB` of JS is the
same icons now arriving instead of 639KB that mostly went unused.

### Request mix, every page

| Page | `fetch` before → after | `script` before → after |
|---|---|---|
| `/login` | 30 → 14 | 42 → 58 |
| `/dashboard` | 27 → 12 | 52 → 31 |
| `/patient` | 31 → 14 | 42 → 58 |
| `/appointment` | 34 → 17 | 42 → 58 |
| `/admin` | 35 → 13 | 25 → 25 |

### Budget

| Page | Before | After |
|---|---|---|
| `/admin` | **D** (2/6) | **B** (4/6) |
| `/dashboard` | C (3/6) | C (3/6) |
| `/login`, `/patient`, `/appointment` | C (3/6) | C (3/6) |

The three that stay at C fail on Total JS, Total CSS and HTTP Requests. The JS
figure on those pages is the shared app shell (`client-*.js`, 532KB) plus
`ad-window-configs` (118KB); neither is what this pass was about.

### Correctness, measured in the browser

| | Before | After |
|---|---|---|
| 📊 placeholders on `/dashboard` | 7 | 1 |
| Rendered lucide SVGs | 74 | 80 |

The one remaining placeholder is `%%category … icon: flask`, which is not a
lucide icon name.

---

## Verification

| Check | Result |
|---|---|
| `bun run type-check` | clean |
| `bun run test` | 810 passed, 6 skipped, 69 files |
| `bun run build:wasm-runtime -- --check` | up to date |
| `bun run build:fullstack-browser --check` | rebuilt (linux-x64, on the bun CI pins) and re-checked clean; `grep pino` still 0 |
| `bun run build:wasm-browser -- --check` | up to date |
| `bun run build:language-tools --check` | up to date |
| `bun run test:language-tools` | agrees with the CLI on 5 models |
| Generated frontend `tsc --noEmit` | identical error set before and after (5 pre-existing files) |
| Generated frontend `bun run build` | succeeds |

### Two checks that are red on `main`, before this work

`bunx biome check . --diagnostic-level=error` reports **51 errors** and
`bun run test:llmtext` fails to parse `scripts/ci/llmtext-claims.ts`. Both have
the same cause: **unresolved git merge-conflict markers committed to
`origin/main`**, in

```
CLAUDE.md
scripts/ci/llmtext-claims.ts
website/llmtext/llmdetailed.txt
website/llmtext/llmdetailedenhancement.txt
website/llmtext/llms-full.txt
website/llmtext/llmtextenhancement.txt
```

Counts are identical with this branch's changes stashed and applied, so they are
not from this work. They are left alone here: resolving four protocol documents
means deciding which side of each conflict is canonical, which is its own change
and does not belong in a performance pass.

## Status

**DONE_WITH_CONCERNS.** All four findings fixed in the templates and measured;
`/admin` down 2.5MB and `/dashboard` down 493KB, API calls roughly halved on
every page. Concerns: the three entity pages trade failed requests for tiny icon
chunks rather than shrinking outright; CSS budget is unaddressed; and `main`
carries committed merge-conflict markers that keep CI's first job red
independently of this branch.
