/**
 * Utility Functions for Hook Processing
 *
 * Bridge between the core parser and the web hook-parser module
 */

import { hookParser } from "./parser";
import type { GeneratedHook, HookDefinitionNode, HookType, ParsedHook } from "./types";
import { HookCodeGenerationVisitor } from "./visitor";

/**
 * Parse a single hook definition string
 * Returns null if parsing fails
 */
export function parseHookDefinition(comment: string, order: number): ParsedHook | null {
  const trimmedComment = comment.trim();

  if (!trimmedComment.startsWith("%%hook")) {
    return null;
  }

  const result = hookParser.parse(trimmedComment);

  if (!result.ast || result.errors.length > 0) {
    return null;
  }

  const ast = result.ast as HookDefinitionNode;

  return {
    type: ast.hookType,
    name: ast.hookName,
    entity: ast.entity,
    parameters: ast.parameters?.map((p) => ({
      name: p.name,
      type: p.kind,
    })),
    order,
    rawComment: trimmedComment,
  };
}

/**
 * Parse hook definitions from Mermaid flowchart code
 */
export function parseHooksFromFlowchart(flowchartCode: string): {
  hooks: ParsedHook[];
  errors: string[];
  warnings: string[];
} {
  const { results } = hookParser.parseMultiple(flowchartCode);

  const hooks: ParsedHook[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  results.forEach((result, index) => {
    if (result.ast && result.errors.length === 0) {
      const ast = result.ast as HookDefinitionNode;
      hooks.push({
        type: ast.hookType,
        name: ast.hookName,
        entity: ast.entity,
        parameters: ast.parameters?.map((p) => ({
          name: p.name,
          type: p.kind,
        })),
        order: index,
        rawComment: ast.raw,
      });
    } else {
      errors.push(...result.errors.map((e) => e.message));
    }
  });

  return { hooks, errors, warnings };
}

/**
 * Generate hook comment from parsed hook definition
 */
export function generateHookComment(hook: ParsedHook): string {
  let comment = `%%hook ${hook.type} ${hook.name} on ${hook.entity}`;

  if (hook.parameters && hook.parameters.length > 0) {
    const params = hook.parameters.map((p) => `field: ${p.name}`).join(", ");
    comment += `[field: ${params}]`;
  }

  return comment;
}

/**
 * Generate Mermaid flowchart from hook definitions
 */
export function generateFlowchartFromHooks(entityName: string, hooks: ParsedHook[]): string {
  let flowchart = `flowchart TD\n`;
  flowchart += `    A[Client Request] --> B[Validate Request]\n`;

  // Add hook nodes
  hooks.forEach((hook, index) => {
    const letter = String.fromCharCode(66 + index); // B, C, D, ...

    if (hook.type !== "customValidate") {
      flowchart += `    B --> ${letter}[${hook.type}: ${hook.name}]\n`;

      if (index === hooks.length - 1) {
        flowchart += `    ${letter} --> C[Process ${entityName}]\n`;
      } else {
        const nextLetter = String.fromCharCode(66 + index + 1);
        flowchart += `    ${letter} --> ${nextLetter}\n`;
      }
    }
  });

  if (hooks.length === 0) {
    flowchart += `    B --> C[Process ${entityName}]\n`;
  }

  flowchart += `    C --> D[Response]\n`;
  flowchart += `    D --> E[Return to Client]\n\n`;

  // Add hook comments
  hooks.forEach((hook) => {
    flowchart += `    %%${generateHookComment(hook)}\n`;
  });
  flowchart += `\n`;

  // Add styling
  flowchart += `    style A fill:#e1f5fe\n`;
  flowchart += `    style E fill:#c8e6c9\n`;

  const hookColors: Record<HookType, string> = {
    beforeCreate: "#90caf9",
    afterCreate: "#a5d6a7",
    beforeUpdate: "#fff59d",
    afterUpdate: "#ffcc80",
    beforeDelete: "#ef9a9a",
    afterDelete: "#b0bec5",
    beforeQuery: "#ce93d8",
    afterQuery: "#9fa8da",
    customValidate: "#f48fb1",
    beforeRead: "#67e8f9",
    afterRead: "#14b8a6",
    beforeList: "#d9f99d",
    afterList: "#10b981",
  };

  hooks.forEach((hook, index) => {
    const letter = String.fromCharCode(66 + index);
    const color = hookColors[hook.type] || "#fff9c4";
    flowchart += `    style ${letter} fill:${color}\n`;
  });

  return flowchart;
}

/**
 * Validate hook definition
 */
export function validateHookDefinition(hook: ParsedHook): string[] {
  const errors: string[] = [];

  const validHookTypes: HookType[] = [
    "beforeCreate",
    "afterCreate",
    "beforeUpdate",
    "afterUpdate",
    "beforeDelete",
    "afterDelete",
    "beforeQuery",
    "afterQuery",
    "customValidate",
    "beforeRead",
    "afterRead",
    "beforeList",
    "afterList",
  ];

  if (!validHookTypes.includes(hook.type)) {
    errors.push(`Invalid hook type: ${hook.type}`);
  }

  if (!hook.name || hook.name.length === 0) {
    errors.push("Hook name cannot be empty");
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(hook.name)) {
    errors.push(`Invalid hook name: ${hook.name}. Must start with letter or underscore`);
  }

  if (!hook.entity || hook.entity.length === 0) {
    errors.push("Entity name cannot be empty");
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(hook.entity)) {
    errors.push(`Invalid entity name: ${hook.entity}. Must start with letter or underscore`);
  }

  return errors;
}

/**
 * Convert parsed hook to HookDefinition format
 */
export interface HookDefinition {
  type: HookType;
  name: string;
  entity: string;
  enabled: boolean;
  code?: string;
  order: number;
}

export function toHookDefinition(parsedHook: ParsedHook, enabled: boolean = true): HookDefinition {
  return {
    type: parsedHook.type,
    name: parsedHook.name,
    entity: parsedHook.entity,
    enabled,
    order: parsedHook.order,
  };
}

/**
 * Convert HookDefinition to ParsedHook
 */
export function fromHookDefinition(hook: HookDefinition): ParsedHook {
  const comment = `%%hook ${hook.type} ${hook.name} on ${hook.entity}`;

  return {
    type: hook.type,
    name: hook.name,
    entity: hook.entity,
    order: hook.order,
    rawComment: comment,
  };
}

/**
 * Generate TypeScript code from hook definition
 */
export function generateHookCode(
  hook: ParsedHook,
  options?: {
    addComments?: boolean;
    includeErrorHandling?: boolean;
    asyncHooks?: boolean;
  }
): GeneratedHook {
  const visitor = new HookCodeGenerationVisitor(options);
  const code = visitor.visitHookDefinition({
    $type: "HookDefinition",
    hookType: hook.type,
    hookName: hook.name,
    entity: hook.entity,
    parameters: hook.parameters?.map((p) => ({
      $type: "Parameter",
      name: p.name,
      kind: "field" as const,
    })),
    raw: hook.rawComment,
  });

  return {
    entityName: hook.entity,
    hookType: hook.type,
    hookName: hook.name,
    code,
    // Bracket access on purpose: `currentImports` is private on the visitor and
    // this is the one place that needs to read it out. Dot access does not
    // compile, so do not "simplify" it to one.
    // deliberate private-member escape hatch
    imports: Array.from(visitor["currentImports"]),
    fileName: `${hook.type}.${hook.name}.ts`,
  };
}

/**
 * Generate TypeScript code for multiple hooks
 */
export function generateHookCodeFile(
  hooks: ParsedHook[],
  options?: {
    addComments?: boolean;
    includeErrorHandling?: boolean;
    asyncHooks?: boolean;
  }
): { code: string; imports: string[] } {
  const allImports = new Set<string>();
  const hookCodes: string[] = [];

  hooks.forEach((hook) => {
    const generated = generateHookCode(hook, options);
    hookCodes.push(generated.code);
    for (const imp of generated.imports) allImports.add(imp);
  });

  const code = hookCodes.join("\n\n");

  return {
    code,
    imports: Array.from(allImports),
  };
}
