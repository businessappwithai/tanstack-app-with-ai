# Business Enhancement Document
## Auth, Workflow Automation & Business Rules Engine Integration
### APPWITHAI Hospital Management Software — v5.1 → v6.0

---

## Executive Summary

This document describes the integration of three major open-source systems into the APPWITHAI-generated Hospital Management Software (HMS):

1. **Better Auth** — A framework-agnostic TypeScript authentication & authorization library replacing the current JWT-only auth system
2. **Trigger.dev** — An open-source background job and workflow orchestration platform that intercepts every CRUD operation on HMS entities
3. **GoRules JDM Editor + Zen Engine** — A visual JSON Decision Model editor and rules execution engine that lets business analysts define and execute clinical/administrative rules without code changes

These three systems combine to deliver a fully auditable, rules-driven, transactional entity lifecycle for every record in the Hospital Management System — across both the **Next.js/NestJS** stack and the **OpenUI5/OData V4 TypeScript** stack.

---

## 1. Problem Statement & Business Motivation

### Current State

The current generated HMS applications have:
- Basic JWT authentication with no session management, no social sign-on, no 2FA
- No audit trail on entity changes (who changed what, when)
- No business rules enforcement beyond basic validation
- No workflow or approval processes for clinical entities (e.g., patient admissions, medication orders, discharge summaries)
- Entity state is binary: created or updated — no lifecycle status
- No mechanism for business analysts or clinical administrators to modify rules without developer intervention

### Desired Future State

Every entity in the HMS (Patient, Appointment, Prescription, Invoice, Ward, Doctor, etc.) should:

1. Be protected by a robust, session-aware authentication layer with role-based access control
2. On every CREATE, READ, UPDATE, or DELETE — automatically trigger a background workflow
3. The workflow sets the entity to a **Draft** status while it executes
4. The workflow reads the entity and all its related entities, assembles a JSON context payload
5. The JSON payload is passed through a **GoRules Zen Engine** that evaluates business rules defined visually in the **JDM Editor**
6. The rules engine output JSON is used to update the entity and related entities in a single database transaction
7. The entity status transitions from **Draft → Success** or **Draft → Error** depending on the transaction outcome
8. Business analysts can modify rules in the JDM Editor UI without any code deployment

---

## 2. Technology Overview

### 2.1 Better Auth

| Attribute | Detail |
|-----------|--------|
| Type | TypeScript-first authentication framework |
| License | MIT |
| Integration | Next.js App Router, NestJS (via `@thallesp/nestjs-better-auth`) |
| Auth Methods | Email/password, OAuth (Google, GitHub, etc.), Magic Links, Passkeys, 2FA, SAML |
| Session | Server-side sessions (stored in DB), JWT optional |
| Database | PostgreSQL via Knex adapter (fits existing stack) |
| RBAC | Built-in organization + role management plugin |
| Key Benefit | Replaces fragmented JWT logic with a single, auditable auth layer across both stacks |

**Why Better Auth over alternatives (NextAuth, Auth0, Clerk)?**
- Framework-agnostic: works identically in NestJS (Fastify) and Next.js App Router
- TypeScript-first: full type inference on sessions and users
- Self-hosted: no vendor lock-in, data stays in the project's PostgreSQL instance
- Plugin ecosystem: RBAC, 2FA, API keys, passkeys are all first-class citizens
- The community NestJS adapter (`@thallesp/nestjs-better-auth`) provides guards and decorators that map directly to the existing guard architecture in the generated templates

### 2.2 Trigger.dev

| Attribute | Detail |
|-----------|--------|
| Type | Open-source background jobs & workflow orchestration |
| License | AGPL / Enterprise |
| SDK | `@trigger.dev/sdk` (TypeScript) |
| Integration | Any Node.js/Bun.js app — tasks defined in `/trigger` directory |
| Deployment | Self-hosted (Docker) or Trigger.dev Cloud |
| Key Feature | Tasks survive server restarts, have automatic retry, real-time observability |
| HITL Support | Built-in wait-for-token pattern for human approval steps |

**Why Trigger.dev?**
- Native Bun.js support (the project runtime)
- Tasks are plain TypeScript `async` functions — no DSL to learn
- Database transaction coordination across services fits the pattern of long-running entity lifecycle workflows
- Built-in observability dashboard shows every workflow run, its status, and payload
- The wait-for-token pattern enables future human-approval gates (e.g., a physician must approve a prescription before it leaves Draft)

### 2.3 GoRules JDM Editor + Zen Engine

| Attribute | Detail |
|-----------|--------|
| JDM Editor | Open-source React component for visual decision modeling |
| Zen Engine | Rust-based rules execution engine with Node.js bindings |
| npm package | `@gorules/jdm-editor` (React), `@gorules/zen-engine` (Node.js) |
| Input | JSON context object (entity + related entities) |
| Output | JSON mutations object (fields to update) |
| Node Types | Decision Table, Switch, Expression, Function, Decision (nested rules) |
| Storage | JDM files stored as JSON in the database or filesystem |
| Key Benefit | Business analysts define rules visually; no code changes needed |

**Why GoRules?**
- The JDM editor integrates directly as a React component into the existing Next.js/Shadcn UI design system
- The Zen Engine Node.js binding (`@gorules/zen-engine`) runs inside the Trigger.dev task — no separate rules microservice needed
- Rules are stored as versioned JSON in the database, enabling full audit history of rule changes
- The decision table model maps naturally to clinical protocols (e.g., "if patient age > 65 AND diagnosis = Diabetes THEN flag for dietitian referral")

---

## 3. Business Enhancement Description

### 3.1 Entity Lifecycle State Machine

Every business entity in the HMS gains a lifecycle status field:

```
NONE (default on read) → DRAFT (processing) → SUCCESS (committed) | ERROR (failed)
```

| State | Meaning |
|-------|---------|
| `none` | Entity exists, no pending workflow |
| `draft` | A CRUD operation has been intercepted, workflow is running |
| `success` | Workflow completed, all rules passed, DB transaction committed |
| `error` | Workflow failed (rule violation, DB error, timeout), entity rolled back or flagged |

On READ operations: the status is `none` (reads are non-mutating) but the workflow can still be used to **enrich** the response with computed fields from rules (e.g., calculate a patient's BMI category, risk score, or outstanding balance).

### 3.2 The CRUD Interception Pattern

```
HTTP Request (CREATE/READ/UPDATE/DELETE)
    │
    ▼
Better Auth Guard (validate session + RBAC)
    │
    ▼
Controller (NestJS or OData)
    │
    ▼
Entity Service
    │
    ├── Perform the DB operation (INSERT/SELECT/UPDATE/DELETE)
    │
    ├── Set entity workflow_status = 'draft'
    │
    └── Fire Trigger.dev task (non-blocking, async)
            │
            ▼
        Trigger.dev Task: entity-lifecycle-workflow
            │
            ├── 1. Read entity + all related entities from DB
            ├── 2. Build JSON context payload
            ├── 3. Load matching JDM rule file from DB/filesystem
            ├── 4. Execute Zen Engine with context payload
            ├── 5. Parse Zen Engine output (mutation instructions)
            ├── 6. Open DB transaction
            │       ├── Apply mutations to entity
            │       ├── Apply mutations to related entities
            │       └── Set workflow_status = 'success'
            └── 7. On error: set workflow_status = 'error', log details
```

### 3.3 The Rules Model (JDM)

Each entity type has one or more associated JDM rule files. Examples for HMS:

**Patient Entity Rules:**
- Age-based risk stratification (pediatric / adult / geriatric flags)
- BMI calculation and category assignment
- Allergy conflict detection when medications are present
- Insurance eligibility validation

**Appointment Entity Rules:**
- Doctor availability conflict detection
- Ward capacity checks
- Emergency priority escalation rules

**Prescription Entity Rules:**
- Drug-drug interaction checks
- Dosage validation by patient weight/age
- Controlled substance flag and approval routing

**Invoice Entity Rules:**
- Payment plan eligibility
- Insurance co-pay calculation
- Overdue escalation rules

### 3.4 The JDM Editor UI

A new section is added to the HMS admin panel:

- `/admin/rules` — Lists all JDM rule files per entity
- `/admin/rules/[entity]/[ruleId]` — Opens the JDM Editor React component
- Business analysts can visually edit decision tables and graphs
- Save triggers a versioned update to the `sys_rule_definitions` table
- Rule history and rollback supported

### 3.5 Authentication Enhancements (Better Auth)

#### Replaces / Enhances:
- Current JWT-only auth in NestJS templates → Better Auth sessions + optional JWT
- No auth in OData V4 backend → Better Auth middleware with session validation
- No auth in Next.js frontend beyond API calls → Better Auth client with React hooks

#### New Capabilities:
- Email + password login (improved, with rate limiting)
- Google / Microsoft OAuth (relevant for hospital enterprise deployments)
- Role-based access: `admin`, `doctor`, `nurse`, `receptionist`, `billing`, `readonly`
- 2FA enforcement for sensitive roles (admin, doctor)
- Session revocation on logout (important for shared terminals in clinical settings)
- API key support for machine-to-machine (lab systems, pharmacy integrations)
- Audit log of all authentication events

### 3.6 Trigger.dev Workflow Observability

The HMS admin panel gets a new workflow monitor:

- `/admin/workflows` — Real-time list of all entity workflow runs
- Shows: entity type, entity ID, operation (CREATE/UPDATE/DELETE), status (draft/success/error), duration
- Click into a run to see the full payload, Zen Engine input/output, mutations applied
- Retry failed workflows manually from the UI
- Alert rules for workflows stuck in `draft` beyond a configurable timeout

---

## 4. Data Model Changes

### 4.1 New System Tables

```sql
-- Tracks JDM rule definitions per entity
CREATE TABLE sys_rule_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_name VARCHAR(100) NOT NULL,
  rule_name VARCHAR(100) NOT NULL,
  operation VARCHAR(20) NOT NULL, -- CREATE, READ, UPDATE, DELETE, ALL
  jdm_content JSONB NOT NULL,     -- The JDM JSON file content
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES better_auth_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tracks every workflow run per entity record
CREATE TABLE sys_workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_run_id VARCHAR(255),    -- Trigger.dev run ID for cross-reference
  entity_name VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  operation VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft | success | error
  input_payload JSONB,            -- JSON sent to Zen Engine
  output_payload JSONB,           -- JSON received from Zen Engine
  mutations_applied JSONB,        -- What was actually changed in the DB
  error_details TEXT,
  duration_ms INTEGER,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Better Auth tables (auto-generated by better-auth CLI)
-- user, session, account, verification (standard better-auth schema)
```

### 4.2 Entity Table Changes

Every generated business entity table gains:

```sql
ALTER TABLE [entity_table] ADD COLUMN workflow_status VARCHAR(20) DEFAULT 'none';
ALTER TABLE [entity_table] ADD COLUMN workflow_run_id UUID REFERENCES sys_workflow_runs(id);
ALTER TABLE [entity_table] ADD COLUMN updated_by UUID REFERENCES better_auth_users(id);
ALTER TABLE [entity_table] ADD COLUMN created_by UUID REFERENCES better_auth_users(id);
```

---

## 5. Integration Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
│  Next.js 14 App Router          OpenUI5 Frontend                │
│  Better Auth Client              XSRF + Cookie Session           │
│  JDM Editor React Component      Workflow Monitor View           │
└──────────────────────┬──────────────────────┬───────────────────┘
                       │                      │
┌──────────────────────▼──────────────────────▼───────────────────┐
│                       API LAYER                                  │
│  NestJS 10 / Fastify             OData V4 / Express              │
│  Better Auth Guard               Better Auth Middleware           │
│  @thallesp/nestjs-better-auth    better-auth/node                │
└──────────────────────┬──────────────────────┬───────────────────┘
                       │                      │
┌──────────────────────▼──────────────────────▼───────────────────┐
│                    SERVICE LAYER                                  │
│           Entity Services (CRUD + workflow_status=draft)         │
│           Trigger.dev Task Dispatcher (fire-and-forget)          │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
┌──────────────────────────────────▼──────────────────────────────┐
│                  TRIGGER.DEV WORKER                               │
│  Task: entity-lifecycle-workflow                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  1. Fetch entity + related entities from DB             │    │
│  │  2. Load JDM rule from sys_rule_definitions             │    │
│  │  3. Execute @gorules/zen-engine with JSON context       │    │
│  │  4. Parse output mutations                              │    │
│  │  5. DB Transaction: apply mutations + set status        │    │
│  │  6. Write sys_workflow_runs record                      │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
┌──────────────────────────────────▼──────────────────────────────┐
│                      DATA LAYER                                   │
│         PostgreSQL (entities + auth + rules + workflow runs)     │
│         Knex.js transactions                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. End-to-End Flow Example: Patient Admission (CREATE)

1. Receptionist logs in via Better Auth (email + 2FA)
2. Receptionist submits "Admit Patient" form in Next.js UI
3. POST `/api/patients` hits NestJS controller
4. Better Auth Guard validates session → role = `receptionist` → allowed
5. `PatientService.create()` inserts row → sets `workflow_status = 'draft'`
6. `PatientService.create()` fires `entity-lifecycle-workflow` Trigger.dev task with payload `{ entity: 'Patient', id: '...', operation: 'CREATE' }`
7. HTTP response returns immediately with `{ id, status: 'draft' }` — UI shows "Processing..."
8. Trigger.dev worker picks up task:
   a. Fetches Patient record + related Ward, Doctor, Insurance records
   b. Loads `Patient/CREATE` JDM rule from `sys_rule_definitions`
   c. Zen Engine evaluates: patient age → geriatric flag; insurance → co-pay rate; ward → bed availability
   d. Output: `{ geriatric_flag: true, assigned_ward: 'Ward-C', copay_amount: 150.00, risk_level: 'medium' }`
   e. DB transaction: updates Patient fields, creates preliminary Invoice record, sets `workflow_status = 'success'`
   f. Writes `sys_workflow_runs` record
9. UI polls or uses Trigger.dev Realtime API → status changes to "Success"
10. Patient record now shows enriched fields set by the rules engine

---

## 7. Security Considerations

| Area | Approach |
|------|---------|
| Auth tokens | Better Auth server-side sessions (no long-lived JWTs in localStorage) |
| CSRF | Better Auth CSRF tokens built-in |
| Role enforcement | Better Auth RBAC + NestJS/OData guards — double validation |
| Trigger.dev secrets | `TRIGGER_SECRET_KEY` env var, never exposed to client |
| JDM rule access | Only `admin` role can read/write `sys_rule_definitions` |
| Zen Engine isolation | Runs inside Trigger.dev worker process, no user-supplied code execution |
| Audit trail | Every auth event + every workflow run logged with user ID and timestamp |
| Data at rest | Existing PostgreSQL encryption (no change) |
| Session revocation | Better Auth session store — logout invalidates server-side session immediately |

---

## 8. Impact on Generated Templates

After integration and end-to-end testing, the following generator templates will be updated:

### Next.js/NestJS Stack Templates
| Template | Change |
|----------|--------|
| `auth.module.ts.hbs` | Replace JWT-only with Better Auth module setup |
| `auth.service.ts.hbs` | Replace JWT logic with Better Auth service |
| `auth.controller.ts.hbs` | Replace manual login/register with Better Auth handler mount |
| `jwt.strategy.ts.hbs` | Remove (replaced by Better Auth session strategy) |
| `jwt-auth.guard.ts.hbs` | Replace with Better Auth guard |
| `main.ts.hbs` | Add `bodyParser: false` for Better Auth |
| `app.module.ts.hbs` | Add `AuthModule`, `TriggerModule`, `RulesModule` |
| `bus.service.ts.hbs` | Add workflow_status field management + Trigger.dev dispatch |
| `bus.controller.ts.hbs` | Add `@Session()` decorator usage |
| `package.json.hbs` | Add `better-auth`, `@thallesp/nestjs-better-auth`, `@trigger.dev/sdk`, `@gorules/zen-engine` |
| `.env.example.hbs` | Add `BETTER_AUTH_SECRET`, `TRIGGER_SECRET_KEY`, `TRIGGER_API_URL` |
| NEW: `trigger/entity-lifecycle.task.ts.hbs` | New template for Trigger.dev task |
| NEW: `src/modules/rules/rules.module.ts.hbs` | New GoRules integration module |
| NEW: `src/modules/rules/rules.service.ts.hbs` | Zen Engine wrapper service |
| NEW: `migrations/003_add_workflow_tables.ts.hbs` | sys_rule_definitions + sys_workflow_runs |
| NEW: `migrations/004_add_entity_workflow_fields.ts.hbs` | Per-entity workflow_status column |

### OpenUI5/OData V4 Stack Templates
| Template | Change |
|----------|--------|
| `server.ts.hbs` | Add Better Auth middleware mount |
| `base.controller.ts.hbs` | Add session validation + workflow_status management |
| `bus.controller.ts.hbs` | Add Trigger.dev dispatch post-operation |
| `package.json.hbs` | Add `better-auth`, `@trigger.dev/sdk`, `@gorules/zen-engine` |
| `.env.example.hbs` | Add auth + trigger env vars |
| NEW: `src/auth/better-auth.ts.hbs` | Better Auth instance for OData stack |
| NEW: `src/middleware/auth.middleware.ts.hbs` | Session middleware for OData routes |
| NEW: `src/workflow/entity-lifecycle.task.ts.hbs` | Trigger.dev task |
| NEW: `src/rules/zen-engine.service.ts.hbs` | Zen Engine wrapper |
| NEW: `migrations/003_add_workflow_tables.ts.hbs` | Shared with NestJS stack |

### Next.js Frontend Templates
| Template | Change |
|----------|--------|
| NEW: `app/(auth)/login/page.tsx.hbs` | Better Auth login page |
| NEW: `app/(auth)/register/page.tsx.hbs` | Registration page |
| NEW: `app/admin/rules/page.tsx.hbs` | JDM rule list page |
| NEW: `app/admin/rules/[entity]/[ruleId]/page.tsx.hbs` | JDM Editor React component page |
| NEW: `app/admin/workflows/page.tsx.hbs` | Workflow run monitor |
| `package.json.hbs` | Add `better-auth`, `@gorules/jdm-editor` |

---

## 9. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Auth latency | < 50ms session validation per request |
| Workflow dispatch latency | < 10ms (fire-and-forget, non-blocking) |
| Zen Engine evaluation | < 100ms for typical rule sets |
| End-to-end workflow completion | < 5 seconds for standard entities |
| Retry on failure | 3 automatic retries with exponential backoff |
| Audit retention | 90 days default (configurable) |
| Rule version history | Unlimited (soft-delete with version increment) |
| Concurrent workflows | Configurable via Trigger.dev queue concurrency |

---

## 10. Dependencies & Prerequisites

| Dependency | Version | Purpose |
|------------|---------|---------|
| `better-auth` | ^1.0 | Core auth framework |
| `@thallesp/nestjs-better-auth` | ^1.0 | NestJS integration |
| `@trigger.dev/sdk` | ^3.0 | Background job SDK |
| `@gorules/zen-engine` | ^0.31+ | Rules engine (Node.js binding) |
| `@gorules/jdm-editor` | ^0.19+ | JDM visual editor React component |
| PostgreSQL | 14+ | Required for Better Auth + workflow tables |
| Bun.js | 1.4.4+ | Runtime (already required) |
| Trigger.dev server | v3+ | Self-hosted or Cloud (new infrastructure dep) |

---

## 11. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Better Auth NestJS adapter (community) may lag main library | Medium | Medium | Pin version; fork if needed; fallback to manual integration |
| Trigger.dev adds infrastructure dependency | High | Medium | Docker Compose setup for local dev; Cloud option for prod |
| Zen Engine Node.js bindings Bun.js compatibility | Medium | High | Test early in Phase 1; fallback to WASM build |
| Workflow stuck in `draft` on Trigger.dev outage | Medium | High | Timeout job that resets stuck drafts; circuit breaker pattern |
| JDM rules misconfiguration causes data corruption | Low | High | Rule dry-run mode; staging environment validation; DB transaction rollback |
| Performance impact of async workflow on UX | Low | Medium | UI optimistic updates; Realtime API status polling |

---

## 12. Success Criteria

The integration is considered complete when:

- [ ] All HMS entity CRUD endpoints are protected by Better Auth sessions with RBAC
- [ ] Every CREATE, UPDATE, DELETE on a business entity fires a Trigger.dev workflow
- [ ] The workflow correctly reads entity + related entities and builds JSON context
- [ ] Zen Engine evaluates the JDM rule and returns output mutations
- [ ] DB transaction applies mutations and sets `workflow_status = 'success'` or `'error'`
- [ ] The JDM Editor UI is accessible to admin users and allows rule editing without code changes
- [ ] The workflow monitor shows real-time status of all runs
- [ ] All generator templates are updated and generate correct code for new projects
- [ ] E2E Playwright tests pass for: login, CRUD flow with workflow, rule execution, status transitions
- [ ] Unit tests cover: Better Auth guards, Trigger.dev task logic, Zen Engine service

