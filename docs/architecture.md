# APPWITHAI Architecture & Development Guide

## System Overview

APPWITHAI is an AI-powered Entity Relationship Design & Code Generation platform built with:

- **Runtime**: Bun.js 1.4.4+ (Node.js 20+ compatible)
- **AI Framework**: Mastra.ai, CopilotKit, AG-UI
- **AI Model**: Anthropic Claude Sonnet 4
- **Frontend**: TanStack Start 1+, Vite 5+, React 18+, Shadcn UI, TailwindCSS
- **Backend**: NestJS, Kysely (type-safe SQL), OData V4
- **Database**: PostgreSQL (primary), SQLite (Mastra state)
- **Templates**: Handlebars 4.7+
- **Validation**: Zod 3.22+
- **State**: Zustand 4.4+

## Multi-Layer Architecture

```
┌─────────────────────────────────────────┐
│         Natural Language Input          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│      Domain Agent (Claude Sonnet 4)     │
│     Extracts entities & relationships   │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│   Entity & Relationship Agents          │
│       Refine structure & types          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│       Human Approval (HITL)             │
│    CopilotKit UI + Mastra.ai            │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│      Mermaid Agent                      │
│    Generates ERD syntax                 │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│      Mermaid Parser                     │
│    Parses to Entity objects             │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│    Dictionary Populator                 │
│  Populates AD_Table, AD_Column, etc.    │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│      Template Generator                 │
│   Applies Handlebars templates          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│      Generated Application              │
│ TanStack Start / NestJS / OData / OpenUI5│
└─────────────────────────────────────────┘
```

## Monorepo Structure

```
appwithai/
├── packages/
│   ├── core/              # Core business logic, types, hooks, services
│   ├── generator/         # Code generation engine & Handlebars templates
│   ├── ai/               # AI features (Mastra.ai agents, CopilotKit)
│   └── web/              # TanStack Start web application
├── migrations/           # Database schema migrations
├── docs/                # Project documentation
└── templates/           # Code generation templates
```

## Package Descriptions

### @appwithai/core
Business logic, hooks, RBAC, validation, utilities.

**Key Components:**
- Dictionary types (AD_Table, AD_Column, AD_Window, etc.)
- RBAC types (AD_User, AD_Role, AD_Access)
- Hook system (Registry, Executor, Builder)
- Base services with automatic hook execution

### @appwithai/generator
Code generation engine with template loading.

**Key Components:**
- Mermaid parser
- Template loader (Handlebars)
- Base generator class
- CLI tool

### @appwithai/ai ⭐
Mastra.ai orchestration for AI-powered design.

**Key Components:**
- 5 AI agents (Domain, Entity, Relationship, Validation, Mermaid)
- Human-in-the-loop workflow
- Standalone converter
- CLI tool

### @appwithai/web ⭐
TanStack Start web application with CopilotKit.

**Key Components:**
- CopilotKit provider
- Mastra client integration
- Entity approval UI
- Dashboard interface

## Data Flow

1. **Natural Language** → Domain Agent
2. **Entity Candidates** → Entity Agent + Human Approval
3. **Relationship Candidates** → Relationship Agent + Human Approval
4. **Approved Model** → Mermaid Agent
5. **Mermaid ERD** → Mermaid Parser
6. **Entity Objects** → Dictionary Populator
7. **AD Tables** → Template Generator
8. **Templates + Context** → Generated Code

## Critical Files

### Mastra.ai Integration
- `packages/ai/src/mastra.ts` - Mastra instance
- `packages/ai/src/workflows/erd-design-workflow.ts` - HITL workflow
- `packages/ai/src/agents/domain-agent.ts` - Domain analysis

### CopilotKit Integration
- `packages/web/src/app/providers.tsx` - CopilotKit provider
- `packages/web/src/app/api/copilotkit/route.ts` - API endpoint
- `packages/web/src/components/approval/entity-approval-card.tsx` - HITL UI

## Natural Language Patterns

### Entity Detection
- "users" → User entity
- "blog posts" → BlogPost entity
- "order items" → OrderItem entity

### Relationship Detection
- "users create posts" → User 1:N Post
- "post has comments" → Post 1:N Comment
- "products in categories" → Product N:1 Category
- "posts tagged with tags" → Post M:N Tag

### Attribute Detection
- Email addresses → email: string (unique)
- Names → firstName, lastName: string
- Passwords → passwordHash: string
- Dates → createdAt, updatedAt: datetime
- Flags → isActive, isPublished: boolean

## Code Style Guidelines

### TypeScript Configuration
- **Target**: ES2022
- **Module**: ESNext with bundler resolution
- **Strict Mode**: Enabled
- **Unused Locals**: Error
- **Unused Parameters**: Error
- **Isolated Modules**: True
- **JSX**: Preserve (for React)

### Import Conventions

**Order of imports:**
1. External dependencies (React, TanStack, etc.)
2. Internal package imports (@appwithai/\*)
3. Relative imports (./types, ../utils)
4. Type imports (import type)

**Example:**
```typescript
import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Database, FileCode } from "lucide-react";

import { mastra } from "@appwithai/ai";
import type { EntityDefinition } from "@appwithai/core/types";

import { analyzeDomain } from "../agents/domain-agent";
import type { DomainAnalysis } from "../types";
```

**Package aliases:**
- `@appwithai/core` - Core business logic
- `@appwithai/core/types` - Type definitions
- `@appwithai/core/hooks` - Hook system
- `@appwithai/core/services` - Base services
- `@appwithai/core/utils` - Utility functions
- `@appwithai/generator` - Code generation
- `@appwithai/ai` - AI features
- `@appwithai/web` - Web application

### Naming Conventions

**Functions:**
```typescript
// camelCase for functions
export function analyzeDomain(description: string) {}
export async function convertToMermaid(description: string) {}

// Utility functions follow same pattern
export function pascalCase(str: string): string {}
export function camelCase(str: string): string {}
```

**Types & Interfaces:**
```typescript
// PascalCase for types and interfaces
export interface EntityAttribute {}
export interface DomainAnalysis {}
export type EntityDefinition = Entity;
```

**Classes:**
```typescript
// PascalCase for classes
export class AIToMermaidConverter {}
export class EntityService extends BaseService<EntityDefinition> {}
```

**Constants:**
```typescript
// camelCase for instances
export const globalHookExecutor = new HookExecutor();
export const domainAgent = new Agent({});

// UPPER_SNAKE_CASE for true constants
const MAX_RETRY_ATTEMPTS = 3;
```

**Files:**
- Use kebab-case: `domain-agent.ts`, `hook-executor.ts`
- Type files: `entity.types.ts`, `hook.types.ts`
- React components: `page.tsx`, `dashboard/page.tsx`

### Type Definitions

**Always use explicit types for:**
- Function parameters and return types
- Interface/type exports
- Service method signatures

```typescript
// Good - explicit types
export async function analyzeDomain(
  description: string,
): Promise<DomainAnalysis> {
  // implementation
}

// Good - type alias for clarity
export type EntityDefinition = Entity;

// Use Zod for validation schemas
export const EntityAttributeSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "integer", "decimal", "boolean"]),
  required: z.boolean(),
});
```

### Error Handling

**Pattern 1: Try-catch with error wrapping**
```typescript
async convert(input: ConverterInput): Promise<ConverterOutput> {
  try {
    const domainAnalysis = await analyzeDomain(input.description);

    if (!domainAnalysis) {
      return {
        success: false,
        error: 'Domain analysis returned empty result'
      };
    }

    return { success: true, domainAnalysis };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
```

**Pattern 2: Hook execution (no throw)**
```typescript
async execute<T>(entityName: string, lifecycle: HookLifecycle, data: T): Promise<T> {
  const hooks = globalHookRegistry.getHooks(entityName, lifecycle);
  let result = data;

  for (const hook of hooks) {
    const hookResult = await hook.execute(context);
    if (hookResult !== undefined) {
      result = hookResult;
    }
  }

  return result;
}
```

### React Component Style

**Use 'use client' directive for client components:**
```typescript
"use client";

import React from "react";
```

**Functional components with TypeScript:**
```typescript
export default function DashboardPage() {
  return (
    <div className="min-h-screen">
      {/* content */}
    </div>
  );
}
```

**Styling with Tailwind:**
- Use className for Tailwind utilities
- Prefer template literals for conditional classes
- Use clsx for complex conditions

### Service Architecture

**Base service pattern:**
```typescript
export abstract class BaseService<T> {
  protected abstract entityName: string;

  async create(data: Partial<T>): Promise<T> {
    const processed = await globalHookExecutor.execute(
      this.entityName,
      "beforeCreate",
      data,
    );
    return this.performCreate(processed);
  }

  protected abstract performCreate(data: Partial<T>): Promise<T>;
}

// Extend for specific entities
export class EntityService extends BaseService<EntityDefinition> {
  protected entityName = "Entity";

  protected async performCreate(
    data: Partial<EntityDefinition>,
  ): Promise<EntityDefinition> {
    // implementation
  }
}
```

## Best Practices

1. **Always use Bun commands** when available (not npm/yarn)
2. **No unused imports or variables** (enforced by tsconfig)
3. **Prefer async/await** over promises/callbacks
4. **Use Zod for runtime validation** of external data
5. **Use workspace protocol** for internal packages (`workspace:*`)
6. **Keep services stateless** where possible
7. **Use hook system** for cross-cutting concerns (logging, validation)
8. **Template generation** with Handlebars for all code generation
9. **Environment variables** for configuration (never hardcode secrets)

## Common Patterns

### AI Agent Pattern

```typescript
export const domainAgent = new Agent({
  id: "domain-agent",
  name: "Domain Analyzer",
  instructions: `Your instructions here`,
  model: "anthropic/claude-sonnet-4-20250514",
});

export async function analyzeDomain(description: string) {
  const response = await domainAgent.generate(description, {
    structuredOutput: { schema: domainAnalysisSchema },
  });
  return response.object;
}
```

### Converter Pattern

```typescript
export class AIToMermaidConverter {
  async convert(input: ConverterInput): Promise<ConverterOutput> {
    // Convert logic with error handling
  }

  async convertFast(description: string): Promise<string> {
    // Quick conversion without approvals
  }
}
```

## Important Notes

- **Never commit** `.env` files or secrets
- **Test files** are in `.gitignore` (`*.test.ts`, `*.spec.ts`)
- **Generated files** are ignored (`generated/`, `*.mermaid`)
- **Database files** are ignored (`*.db`, `*.sqlite`)
- **Package manager**: Always use Bun (not npm/yarn)
- **Node version**: Minimum 20.0.0
- **Bun version**: Minimum 1.1.0

## Environment Variables

Required for development:

- `ANTHROPIC_API_KEY` - Your Anthropic API key for AI features
- `DATABASE_URL` - PostgreSQL connection string

See `.env.example` for complete list.

---

**Version**: 5.1.0
**Last Updated**: February 2026
**For**: AI Coding Agents and Developers
