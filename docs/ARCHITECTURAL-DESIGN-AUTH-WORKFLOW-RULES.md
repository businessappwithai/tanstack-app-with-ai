# Architectural Design Document
## Auth, Workflow Automation & Business Rules Engine Integration
### APPWITHAI Hospital Management System — v5.1 → v6.0

---

**Document Version**: 1.0
**Author**: APPWITHAI Architecture Team
**Date**: March 30, 2026
**Status**: Design Review
**Related Documents**:
- ENHANCEMENT-AUTH-WORKFLOW-RULES.md (Business Requirements)
- IMPLEMENTATION-PHASES.md (Implementation Plan)
- architecture.md (Current System Architecture)

> **Historical note**: this document was written while the generator still
> targeted two stacks. The OpenUI5 / OData V4 stack has since been removed —
> TanStack Start + NestJS is the only stack. The auth, workflow and business
> rules design below still applies; ignore the OpenUI5/OData columns and
> examples.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Proposed Architecture](#3-proposed-architecture)
4. [Detailed Component Design](#4-detailed-component-design)
5. [Integration Strategy](#5-integration-strategy)
6. [Data Flow & State Machine](#6-data-flow--state-machine)
7. [Security Architecture](#7-security-architecture)
8. [Database Schema Design](#8-database-schema-design)
9. [API Design](#9-api-design)
10. [Migration Strategy](#10-migration-strategy)
11. [Testing Strategy](#11-testing-strategy)
12. [Deployment Strategy](#12-deployment-strategy)
13. [Monitoring & Observability](#13-monitoring--observability)
14. [Performance Considerations](#14-performance-considerations)
15. [Failure Scenarios & Recovery](#15-failure-scenarios--recovery)
16. [Rollback Strategy](#16-rollback-strategy)

---

## 1. Executive Summary

### 1.1 Purpose

This document provides the complete technical architecture for integrating three major open-source systems into APPWITHAI-generated Hospital Management Systems:

1. **Better Auth** — Modern authentication and authorization framework
2. **Trigger.dev** — Background job and workflow orchestration platform
3. **GoRules JDM Editor + Zen Engine** — Visual business rules management and execution engine

### 1.2 Business Value

The enhancement transforms the HMS from a basic CRUD system into a fully auditable, rules-driven, transactional entity lifecycle management system with:

- **Robust Authentication**: Session-based auth, RBAC, OAuth, 2FA
- **Complete Audit Trail**: Every CRUD operation tracked with user context
- **Business Rules Engine**: Clinical/administrative rules configurable without code changes
- **Workflow Automation**: Automatic processing of entity state changes
- **Enterprise-Grade Security**: Fine-grained access control, session management, audit logging

### 1.3 Scope

This enhancement applies to both generated application stacks:

- **Next.js/NestJS Stack**: React frontend + NestJS backend
- **OpenUI5/OData V4 Stack**: OpenUI5 frontend + OData V4 backend

The enhancement will be integrated into the APPWITHAI code generator templates so that all future generated projects include these capabilities by default.

### 1.4 Key Architectural Decisions

| Decision | Rationale | Impact |
|----------|-----------|---------|
| Better Auth over Auth0/NextAuth | Framework-agnostic, self-hosted, TypeScript-first | Unified auth across both stacks, no vendor lock-in |
| Trigger.dev over Bull/Agenda | Native Bun.js support, observability, HITL patterns | Better observability, future-proof for approval workflows |
| GoRules over Drools/Excel | Visual editor, Node.js native, JSON-based rules | Business analyst self-service, no Java dependency |
| Async workflow over synchronous processing | Non-blocking API responses, better UX | Improved scalability, eventual consistency model |
| Draft → Success/Error state machine | Clear lifecycle visibility, error recovery | Better monitoring, retry capabilities |

---

## 2. Current State Analysis

### 2.1 Existing Architecture

The current APPWITHAI v5.1 system comprises:

```
┌─────────────────────────────────────────────────────────────┐
│                    APPWITHAI Platform                        │
├─────────────────────────────────────────────────────────────┤
│  @appwithai/core     │ Hook System, RBAC Types, Services     │
│  @appwithai/ai       │ Mastra.ai Agents, HITL Workflows      │
│  @appwithai/generator│ Mermaid Parser, Handlebars Templates  │
│  @appwithai/web      │ Next.js Web App, CopilotKit           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              Generated HMS Application                       │
├─────────────────────────────────────────────────────────────┤
│  Frontend: Next.js 14 / OpenUI5                             │
│  Backend:  NestJS 10 / OData V4                             │
│  Database: PostgreSQL + Knex.js                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Existing Hook System

Located in `packages/core/src/hooks/`, the hook system provides:

**Hook Lifecycle Events**:
```typescript
type HookLifecycle =
  | 'beforeCreate'
  | 'afterCreate'
  | 'beforeUpdate'
  | 'afterUpdate'
  | 'beforeDelete'
  | 'afterDelete'
  | 'beforeQuery'
  | 'afterQuery';
```

**Current Implementation**:
- `HookRegistry`: Registers hooks by entity and lifecycle event
- `HookExecutor`: Executes hooks sequentially with context passing
- `BaseService`: All entity services extend this and auto-execute hooks

**Current Limitations**:
- No workflow orchestration capabilities
- No persistence of hook execution results
- No visual management interface
- Hooks must be deployed as code changes

### 2.3 Existing RBAC System

Located in `packages/core/src/types/rbac.types.ts`, defines:

**Current Types**:
```typescript
interface AD_User { ad_user_id, username, email, password_hash, ... }
interface AD_Role { ad_role_id, name, description, is_manual, ... }
interface AD_User_Roles { ad_user_id, ad_role_id, ... }
interface AD_Access { ad_role_id, ad_table_id, is_read_only, ... }
interface AD_Field_Access { ad_role_id, ad_field_id, is_readonly, ... }
```

**Current Limitations**:
- No authentication implementation (types only)
- No session management
- No role enforcement in generated code
- No password hashing or OAuth support
- No audit trail for authorization events

### 2.4 Existing Dictionary System

The Compiere-style Application Dictionary (`packages/core/src/types/dictionary.types.ts`) provides:

**Metadata Hierarchy**:
```
AD_Reference (data types)
  └─ AD_Ref_List / AD_Ref_Table
AD_Table (entity metadata)
  └─ AD_Column (field metadata)
      └─ AD_Val_Rule (validation rules)
AD_Window (UI containers)
  └─ AD_Tab (tabs)
      └─ AD_Field (layout, seq_no, display logic)
```

**Current Capabilities**:
- Runtime UI configuration via `sys_field.seq_no`
- Field-level access control metadata
- Validation rules stored as metadata

**Integration Point**: The new rules engine will extend this pattern by adding `sys_rule_definitions` and `sys_workflow_runs` tables.

### 2.5 Current Authentication

**NestJS Stack**:
- JWT-based authentication (custom implementation)
- Manual token generation and validation
- Basic role guards
- No session management
- No refresh tokens

**OpenUI5/OData V4 Stack**:
- No authentication (baseline implementation)
- XSRF token handling
- No session management
- No role enforcement

**Gaps**:
- No unified auth system across stacks
- No social sign-on capability
- No 2FA support
- No audit trail for auth events
- No session revocation

### 2.6 Current Workflow Capabilities

**Current State**: None

The current system has no workflow automation capabilities. All business logic is executed synchronously in the HTTP request/response cycle.

**Limitations**:
- No background job processing
- No long-running workflows
- No human-in-the-loop approval processes
- No workflow observability
- No retry mechanisms

---

## 3. Proposed Architecture

### 3.1 High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                                │
│  ┌──────────────────────┐  ┌──────────────────────┐              │
│  │   Next.js 14 App     │  │   OpenUI5 Frontend   │              │
│  │   Better Auth Client │  │   XSRF + Cookie      │              │
│  │   JDM Editor (React) │  │   Workflow Monitor   │              │
│  └──────────────────────┘  └──────────────────────┘              │
└─────────────┬────────────────────────────────┬───────────────────┘
              │                                │
┌─────────────▼────────────────────────────────▼───────────────────┐
│                        API LAYER                                  │
│  ┌──────────────────────┐  ┌──────────────────────┐              │
│  │   NestJS 10 / Fastify│  │   OData V4 / Express │              │
│  │   Better Auth Guard  │  │   Better Auth MW     │              │
│  │   @thallesp/better-auth│  │   better-auth/node  │              │
│  └──────────────────────┘  └──────────────────────┘              │
└─────────────┬────────────────────────────────┬───────────────────┘
              │                                │
┌─────────────▼────────────────────────────────▼───────────────────┐
│                    SERVICE LAYER                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │         Entity Services (CRUD + workflow_status=draft)   │    │
│  │         Trigger.dev Task Dispatcher (fire-and-forget)    │    │
│  │         Zen Engine Service (rules evaluation)            │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────┬──────────────────────────────────────────────────────┘
              │
┌─────────────▼──────────────────────────────────────────────────────┐
│                  TRIGGER.DEV WORKER LAYER                          │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  Task: entity-lifecycle-workflow                           │   │
│  │  ┌──────────────────────────────────────────────────────┐ │   │
│  │  │  1. Load entity + related entities from DB           │ │   │
│  │  │  2. Load JDM rule from sys_rule_definitions          │ │   │
│  │  │  3. Execute @gorules/zen-engine with JSON context    │ │   │
│  │  │  4. Parse output mutations                           │ │   │
│  │  │  5. DB Transaction: apply mutations + set status     │ │   │
│  │  │  6. Write sys_workflow_runs record                   │ │   │
│  │  │  7. Emit completion event                            │ │   │
│  │  └──────────────────────────────────────────────────────┘ │   │
│  └────────────────────────────────────────────────────────────┘   │
└─────────────┬──────────────────────────────────────────────────────┘
              │
┌─────────────▼──────────────────────────────────────────────────────┐
│                      DATA LAYER                                   │
│         PostgreSQL (entities + auth + rules + workflow)           │
│         Knex.js transactions + Connection Pool                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Authentication Architecture

#### 3.2.1 Better Auth Integration

**Shared Configuration** (`packages/core/src/auth/better-auth.config.ts`):
```typescript
import { betterAuth } from "better-auth";
import { knexAdapter } from "better-auth/adapters/knex";

export const auth = betterAuth({
  database: knexAdapter(knexInstance),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false
  },
  socialLogin: {
    providers: ["google", "microsoft"]
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24 // 1 day
  },
  advanced: {
    crossSubDomainCookies: true
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "microsoft"]
    }
  }
});
```

**NestJS Integration**:
```typescript
// src/modules/auth/auth.module.ts
import { BetterAuthModule } from '@thallesp/nestjs-better-auth';

@Module({
  imports: [
    BetterAuthModule.register({
      baseURL: process.env.BETTER_AUTH_URL,
      baseURLRelative: false
    })
  ]
})
export class AuthModule {}

// src/auth/auth.controller.ts
@Controller('auth')
export class AuthController {
  @Get('/*')
  async authHandler(@Req() req: Request, @Res() res: Response) {
    // Better Auth handler mounted here
  }
}

// Guards
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const session = request.session; // Set by Better Auth middleware
    return !!session?.user;
  }
}
```

**OData V4 Integration**:
```typescript
// src/auth/better-auth.ts
import { betterAuth } from "better-auth";
import { knexAdapter } from "better-auth/adapters/knex";

export const auth = betterAuth({
  // Same config as NestJS stack
});

// src/middleware/auth.middleware.ts
export async function authMiddleware(req: any, res: any, next: any) {
  const session = await auth.api.getSession({
    headers: req.headers
  });

  if (session) {
    req.user = session.user;
    req.session = session;
  }

  next();
}

// server.ts
app.use('/odata/*', authMiddleware);
```

### 3.3 Workflow Architecture

#### 3.3.1 Trigger.dev Integration

**Trigger.dev Setup**:
```typescript
// /trigger/entity-lifecycle-workflow.ts
import { client } from "@trigger.dev/sdk";
import { ZenEngineService } from "../packages/core/src/services/zen-engine.service";

client.defineJob({
  id: "entity-lifecycle-workflow",
  name: "Entity Lifecycle Workflow",
  version: "1.0.0",
  trigger: {
    webhook: {
      endpoint: "api/workflows/trigger"
    }
  },
  run: async (payload, { ctx }) => {
    const { entityName, entityId, operation, userId } = payload;

    // Step 1: Load entity + relations
    const entity = await loadEntityWithContext(entityName, entityId);

    // Step 2: Load rule
    const rule = await loadRule(entityName, operation);

    // Step 3: Execute rules engine
    const zenEngine = new ZenEngineService();
    const result = await zenEngine.evaluate(rule.jdm_content, entity);

    // Step 4: Apply mutations
    await applyMutations(entityName, entityId, result.mutations);

    // Step 5: Update workflow status
    await updateWorkflowStatus(entityId, 'success');

    return { success: true, result };
  }
});
```

**Service Integration**:
```typescript
// Base service enhancement
export abstract class BaseService<T> {
  protected abstract entityName: string;

  async create(data: Partial<T>): Promise<T> {
    // Hook execution (existing)
    const processed = await globalHookExecutor.execute(
      this.entityName,
      'beforeCreate',
      data
    );

    // DB operation
    const result = await this.performCreate(processed);

    // NEW: Set workflow status to draft
    await this.setWorkflowStatus(result.id, 'draft');

    // NEW: Trigger workflow
    await this.workflowService.trigger({
      entityName: this.entityName,
      entityId: result.id,
      operation: 'CREATE',
      userId: this.currentUser.id
    });

    // Hook execution (existing)
    await globalHookExecutor.execute(
      this.entityName,
      'afterCreate',
      result
    );

    return result;
  }
}
```

### 3.4 Rules Engine Architecture

#### 3.4.1 GoRules Zen Engine Integration

**Zen Engine Service** (`packages/core/src/services/zen-engine.service.ts`):
```typescript
import { ZenEngine } from "@gorules/zen-engine";

export class ZenEngineService {
  private cache = new Map<string, ZenEngine>();

  async evaluate(jdmContent: string, context: Record<string, any>): Promise<any> {
    const engine = this.getOrCreateEngine(jdmContent);
    return await engine.evaluate(context);
  }

  private getOrCreateEngine(jdmContent: string): ZenEngine {
    const hash = this.hashContent(jdmContent);
    if (!this.cache.has(hash)) {
      this.cache.set(hash, new ZenEngine(jdmContent));
    }
    return this.cache.get(hash)!;
  }

  private hashContent(content: string): string {
    // Simple hash for cache key
    return require('crypto')
      .createHash('md5')
      .update(content)
      .digest('hex');
  }
}

export const globalZenEngine = new ZenEngineService();
```

**Rule Management Service**:
```typescript
// src/modules/rules/rules.service.ts
@Injectable()
export class RulesService {
  async getRulesForEntity(entityName: string, operation: string): Promise<Rule> {
    return await this.db('sys_rule_definitions')
      .where({ entity_name: entityName, operation })
      .where('is_active', true)
      .first();
  }

  async createRule(dto: CreateRuleDto): Promise<Rule> {
    return await this.db('sys_rule_definitions').insert({
      entity_name: dto.entityName,
      rule_name: dto.ruleName,
      operation: dto.operation,
      jdm_content: dto.jdmContent,
      version: 1,
      is_active: true,
      created_by: this.currentUser.id
    });
  }

  async updateRule(id: string, dto: UpdateRuleDto): Promise<Rule> {
    const current = await this.db('sys_rule_definitions').where({ id }).first();

    return await this.db('sys_rule_definitions').where({ id }).update({
      jdm_content: dto.jdmContent,
      version: current.version + 1,
      updated_at: new Date()
    });
  }

  async getRuleHistory(id: string): Promise<RuleVersion[]> {
    return await this.db('sys_rule_definitions')
      .where({ rule_id: id })
      .orderBy('version', 'desc');
  }

  async validateRule(jdm: string): Promise<ValidationResult> {
    try {
      const engine = new ZenEngine(jdm);
      // Dry run with sample context
      await engine.evaluate({});
      return { valid: true };
    } catch (error) {
      return { valid: false, errors: [error.message] };
    }
  }
}
```

### 3.5 JDM Editor Integration

**React Component** (`app/admin/rules/[entity]/[ruleId]/page.tsx`):
```typescript
"use client";

import { useState } from "react";
import { DecisionGraph } from "@gorules/jdm-editor";

export default function RuleEditorPage({ params }: { params: { entity: string; ruleId: string } }) {
  const [jdm, setJdm] = useState(null);
  const [validation, setValidation] = useState(null);

  useEffect(() => {
    fetchRule(params.ruleId).then(setJdm);
  }, [params.ruleId]);

  const handleSave = async () => {
    const result = await fetch(`/api/rules/${params.ruleId}`, {
      method: 'PUT',
      body: JSON.stringify({ jdmContent: jdm })
    });
    // Handle save
  };

  const handleValidate = async () => {
    const result = await fetch('/api/rules/validate', {
      method: 'POST',
      body: JSON.stringify({ jdm })
    });
    setValidation(await result.json());
  };

  const handleDryRun = async (context: Record<string, any>) => {
    const result = await fetch('/api/rules/dry-run', {
      method: 'POST',
      body: JSON.stringify({ jdm, context })
    });
    return await result.json();
  };

  return (
    <div>
      <DecisionGraph value={jdm} onChange={setJdm} />
      <button onClick={handleSave}>Save</button>
      <button onClick={handleValidate}>Validate</button>
      <DryRunPanel onRun={handleDryRun} />
      <VersionHistory ruleId={params.ruleId} />
    </div>
  );
}
```

---

## 4. Detailed Component Design

### 4.1 Better Auth Components

#### 4.1.1 Authentication Module (NestJS)

**Module Structure**:
```
src/modules/auth/
├── auth.module.ts
├── auth.controller.ts
├── auth.service.ts
├── guards/
│   ├── auth.guard.ts
│   ├── roles.guard.ts
│   └── permissions.guard.ts
├── decorators/
│   ├── current-user.decorator.ts
│   ├── roles.decorator.ts
│   └── public.decorator.ts
└── strategies/
    └── session.strategy.ts
```

**Auth Service**:
```typescript
@Injectable()
export class AuthService {
  constructor(
    @InjectDatabase() private db: Knex,
    private configService: ConfigService
  ) {}

  async login(email: string, password: string) {
    const result = await auth.api.signInEmail({
      body: { email, password }
    });
    return result;
  }

  async register(email: string, password: string, name: string) {
    const result = await auth.api.signUpEmail({
      body: { email, password, name }
    });
    return result;
  }

  async getSession(sessionToken: string) {
    return await auth.api.getSession({
      headers: { authorization: `Bearer ${sessionToken}` }
    });
  }

  async logout(sessionToken: string) {
    return await auth.api.signOut({
      headers: { authorization: `Bearer ${sessionToken}` }
    });
  }

  async assignRole(userId: string, roleName: string) {
    // Custom logic to assign role to user
    return await this.db('ad_user_roles').insert({
      ad_user_id: userId,
      ad_role_id: await this.getRoleIdByName(roleName)
    });
  }
}
```

**Role Guard**:
```typescript
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<string[]>('roles', context.getHandler());

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return false;
    }

    return requiredRoles.some(role => user.roles?.includes(role));
  }
}
```

#### 4.1.2 Authentication Middleware (OData V4)

**Middleware Structure**:
```
src/middleware/
├── auth.middleware.ts
├── rbac.middleware.ts
└── session.middleware.ts
```

**Auth Middleware**:
```typescript
import { auth } from "../auth/better-auth";

export async function authMiddleware(req: any, res: any, next: any) {
  try {
    const sessionToken = req.headers.authorization?.replace('Bearer ', '');
    const session = await auth.api.getSession({
      headers: req.headers
    });

    if (session) {
      req.user = session.user;
      req.session = session;
      req.userRoles = await getUserRoles(session.user.id);
    } else {
      req.user = null;
    }

    next();
  } catch (error) {
    req.user = null;
    next();
  }
}

async function getUserRoles(userId: string): Promise<string[]> {
  const roles = await knex('ad_user_roles')
    .join('ad_role', 'ad_user_roles.ad_role_id', 'ad_role.ad_role_id')
    .where('ad_user_roles.ad_user_id', userId)
    .pluck('ad_role.name');

  return roles;
}
```

**RBAC Middleware**:
```typescript
export function rbacMiddleware(requiredPermissions: {
  entity: string;
  operation: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE';
}) {
  return async (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const hasAccess = await checkAccess(
      req.user.id,
      requiredPermissions.entity,
      requiredPermissions.operation
    );

    if (!hasAccess) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
}

async function checkAccess(
  userId: string,
  entityName: string,
  operation: string
): Promise<boolean> {
  const access = await knex('ad_access')
    .join('ad_user_roles', 'ad_access.ad_role_id', 'ad_user_roles.ad_role_id')
    .join('ad_table', 'ad_access.ad_table_id', 'ad_table.ad_table_id')
    .where('ad_user_roles.ad_user_id', userId)
    .where('ad_table.table_name', entityName.toLowerCase())
    .first();

  if (!access) return false;

  switch (operation) {
    case 'CREATE':
      return access.is_create_access;
    case 'READ':
      return true; // Assume read access unless explicitly read-only
    case 'UPDATE':
      return access.is_update_access;
    case 'DELETE':
      return access.is_delete_access;
    default:
      return false;
  }
}
```

### 4.2 Trigger.dev Components

#### 4.2.1 Workflow Module

**Module Structure**:
```
src/modules/workflow/
├── workflow.module.ts
├── workflow.service.ts
├── workflow.controller.ts
└── dto/
    ├── trigger-workflow.dto.ts
    └── workflow-status.dto.ts
```

**Workflow Service**:
```typescript
@Injectable()
export class WorkflowService {
  private triggerClient: Client;

  constructor(@InjectDatabase() private db: Knex) {
    this.triggerClient = new Client({
      id: process.env.TRIGGER_PROJECT_ID!,
      apiKey: process.env.TRIGGER_SECRET_KEY!
    });
  }

  async trigger(dto: TriggerWorkflowDto): Promise<string> {
    const runId = await this.triggerClient.emitEvent({
      name: 'entity-lifecycle-workflow',
      payload: {
        entityName: dto.entityName,
        entityId: dto.entityId,
        operation: dto.operation,
        userId: dto.userId,
        timestamp: new Date().toISOString()
      }
    });

    // Create workflow run record
    await this.db('sys_workflow_runs').insert({
      trigger_run_id: runId,
      entity_name: dto.entityName,
      entity_id: dto.entityId,
      operation: dto.operation,
      status: 'draft',
      created_by: dto.userId
    });

    return runId;
  }

  async getStatus(runId: string): Promise<WorkflowStatus> {
    const run = await this.triggerClient.getRun(runId);
    return {
      status: run.status,
      completedAt: run.completedAt,
      error: run.error
    };
  }

  async retry(workflowRunId: string): Promise<string> {
    const workflowRun = await this.db('sys_workflow_runs')
      .where('id', workflowRunId)
      .first();

    return await this.trigger({
      entityName: workflowRun.entity_name,
      entityId: workflowRun.entity_id,
      operation: workflowRun.operation,
      userId: workflowRun.created_by
    });
  }
}
```

#### 4.2.2 Trigger.dev Worker

**Worker Setup** (`/trigger/entity-lifecycle-workflow.ts`):
```typescript
import { client, cronJobs } from "@trigger.dev/sdk";
import { Knex } from "knex";
import { ZenEngineService } from "../packages/core/src/services/zen-engine.service";

const knex = require('knex')({
  client: 'pg',
  connection: process.env.DATABASE_URL
});

const zenEngine = new ZenEngineService();

client.defineJob({
  id: "entity-lifecycle-workflow",
  name: "Entity Lifecycle Workflow",
  version: "1.0.0",
  trigger: {
    webhook: {
      endpoint: "api/workflows/trigger"
    }
  },
  run: async (payload: any, { ctx }) => {
    const { entityName, entityId, operation, userId } = payload;

    let workflowRunId: string | null = null;
    let error: Error | null = null;

    try {
      // Step 1: Fetch workflow run record
      const workflowRun = await knex('sys_workflow_runs')
        .where({
          entity_name: entityName,
          entity_id: entityId,
          operation
        })
        .orderBy('created_at', 'desc')
        .first();

      workflowRunId = workflowRun.id;

      // Step 2: Load entity with relations
      const entityWithContext = await loadEntityWithContext(
        knex,
        entityName,
        entityId
      );

      // Step 3: Load rule
      const rule = await knex('sys_rule_definitions')
        .where({
          entity_name: entityName,
          operation,
          is_active: true
        })
        .first();

      if (!rule) {
        // No rule defined, just mark as success
        await updateWorkflowStatus(knex, entityName, entityId, 'success');
        return { success: true, message: 'No rule defined' };
      }

      // Step 4: Execute rules engine
      const result = await zenEngine.evaluate(
        rule.jdm_content,
        entityWithContext
      );

      // Step 5: Apply mutations in transaction
      await knex.transaction(async (trx) => {
        // Apply entity mutations
        if (result.mutations.entity) {
          await trx(`${entityName.toLowerCase()}`)
            .where({ id: entityId })
            .update(result.mutations.entity);
        }

        // Apply relation mutations
        if (result.mutations.relations) {
          for (const [relation, mutations] of Object.entries(result.mutations.relations)) {
            await trx(relation)
              .where('id', mutations.id)
              .update(mutations);
          }
        }

        // Update workflow status
        await trx(`${entityName.toLowerCase()}`)
          .where({ id: entityId })
          .update({ workflow_status: 'success' });

        // Update workflow run record
        await trx('sys_workflow_runs')
          .where('id', workflowRunId)
          .update({
            status: 'success',
            output_payload: JSON.stringify(result),
            mutations_applied: JSON.stringify(result.mutations),
            completed_at: new Date(),
            duration_ms: Date.now() - ctx.startedAt
          });
      });

      return { success: true, result };

    } catch (err) {
      error = err;

      // Update workflow run with error
      if (workflowRunId) {
        await knex('sys_workflow_runs')
          .where('id', workflowRunId)
          .update({
            status: 'error',
            error_details: err.message,
            completed_at: new Date()
          });
      }

      // Update entity workflow status
      await knex(`${entityName.toLowerCase()}`)
        .where('id', entityId)
        .update({ workflow_status: 'error' });

      throw err;
    }
  }
});

// Background job: timeout stuck workflows
client.defineJob({
  id: "timeout-stuck-workflows",
  name: "Timeout Stuck Workflows",
  version: "1.0.0",
  trigger: cronJobs.interval({
    minutes: 5
  }),
  run: async () => {
    const stuckWorkflows = await knex('sys_workflow_runs')
      .where('status', 'draft')
      .where('created_at', '<', new Date(Date.now() - 5 * 60 * 1000));

    for (const workflow of stuckWorkflows) {
      await knex(`${workflow.entity_name.toLowerCase()}`)
        .where('id', workflow.entity_id)
        .update({ workflow_status: 'error' });

      await knex('sys_workflow_runs')
        .where('id', workflow.id)
        .update({
          status: 'error',
          error_details: 'Workflow timeout after 5 minutes',
          completed_at: new Date()
        });
    }
  }
});

async function loadEntityWithContext(
  knex: Knex,
  entityName: string,
  entityId: string
): Promise<any> {
  // Load entity
  const entity = await knex(entityName.toLowerCase())
    .where('id', entityId)
    .first();

  // Load related entities based on foreign keys
  const relations = await loadRelatedEntities(knex, entityName, entity);

  return {
    entity,
    relations,
    meta: {
      entityName,
      entityId,
      operation: 'CREATE' // or UPDATE/DELETE
    }
  };
}

async function loadRelatedEntities(
  knex: Knex,
  entityName: string,
  entity: any
): Promise<Record<string, any>> {
  // This would be generated based on entity schema
  // For now, just return empty object
  return {};
}
```

### 4.3 GoRules Components

#### 4.3.1 Rules Module

**Module Structure**:
```
src/modules/rules/
├── rules.module.ts
├── rules.controller.ts
├── rules.service.ts
└── dto/
    ├── create-rule.dto.ts
    ├── update-rule.dto.ts
    └── validate-rule.dto.ts
```

**Rules Controller**:
```typescript
@Controller('rules')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class RulesController {
  constructor(private rulesService: RulesService) {}

  @Get()
  async list(@Query('entity') entity?: string) {
    return await this.rulesService.listRules(entity);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return await this.rulesService.getRule(id);
  }

  @Post()
  async create(@Body() dto: CreateRuleDto, @CurrentUser() user: any) {
    return await this.rulesService.createRule(dto, user.id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateRuleDto) {
    return await this.rulesService.updateRule(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return await this.rulesService.deleteRule(id);
  }

  @Get(':id/history')
  async history(@Param('id') id: string) {
    return await this.rulesService.getRuleHistory(id);
  }

  @Post(':id/rollback/:version')
  async rollback(
    @Param('id') id: string,
    @Param('version') version: number
  ) {
    return await this.rulesService.rollbackRule(id, version);
  }

  @Post('validate')
  async validate(@Body() dto: ValidateRuleDto) {
    return await this.rulesService.validateRule(dto.jdm);
  }

  @Post('dry-run')
  async dryRun(@Body() dto: DryRunDto) {
    return await this.rulesService.dryRun(dto);
  }
}
```

---

## 5. Integration Strategy

### 5.1 Phased Integration Approach

The enhancement will be implemented in four phases as outlined in IMPLEMENTATION-PHASES.md:

**Phase 1: Foundation & Authentication**
- Integrate Better Auth
- Set up session management
- Implement RBAC guards
- Update both stacks

**Phase 2: Workflow Interception**
- Integrate Trigger.dev
- Implement CRUD interception
- Build workflow monitoring UI
- Handle draft → success/error state machine

**Phase 3: Rules Engine**
- Integrate Zen Engine
- Build JDM Editor UI
- Implement rule management APIs
- Seed default HMS rules

**Phase 4: Template Updates & Hardening**
- Update generator templates
- Add comprehensive tests
- Implement circuit breakers
- Update documentation

### 5.2 Code Generation Integration

The enhancement will be integrated into the generator at multiple levels:

**Template Updates**:
- `packages/generator/templates/common/migrations/` — Database migrations
- `packages/generator/templates/nextjs-nestjs/backend/` — NestJS auth/workflow/rules modules
- `packages/generator/templates/openui5-odatav4/backend/` — OData auth/workflow/rules modules
- `packages/generator/templates/nextjs-nestjs/frontend/` — Next.js auth UI, admin pages

**Generator Context**:
- Add `hasAuth: true` flag to generated projects
- Add `hasWorkflow: true` flag to enable workflow interception
- Add `hasRulesEngine: true` flag to enable rules evaluation
- Pass entity relationship map to templates for workflow context building

---

## 6. Data Flow & State Machine

### 6.1 Entity Lifecycle State Machine

```
┌─────────┐
│  NONE   │ ← Initial state on read
└────┬────┘
     │
     │ CREATE/UPDATE/DELETE operation
     ▼
┌─────────┐
│  DRAFT  │ ← Workflow running, entity locked
└────┬────┘
     │
     ├─────────────────┐
     │                 │
     ▼                 ▼
┌─────────┐     ┌─────────┐
│ SUCCESS │     │  ERROR  │
└─────────┘     └────┬────┘
                     │
                     │ Retry action
                     ▼
                  ┌─────┐
                  │NONE │ ← Reset for retry
                  └─────┘
```

### 6.2 End-to-End Data Flow

**CREATE Operation Flow**:

```
1. Client → POST /api/patients
   └─ Body: { first_name: "John", last_name: "Doe", ... }

2. Better Auth Guard
   ├─ Validates session token
   ├─ Extracts user from session
   └─ Checks role: receptionist has CREATE access

3. Controller → PatientService.create()
   ├─ Executes beforeCreate hooks
   ├─ Inserts patient record
   │  └─ Sets workflow_status = 'draft'
   │  └─ Sets created_by = user.id
   └─ Executes afterCreate hooks

4. Workflow Dispatch
   └─ Fires Trigger.dev task (non-blocking)
      └─ Payload: { entityName: 'Patient', entityId, operation: 'CREATE', userId }

5. HTTP Response (immediate)
   └─ Returns: { id, workflow_status: 'draft', ... }

6. Client polls status
   ├─ GET /api/patients/:id/workflow-status
   └─ Returns: { status: 'draft' | 'success' | 'error' }

7. Trigger.dev Worker (async)
   ├─ Loads patient + relations
   ├─ Loads Patient/CREATE rule
   ├─ Executes Zen Engine
   ├─ Applies mutations in transaction
   │  ├─ Updates patient fields (age_category, risk_level, etc.)
   │  └─ Sets workflow_status = 'success'
   └─ Writes sys_workflow_runs record

8. Client receives success
   └─ Status becomes 'success', shows enriched data
```

### 6.3 Error Recovery Flow

```
┌─────────────────────────────────────────────────┐
│  Workflow Error Detected                        │
└────────────┬────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────┐
│  Set workflow_status = 'error'                  │
│  Write error_details to sys_workflow_runs       │
└────────────┬────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────┐
│  Is retryable?                                  │
└────┬──────────────────────────────────────┬────┘
     │ YES                                   │ NO
     ▼                                       ▼
┌─────────────────────┐             ┌──────────────────┐
│  Auto-retry (3x)    │             │  Manual review   │
│  Exponential backoff│             │  required        │
└────┬────────────────┘             └──────────────────┘
     │
     ▼
┌─────────────────────┐
│  Success?           │
└────┬──────────┬─────┘
     │ YES       │ NO
     ▼           ▼
┌──────────┐  ┌──────────────────┐
│ Success  │  │  Manual retry     │
└──────────┘  │  (admin action)   │
              └──────────────────┘
```

---

## 7. Security Architecture

### 7.1 Authentication Security

**Threat Model**:
- Session hijacking → Mitigated by httpOnly cookies, SameSite strict
- CSRF → Mitigated by Better Auth CSRF tokens
- Password brute force → Mitigated by rate limiting
- Session fixation → Mitigated by session regeneration on login
- Token theft → Short-lived sessions, refresh tokens

**Security Measures**:
```typescript
// Better Auth security configuration
export const auth = betterAuth({
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60 // 5 minutes
    }
  },
  advanced: {
    cookiePrefix: 'better-auth',
    crossSubDomainCookies: {
      enabled: true
    },
    useSecureCookies: true
  }
});
```

### 7.2 Authorization Security

**RBAC Enforcement**:
- Double validation: Guard + Service layer
- Field-level access: AD_Field_Access table
- Row-level security: Tenant isolation (future)

**Permission Matrix**:
| Role | CREATE | READ | UPDATE | DELETE |
|------|--------|------|--------|--------|
| admin | ✓ | ✓ | ✓ | ✓ |
| doctor | ✓ | ✓ | ✓ | ✗ |
| nurse | ✓ | ✓ | ✓ | ✗ |
| receptionist | ✓ | ✓ | △ | ✗ |
| billing | ✓ | ✓ | ✓ | ✗ |
| readonly | ✗ | ✓ | ✗ | ✗ |

(△ = limited to certain entities)

### 7.3 Rules Engine Security

**Threat Model**:
- Malicious rule injection → Mitigated by admin-only access
- Rule denial of service → Mitigated by execution timeout
- Data leakage → Mitigated by context filtering

**Security Measures**:
```typescript
// Rule validation before save
async function validateRule(jdm: string): Promise<ValidationResult> {
  // 1. Syntax validation
  const parsed = JSON.parse(jdm);

  // 2. Schema validation
  if (!isValidJDMSchema(parsed)) {
    return { valid: false, errors: ['Invalid JDM schema'] };
  }

  // 3. Execution test with sample context
  const engine = new ZenEngine(jdm);
  try {
    await engine.evaluate({ test: true });
  } catch (error) {
    return { valid: false, errors: [error.message] };
  }

  // 4. Check for dangerous operations
  if (containsDangerousOperations(parsed)) {
    return { valid: false, errors: ['Rule contains unsafe operations'] };
  }

  return { valid: true };
}
```

### 7.4 Workflow Security

**Trigger.dev Security**:
- Secret key validation
- IP whitelisting for webhooks
- Payload encryption at rest

**Security Measures**:
```typescript
// Trigger.dev client initialization
const triggerClient = new Client({
  id: process.env.TRIGGER_PROJECT_ID!,
  apiKey: process.env.TRIGGER_SECRET_KEY!
});

// Validate webhook signature
function validateTriggerSignature(payload: any, signature: string): boolean {
  const hmac = crypto.createHmac('sha256', process.env.TRIGGER_SECRET_KEY!);
  hmac.update(JSON.stringify(payload));
  const digest = hmac.digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}
```

---

## 8. Database Schema Design

### 8.1 New Tables

**sys_rule_definitions**:
```sql
CREATE TABLE sys_rule_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_name VARCHAR(100) NOT NULL,
  rule_name VARCHAR(100) NOT NULL,
  operation VARCHAR(20) NOT NULL CHECK (operation IN ('CREATE', 'READ', 'UPDATE', 'DELETE', 'ALL')),
  jdm_content JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES better_auth_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_rule_per_entity_operation UNIQUE (entity_name, operation, rule_name)
);

CREATE INDEX idx_rule_definitions_entity ON sys_rule_definitions(entity_name, operation);
CREATE INDEX idx_rule_definitions_active ON sys_rule_definitions(is_active) WHERE is_active = true;
```

**sys_workflow_runs**:
```sql
CREATE TABLE sys_workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_run_id VARCHAR(255),
  entity_name VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  operation VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'success', 'error')),
  input_payload JSONB,
  output_payload JSONB,
  mutations_applied JSONB,
  error_details TEXT,
  duration_ms INTEGER,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT valid_completion CHECK (
    (status = 'draft' AND completed_at IS NULL) OR
    (status IN ('success', 'error') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX idx_workflow_runs_entity ON sys_workflow_runs(entity_name, entity_id);
CREATE INDEX idx_workflow_runs_status ON sys_workflow_runs(status);
CREATE INDEX idx_workflow_runs_created_at ON sys_workflow_runs(created_at DESC);
```

### 8.2 Modified Tables

**All Entity Tables** (example: bus_patient):
```sql
ALTER TABLE bus_patient ADD COLUMN workflow_status VARCHAR(20) DEFAULT 'none' CHECK (workflow_status IN ('none', 'draft', 'success', 'error'));
ALTER TABLE bus_patient ADD COLUMN workflow_run_id UUID REFERENCES sys_workflow_runs(id);
ALTER TABLE bus_patient ADD COLUMN created_by UUID REFERENCES better_auth_users(id);
ALTER TABLE bus_patient ADD COLUMN updated_by UUID REFERENCES better_auth_users(id);

CREATE INDEX idx_patient_workflow_status ON bus_patient(workflow_status);
CREATE INDEX idx_patient_created_by ON bus_patient(created_by);
```

### 8.3 Better Auth Tables

Better Auth will create its own tables on initialization:
```sql
-- Core tables
CREATE TABLE better_auth_users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  email_verified BOOLEAN DEFAULT false,
  name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE better_auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES better_auth_users(id) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE better_auth_accounts (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES better_auth_users(id) NOT NULL,
  account_id VARCHAR(255) NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE better_auth_verification (
  id UUID PRIMARY KEY,
  identifier VARCHAR(255) NOT NULL,
  value VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 9. API Design

### 9.1 Authentication APIs

**POST /api/auth/sign-in/email**:
```typescript
Request:
{
  email: string;
  password: string;
}

Response:
{
  user: {
    id: string;
    email: string;
    name: string;
    roles: string[];
  };
  session: {
    token: string;
    expiresAt: string;
  };
}
```

**POST /api/auth/sign-out**:
```typescript
Request:
Headers: {
  Authorization: "Bearer <session_token>"
}

Response:
{
  success: true;
}
```

**GET /api/auth/session**:
```typescript
Request:
Headers: {
  Authorization: "Bearer <session_token>"
}

Response:
{
  user: {
    id: string;
    email: string;
    name: string;
    roles: string[];
  };
  session: {
    token: string;
    expiresAt: string;
  };
}
```

### 9.2 Workflow APIs

**GET /api/workflows/runs/:runId**:
```typescript
Response:
{
  id: string;
  entityName: string;
  entityId: string;
  operation: string;
  status: 'draft' | 'success' | 'error';
  inputPayload: any;
  outputPayload?: any;
  mutationsApplied?: any;
  errorDetails?: string;
  durationMs?: number;
  createdAt: string;
  completedAt?: string;
}
```

**GET /api/entities/:entity/:id/workflow-status**:
```typescript
Response:
{
  status: 'none' | 'draft' | 'success' | 'error';
  workflowRunId?: string;
}
```

**POST /api/workflows/runs/:runId/retry**:
```typescript
Response:
{
  newRunId: string;
  message: string;
}
```

### 9.3 Rules Management APIs

**GET /api/rules**:
```typescript
Query Params: {
  entity?: string;
  operation?: string;
  isActive?: boolean;
}

Response:
{
  rules: Array<{
    id: string;
    entityName: string;
    ruleName: string;
    operation: string;
    version: number;
    isActive: boolean;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
  }>;
}
```

**POST /api/rules**:
```typescript
Request:
{
  entityName: string;
  ruleName: string;
  operation: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'ALL';
  jdmContent: string; // JDM JSON
}

Response:
{
  id: string;
  version: 1;
  createdAt: string;
}
```

**PUT /api/rules/:id**:
```typescript
Request:
{
  jdmContent: string;
}

Response:
{
  id: string;
  version: number; // Incremented
  updatedAt: string;
}
```

**POST /api/rules/validate**:
```typescript
Request:
{
  jdm: string;
}

Response:
{
  valid: boolean;
  errors?: string[];
}
```

**POST /api/rules/dry-run**:
```typescript
Request:
{
  jdm?: string;
  entityName?: string;
  entityId?: string;
  context?: Record<string, any>;
}

Response:
{
  success: boolean;
  result?: any;
  errors?: string[];
}
```

---

## 10. Migration Strategy

### 10.1 Database Migration Plan

**Step 1: Create Better Auth Tables** (`003_add_better_auth_tables.ts`):
```typescript
export async function up(knex: Knex): Promise<void> {
  // Better Auth will create its own tables on first run
  // Just need to ensure the database exists
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('better_auth_verification');
  await knex.schema.dropTableIfExists('better_auth_accounts');
  await knex.schema.dropTableIfExists('better_auth_sessions');
  await knex.schema.dropTableIfExists('better_auth_users');
}
```

**Step 2: Add Workflow & Rules Tables** (`004_add_workflow_rules_tables.ts`):
```typescript
export async function up(knex: Knex): Promise<void> {
  // sys_rule_definitions
  await knex.schema.createTable('sys_rule_definitions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('entity_name', 100).notNullable();
    table.string('rule_name', 100).notNullable();
    table.string('operation', 20).notNullable();
    table.jsonb('jdm_content').notNullable();
    table.integer('version').defaultTo(1);
    table.boolean('is_active').defaultTo(true);
    table.uuid('created_by').references('id').inTable('better_auth_users');
    table.timestamps(true, true);

    table.unique(['entity_name', 'operation', 'rule_name']);
    table.checkIn('operation', ['CREATE', 'READ', 'UPDATE', 'DELETE', 'ALL']);
  });

  // sys_workflow_runs
  await knex.schema.createTable('sys_workflow_runs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('trigger_run_id', 255);
    table.string('entity_name', 100).notNullable();
    table.uuid('entity_id').notNullable();
    table.string('operation', 20).notNullable();
    table.string('status', 20).defaultTo('draft');
    table.jsonb('input_payload');
    table.jsonb('output_payload');
    table.jsonb('mutations_applied');
    table.text('error_details');
    table.integer('duration_ms');
    table.uuid('created_by');
    table.timestamps(true, true);

    table.checkIn('status', ['draft', 'success', 'error']);
  });
}
```

**Step 3: Add Workflow Columns to Entity Tables** (`005_add_entity_workflow_columns.ts`):
```typescript
export async function up(knex: Knex): Promise<void> {
  const tables = await knex('sys_table').pluck('table_name');

  for (const tableName of tables) {
    if (tableName.startsWith('bus_')) {
      await knex.schema.table(tableName, (table) => {
        table.string('workflow_status', 20).defaultTo('none');
        table.uuid('workflow_run_id').references('id').inTable('sys_workflow_runs');
        table.uuid('created_by').references('id').inTable('better_auth_users');
        table.uuid('updated_by').references('id').inTable('better_auth_users');
      });
    }
  }
}
```

**Step 4: Migrate Existing Users** (`006_migrate_users_to_better_auth.ts`):
```typescript
export async function up(knex: Knex): Promise<void> {
  // Migrate from ad_user to better_auth_users
  await knex('better_auth_users').insert(
    knex('ad_user')
      .select('ad_user_id as id', 'email', 'name', 'created_at', 'updated_at')
  );

  // Migrate passwords (they should be hashed already)
  await knex.raw(`
    UPDATE better_auth_users u
    SET email_verified = true
    FROM ad_user au
    WHERE u.id = au.ad_user_id
  `);
}
```

### 10.2 Code Migration Strategy

**Backward Compatibility**:
- Old JWT endpoints marked as deprecated but still functional
- Feature flags to enable/disable new auth system
- Gradual rollout: enable per-user

**Feature Flags**:
```typescript
// .env
USE_BETTER_AUTH=true
USE_WORKFLOW_ENGINE=true
USE_RULES_ENGINE=true

// Code
if (process.env.USE_BETTER_AUTH === 'true') {
  // Use Better Auth
} else {
  // Use old JWT (deprecated)
}
```

---

## 11. Testing Strategy

### 11.1 Unit Tests

**Authentication Tests**:
```typescript
// auth.service.spec.ts
describe('AuthService', () => {
  it('should authenticate user with valid credentials', async () => {
    const result = await authService.login('user@example.com', 'password123');
    expect(result.user).toBeDefined();
    expect(result.session.token).toBeDefined();
  });

  it('should reject invalid credentials', async () => {
    await expect(
      authService.login('user@example.com', 'wrongpassword')
    ).rejects.toThrow('INVALID_EMAIL_PASSWORD');
  });

  it('should create session with correct expiry', async () => {
    const result = await authService.login('user@example.com', 'password123');
    const expiresAt = new Date(result.session.expiresAt);
    const now = new Date();
    const diff = (expiresAt.getTime() - now.getTime()) / 1000 / 60 / 60 / 24;
    expect(diff).toBeCloseTo(7, 0); // 7 days
  });
});
```

**Workflow Tests**:
```typescript
// workflow.service.spec.ts
describe('WorkflowService', () => {
  it('should trigger workflow on entity create', async () => {
    const spy = jest.spyOn(triggerClient, 'emitEvent');
    await workflowService.trigger({
      entityName: 'Patient',
      entityId: '123',
      operation: 'CREATE',
      userId: 'user-123'
    });
    expect(spy).toHaveBeenCalledWith(
      'entity-lifecycle-workflow',
      expect.objectContaining({
        entityName: 'Patient',
        entityId: '123'
      })
    );
  });

  it('should set workflow status to draft', async () => {
    await entityService.create({ name: 'Test' });
    const entity = await knex('bus_patient').where('id', '123').first();
    expect(entity.workflow_status).toBe('draft');
  });
});
```

**Rules Engine Tests**:
```typescript
// zen-engine.service.spec.ts
describe('ZenEngineService', () => {
  it('should evaluate rule and return mutations', async () => {
    const jdm = {
      // ... JDM content
    };
    const context = {
      entity: { age: 70 },
      relations: {}
    };

    const result = await zenEngineService.evaluate(jdm, context);
    expect(result.mutations.entity.geriatric_flag).toBe(true);
  });

  it('should cache engine instances', async () => {
    const jdm = '{}';
    await zenEngineService.evaluate(jdm, {});
    await zenEngineService.evaluate(jdm, {});
    // Should reuse cached instance
  });
});
```

### 11.2 Integration Tests

**End-to-End Workflow Test**:
```typescript
// workflow.e2e.spec.ts
describe('Entity Lifecycle Workflow', () => {
  it('should complete workflow successfully', async () => {
    // 1. Create patient
    const response = await request(app)
      .post('/api/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'John',
        last_name: 'Doe',
        date_of_birth: '1950-01-01'
      });

    expect(response.status).toBe(201);
    expect(response.body.workflow_status).toBe('draft');

    const patientId = response.body.id;

    // 2. Wait for workflow to complete
    await waitForWorkflowStatus(patientId, 'success', 10000);

    // 3. Verify workflow completed
    const patient = await knex('bus_patient').where('id', patientId).first();
    expect(patient.workflow_status).toBe('success');
    expect(patient.age_category).toBe('geriatric');
    expect(patient.risk_level).toBeDefined();

    // 4. Verify workflow run record
    const workflowRun = await knex('sys_workflow_runs')
      .where('entity_id', patientId)
      .first();
    expect(workflowRun.status).toBe('success');
    expect(workflowRun.mutations_applied).toBeDefined();
  });
});
```

### 11.3 E2E Tests (Playwright)

**Authentication Flow**:
```typescript
// tests/e2e/auth.e2e.spec.ts
test('user can login and logout', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="email"]', 'admin@hospital.com');
  await page.fill('input[name="password"]', 'password123');
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL('/dashboard');
  await expect(page.locator('text=Welcome, Admin')).toBeVisible();

  await page.click('button:has-text("Logout")');
  await expect(page).toHaveURL('/login');
});
```

**Workflow Monitoring**:
```typescript
// tests/e2e/workflow-monitor.e2e.spec.ts
test('admin can view and retry failed workflows', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/admin/workflows');

  // Filter for failed workflows
  await page.selectOption('select[name="status"]', 'error');

  // Click on first failed workflow
  await page.click('table tbody tr:first-child');

  // View error details
  await expect(page.locator('text=Error Details')).toBeVisible();

  // Retry workflow
  await page.click('button:has-text("Retry")');
  await expect(page.locator('text=Retry initiated')).toBeVisible();
});
```

**Rules Editor**:
```typescript
// tests/e2e/rules-editor.e2e.spec.ts
test('admin can edit and save rules', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/admin/rules');

  // Click on Patient CREATE rule
  await page.click('a:has-text("Patient")');

  // Edit rule in JDM Editor
  await page.click('[data-testid="jdm-editor"]');

  // Make changes (using JDM Editor API)
  await page.evaluate(() => {
    // Simulate editor changes
  });

  // Save rule
  await page.click('button:has-text("Save")');
  await expect(page.locator('text=Rule saved successfully')).toBeVisible();

  // Verify version incremented
  await expect(page.locator('text=Version 2')).toBeVisible();
});
```

---

## 12. Deployment Strategy

### 12.1 Infrastructure Requirements

**New Components**:
1. **Trigger.dev Server** (Docker container)
2. **Better Auth** (integrated into existing services)
3. **Zen Engine** (Node.js addon, integrated into Trigger.dev worker)

**Docker Compose Setup**:
```yaml
# docker-compose.yml
version: '3.8'
services:
  trigger-server:
    image: ghcr.io/triggerdotdev/trigger.dev:v3
    ports:
      - "8888:8888"
    environment:
      - DATABASE_URL=postgresql://postgres:password@postgres/trigger_dev
      - REDIS_URL=redis://redis:6379
      - ENCRYPTION_KEY=${TRIGGER_ENCRYPTION_KEY}
    depends_on:
      - postgres
      - redis

  trigger-worker:
    build: .
    command: npx trigger.dev dev
    volumes:
      - ./trigger:/trigger
    environment:
      - TRIGGER_SECRET_KEY=${TRIGGER_SECRET_KEY}
      - DATABASE_URL=${DATABASE_URL}
    depends_on:
      - trigger-server

  postgres:
    image: postgres:14
    environment:
      - POSTGRES_DB=hms_dev
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### 12.2 Environment Variables

**Required New Variables**:
```bash
# Better Auth
BETTER_AUTH_SECRET=<random-32-char-string>
BETTER_AUTH_URL=http://localhost:3000

# Trigger.dev
TRIGGER_SECRET_KEY=<trigger-dev-secret>
TRIGGER_API_URL=http://localhost:8888
TRIGGER_PROJECT_ID=<project-id>

# Feature Flags
ENABLE_WORKFLOW_ENGINE=true
ENABLE_RULES_ENGINE=true
USE_BETTER_AUTH=true

# OAuth (optional)
GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>
MICROSOFT_CLIENT_ID=<microsoft-client-id>
MICROSOFT_CLIENT_SECRET=<microsoft-client-secret>
```

### 12.3 Deployment Process

**Step 1: Prepare Environment**:
```bash
# 1. Add new environment variables to .env
cp .env.example .env
# Edit .env with actual values

# 2. Start new infrastructure
docker-compose up -d trigger-server trigger-worker postgres redis

# 3. Initialize Trigger.dev
npx trigger.dev@latest login
npx trigger.dev@latest init
```

**Step 2: Run Migrations**:
```bash
bun run migrate
```

**Step 3: Deploy Application**:
```bash
# Build and start
bun run build
bun run dev
```

**Step 4: Verify Deployment**:
```bash
# Check health
curl http://localhost:3000/health

# Check Better Auth
curl http://localhost:3000/api/auth/session

# Check Trigger.dev
curl http://localhost:8888/health
```

### 12.4 Production Considerations

**High Availability**:
- Run multiple Trigger.dev worker instances
- Use managed PostgreSQL (RDS, Cloud SQL)
- Use managed Redis (ElastiCache, Redis Cloud)
- Configure Trigger.dev queue concurrency

**Scaling**:
```typescript
// Trigger.dev worker scaling
// Run multiple instances with same worker ID
// Trigger.dev will distribute tasks automatically

docker-compose up --scale trigger-worker=3
```

**Monitoring**:
- Export Trigger.dev metrics to Prometheus
- Monitor workflow queue depth
- Alert on workflow timeout
- Track Zen Engine execution time

---

## 13. Monitoring & Observability

### 13.1 Metrics Collection

**Application Metrics**:
```typescript
// metrics/collectors.ts
import { Counter, Histogram, Gauge } from 'prom-client';

export const workflowExecutions = new Counter({
  name: 'workflow_executions_total',
  help: 'Total number of workflow executions',
  labelNames: ['entity_name', 'operation', 'status']
});

export const workflowDuration = new Histogram({
  name: 'workflow_duration_seconds',
  help: 'Workflow execution duration in seconds',
  labelNames: ['entity_name', 'operation'],
  buckets: [0.1, 0.5, 1, 2, 5, 10]
});

export const rulesEngineCacheHits = new Counter({
  name: 'rules_engine_cache_hits_total',
  help: 'Total number of rules engine cache hits'
});

export const activeSessions = new Gauge({
  name: 'active_sessions_total',
  help: 'Current number of active sessions'
});
```

### 13.2 Logging Strategy

**Structured Logging**:
```typescript
// logger.ts
import { pino } from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
  },
});

// Usage
logger.info({
  event: 'workflow_triggered',
  entityName: 'Patient',
  entityId: '123',
  operation: 'CREATE',
  userId: 'user-123'
});

logger.error({
  event: 'workflow_failed',
  entityName: 'Patient',
  entityId: '123',
  error: error.message,
  stack: error.stack
});
```

### 13.3 Distributed Tracing

**OpenTelemetry Integration**:
```typescript
// tracing.ts
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { registerInstrumentations } from '@opentelemetry/instrumentation';

const provider = new NodeTracerProvider({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'hms-backend',
  }),
});

const exporter = new JaegerExporter({
  endpoint: process.env.JAEGER_ENDPOINT,
});

provider.addSpanProcessor(new BatchSpanProcessor(exporter));
provider.register();

registerInstrumentations({
  instrumentations: [HttpInstrumentation, KnexInstrumentation],
});
```

### 13.4 Dashboards

**Grafana Dashboard Panels**:
1. **Workflow Overview**:
   - Workflows triggered (rate)
   - Workflow duration (p50, p95, p99)
   - Workflow success rate
   - Failed workflows by entity

2. **Authentication Metrics**:
   - Active sessions
   - Login attempts (success/failure)
   - Session duration

3. **Rules Engine Metrics**:
   - Rule evaluations (rate)
   - Cache hit rate
   - Rule execution time

4. **Database Metrics**:
   - Connection pool usage
   - Query duration
   - Lock contention

---

## 14. Performance Considerations

### 14.1 Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Auth validation latency | < 50ms | Session check per request |
| Workflow dispatch latency | < 10ms | Fire-and-forget |
| Zen Engine evaluation | < 100ms | Typical rule sets |
| End-to-end workflow | < 5s | CREATE → success |
| Rules engine cache hit | > 90% | LRU cache efficiency |

### 14.2 Optimization Strategies

**Database Optimization**:
```sql
-- Partial index for active rules
CREATE INDEX idx_rule_definitions_active
ON sys_rule_definitions(is_active)
WHERE is_active = true;

-- Covering index for workflow runs
CREATE INDEX idx_workflow_runs_covering
ON sys_workflow_runs(entity_name, entity_id, operation, status)
INCLUDE (input_payload, output_payload, error_details);

-- Index for workflow status lookup
CREATE INDEX idx_patient_workflow_status
ON bus_patient(workflow_status)
WHERE workflow_status != 'none';
```

**Application Caching**:
```typescript
// LRU cache for rules
const ruleCache = new LRU<string, Rule>({
  max: 500,
  ttl: 1000 * 60 * 5, // 5 minutes
});

async function getRule(entityName: string, operation: string): Promise<Rule> {
  const key = `${entityName}:${operation}`;

  if (ruleCache.has(key)) {
    return ruleCache.get(key)!;
  }

  const rule = await knex('sys_rule_definitions')
    .where({ entity_name: entityName, operation })
    .first();

  ruleCache.set(key, rule);
  return rule;
}
```

**Workflow Optimization**:
```typescript
// Batch workflow status updates
async function updateWorkflowStatusBatch(
  updates: Array<{ entityId: string; status: string }>
) {
  await knex.transaction(async (trx) => {
    for (const update of updates) {
      await trx('bus_patient')
        .where('id', update.entityId)
        .update({ workflow_status: update.status });
    }
  });
}
```

### 14.3 Load Testing

**K6 Scenarios**:
```javascript
// load-test/workflow.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '1m', target: 10 },   // Ramp up
    { duration: '3m', target: 50 },   // Sustained load
    { duration: '1m', target: 100 },  // Spike
    { duration: '2m', target: 0 },    // Ramp down
  ],
};

export default function () {
  const loginRes = http.post('http://localhost:3000/api/auth/sign-in/email', {
    email: 'test@example.com',
    password: 'password123',
  });

  check(loginRes, {
    'login successful': (r) => r.status === 200,
  });

  const createRes = http.post(
    'http://localhost:3000/api/patients',
    {
      first_name: 'Test',
      last_name: 'User',
      date_of_birth: '1990-01-01',
    },
    {
      headers: { Authorization: `Bearer ${loginRes.json().session.token}` },
    }
  );

  check(createRes, {
    'patient created': (r) => r.status === 201,
    'workflow triggered': (r) => r.json().workflow_status === 'draft',
  });

  sleep(1);
}
```

---

## 15. Failure Scenarios & Recovery

### 15.1 Common Failure Scenarios

**Scenario 1: Trigger.dev Service Unavailable**
```
Detection: Workflow dispatch fails
Impact: Entity created but no workflow runs
Recovery:
  1. Circuit breaker prevents further attempts
  2. Entities remain in 'draft' status
  3. Background job scans for drafts and retries
  4. Alert sent to operations team
```

**Scenario 2: Zen Engine Execution Timeout**
```
Detection: Workflow exceeds 5 minute timeout
Impact: Single workflow stuck
Recovery:
  1. Trigger.dev automatically marks job as failed
  2. Entity workflow_status set to 'error'
  3. Error details recorded in sys_workflow_runs
  4. Admin can retry from UI
```

**Scenario 3: Database Transaction Deadlock**
```
Detection: Knex transaction deadlock error
Impact: Workflow fails, database rolled back
Recovery:
  1. Transaction automatically rolled back
  2. Workflow status set to 'error'
  3. Automatic retry with exponential backoff
  4. Max 3 retry attempts
```

**Scenario 4: Better Auth Service Down**
```
Detection: Session validation fails
Impact: Users cannot authenticate
Recovery:
  1. Graceful degradation: read-only mode for public data
  2. Cache valid sessions for 5 minutes
  3. Health check endpoint returns degraded status
  4. Alert sent to operations team
```

### 15.2 Recovery Procedures

**Manual Workflow Retry**:
```typescript
// POST /api/workflows/runs/:runId/retry
async function retryWorkflow(workflowRunId: string) {
  const workflowRun = await knex('sys_workflow_runs')
    .where('id', workflowRunId)
    .first();

  // Create new workflow run
  const newRunId = await workflowService.trigger({
    entityName: workflowRun.entity_name,
    entityId: workflowRun.entity_id,
    operation: workflowRun.operation,
    userId: workflowRun.created_by
  });

  return newRunId;
}
```

**Bulk Workflow Reset**:
```typescript
// Admin utility to reset stuck workflows
async function resetStuckWorkflows() {
  const stuckWorkflows = await knex('sys_workflow_runs')
    .where('status', 'draft')
    .where('created_at', '<', new Date(Date.now() - 30 * 60 * 1000)); // 30 mins

  for (const workflow of stuckWorkflows) {
    await knex(`${workflow.entity_name.toLowerCase()}`)
      .where('id', workflow.entity_id)
      .update({ workflow_status: 'none' });

    await knex('sys_workflow_runs')
      .where('id', workflow.id)
      .update({
        status: 'error',
        error_details: 'Reset by administrator after timeout',
        completed_at: new Date()
      });
  }
}
```

---

## 16. Rollback Strategy

### 16.1 Feature Flags

All new features controlled by environment variables:
```bash
# Disable new auth system, fall back to JWT
USE_BETTER_AUTH=false

# Disable workflow engine
ENABLE_WORKFLOW_ENGINE=false

# Disable rules engine
ENABLE_RULES_ENGINE=false
```

### 16.2 Database Rollback

**Migration Rollback**:
```bash
# Rollback to previous migration
bun run migrate:rollback

# Or specific version
bun run migrate:rollback:all
bun run migrate:latest
```

**Data Recovery**:
```bash
# Backup before migration
pg_dump hms_production > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore if needed
psql hms_production < backup_20260330_120000.sql
```

### 16.3 Code Rollback

**Git-based Rollback**:
```bash
# Revert merge
git revert -m 1 <commit-hash>

# Or rollback to previous tag
git checkout v5.1.0
bun run build
bun run start
```

**Blue-Green Deployment**:
```bash
# Deploy new version to green environment
git checkout v6.0.0
# ... deploy green ...

# Test green environment
curl http://green.hospital.com/health

# Switch traffic to green
kubectl patch service hms-service -p '{"spec":{"selector":{"version":"v6.0.0"}}}'

# If issues, switch back to blue
kubectl patch service hms-service -p '{"spec":{"selector":{"version":"v5.1.0"}}}'
```

---

## Appendix A: Technology Compatibility Matrix

| Technology | Version | Bun.js 1.4.4+ | PostgreSQL | Knex.js | Fastify | Next.js 14 | OpenUI5 |
|------------|---------|-------------|------------|---------|---------|------------|---------|
| better-auth | 1.0+ | ✅ | ✅ | ✅ | ✅ (beta) | ✅ | N/A |
| @thallesp/nestjs-better-auth | 1.0+ | ✅ | ✅ | ✅ | ✅ | ✅ | N/A |
| @trigger.dev/sdk | 3.0+ | ✅ | N/A | N/A | N/A | ✅ | N/A |
| @gorules/zen-engine | 0.31+ | ✅ (WASM) | N/A | N/A | N/A | ✅ | N/A |
| @gorules/jdm-editor | 0.19+ | N/A | N/A | N/A | N/A | ✅ | N/A |

---

## Appendix B: Code Generator Template Updates

### B.1 New Templates to Create

**Common Templates**:
- `common/migrations/003_add_better_auth_tables.ts.hbs`
- `common/migrations/004_add_workflow_rules_tables.ts.hbs`
- `common/migrations/005_add_entity_workflow_columns.ts.hbs`
- `common/seeds/003_seed_default_rules.ts.hbs`
- `common/seeds/004_seed_roles_and_permissions.ts.hbs`

**NestJS/NextJS Templates**:
- `nextjs-nestjs/backend/src/modules/auth/auth.module.ts.hbs`
- `nextjs-nestjs/backend/src/modules/auth/auth.service.ts.hbs`
- `nextjs-nestjs/backend/src/modules/auth/auth.controller.ts.hbs`
- `nextjs-nestjs/backend/src/modules/auth/guards/auth.guard.ts.hbs`
- `nextjs-nestjs/backend/src/modules/auth/guards/roles.guard.ts.hbs`
- `nextjs-nestjs/backend/src/modules/workflow/workflow.module.ts.hbs`
- `nextjs-nestjs/backend/src/modules/workflow/workflow.service.ts.hbs`
- `nextjs-nestjs/backend/src/modules/rules/rules.module.ts.hbs`
- `nextjs-nestjs/backend/src/modules/rules/rules.service.ts.hbs`
- `nextjs-nestjs/backend/src/modules/rules/rules.controller.ts.hbs`
- `nextjs-nestjs/frontend/app/(auth)/login/page.tsx.hbs`
- `nextjs-nestjs/frontend/app/(auth)/register/page.tsx.hbs`
- `nextjs-nestjs/frontend/app/admin/rules/page.tsx.hbs`
- `nextjs-nestjs/frontend/app/admin/rules/[entity]/[ruleId]/page.tsx.hbs`
- `nextjs-nestjs/frontend/app/admin/workflows/page.tsx.hbs`

**OpenUI5/OData Templates**:
- `openui5-odatav4/backend/src/auth/better-auth.ts.hbs`
- `openui5-odatav4/backend/src/middleware/auth.middleware.ts.hbs`
- `openui5-odatav4/backend/src/workflow/trigger.client.ts.hbs`
- `openui5-odatav4/backend/src/workflow/entity-lifecycle-workflow.ts.hbs`
- `openui5-odatav4/backend/src/rules/zen-engine.service.ts.hbs`
- `openui5-odatav4/backend/src/rules/rules.controller.ts.hbs`

### B.2 Templates to Modify

**NestJS/NextJS**:
- `nextjs-nestjs/backend/src/main.ts.hbs` — Add bodyParser: false
- `nextjs-nestjs/backend/src/app.module.ts.hbs` — Add AuthModule, WorkflowModule, RulesModule
- `nextjs-nestjs/backend/package.json.hbs` — Add dependencies
- `nextjs-nestjs/backend/.env.example.hbs` — Add environment variables
- `nextjs-nestjs/frontend/package.json.hbs` — Add better-auth/react
- `nextjs-nestjs/frontend/app/providers.tsx.hbs` — Add SessionProvider

**OpenUI5/OData**:
- `openui5-odatav4/backend/src/server.ts.hbs` — Add auth middleware
- `openui5-odatav4/backend/src/controllers/base.controller.ts.hbs` — Add workflow dispatch
- `openui5-odatav4/backend/package.json.hbs` — Add dependencies
- `openui5-odatav4/backend/.env.example.hbs` — Add environment variables

---

## Appendix C: Example Default Rules

### C.1 Patient Age Stratification Rule

**JDM Definition**:
```json
{
  "name": "Patient Age Stratification",
  "nodes": [
    {
      "id": "age-stratification",
      "type": "decisionTable",
      "content": {
        "inputs": ["patient.age"],
        "outputs": ["age_category"],
        "rules": [
          {
            "condition": "patient.age < 18",
            "output": { "age_category": "pediatric" }
          },
          {
            "condition": "patient.age >= 18 AND patient.age < 65",
            "output": { "age_category": "adult" }
          },
          {
            "condition": "patient.age >= 65",
            "output": { "age_category": "geriatric" }
          }
        ]
      }
    }
  ]
}
```

### C.2 Appointment Conflict Detection Rule

**JDM Definition**:
```json
{
  "name": "Appointment Conflict Detection",
  "nodes": [
    {
      "id": "conflict-check",
      "type": "decisionTable",
      "content": {
        "inputs": [
          "appointment.doctor_id",
          "appointment.start_time",
          "appointment.end_time",
          "existingAppointments"
        ],
        "outputs": ["has_conflict", "conflict_message"],
        "rules": [
          {
            "condition": "existingAppointments.some(a => a.doctor_id === appointment.doctor_id AND ((a.start_time <= appointment.start_time AND a.end_time > appointment.start_time) OR (a.start_time < appointment.end_time AND a.end_time >= appointment.end_time)))",
            "output": {
              "has_conflict": true,
              "conflict_message": "Doctor already has an appointment at this time"
            }
          },
          {
            "condition": "true",
            "output": {
              "has_conflict": false,
              "conflict_message": null
            }
          }
        ]
      }
    }
  ]
}
```

---

## Document Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-03-30 | APPWITHAI Architecture Team | Initial architectural design document |

---

## Review & Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Technical Lead | | | |
| Security Reviewer | | | |
| Database Architect | | | |
| DevOps Lead | | | |
| Product Manager | | | |

---

**End of Document**
