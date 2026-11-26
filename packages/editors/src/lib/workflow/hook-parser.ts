/**
 * Hook Syntax Parser
 *
 * Parses hook definitions from Mermaid flowchart comments.
 * Syntax: %%hook <hookType> <hookName> on <EntityName>
 *
 * Examples:
 * %%hook beforeCreate hashPassword on User
 * %%hook afterCreate sendWelcomeEmail on User
 * %%hook beforeCreate generateSlug on Post[field: slug]
 */

export type HookType =
  | "beforeCreate"
  | "afterCreate"
  | "beforeUpdate"
  | "afterUpdate"
  | "beforeDelete"
  | "afterDelete"
  | "beforeQuery"
  | "afterQuery"
  | "customValidate"
  | "beforeRead"
  | "afterRead"
  | "beforeList"
  | "afterList";

export interface HookParameter {
  name: string;
  type: string;
}

export interface ParsedHookDefinition {
  type: HookType;
  name: string;
  entity: string;
  parameters?: HookParameter[];
  rawComment: string;
  order: number;
}

export interface ParseResult {
  hooks: ParsedHookDefinition[];
  errors: string[];
  warnings: string[];
}

const HOOK_TYPE_PATTERN =
  /^(beforeCreate|afterCreate|beforeUpdate|afterUpdate|beforeDelete|afterDelete|beforeQuery|afterQuery|customValidate|beforeRead|afterRead|beforeList|afterList)$/;

const HOOK_COMMENT_PATTERN =
  /%%hook\s+(\w+)\s+(\w+)\s+on\s+(\w+)(\[(?:field:\s*\w+(?:\s*,\s*field:\s*\w+)*)?\])?/;

/**
 * Parse a single hook comment line
 */
export function parseHookComment(comment: string, order: number): ParsedHookDefinition | null {
  const trimmedComment = comment.trim();

  if (!trimmedComment.startsWith("%%hook")) {
    return null;
  }

  const match = trimmedComment.match(HOOK_COMMENT_PATTERN);

  if (!match) {
    return null;
  }

  const [, hookTypeStr, hookName, entity, paramsStr] = match;

  // Validate hook type
  if (!hookTypeStr || !HOOK_TYPE_PATTERN.test(hookTypeStr)) {
    return null;
  }

  if (!hookName || !entity) {
    return null;
  }

  const hookType = hookTypeStr as HookType;

  // Parse parameters if present
  let parameters: HookParameter[] | undefined;
  if (paramsStr) {
    parameters = parseParameters(paramsStr);
  }

  return {
    type: hookType,
    name: hookName,
    entity,
    parameters,
    rawComment: trimmedComment,
    order,
  };
}

/**
 * Parse parameters from hook comment
 * Format: [field: password, field: email]
 */
function parseParameters(paramsStr: string): HookParameter[] {
  const parameters: HookParameter[] = [];

  // Remove brackets and split by comma
  const content = paramsStr.slice(1, -1).trim();

  if (!content) {
    return parameters;
  }

  const parts = content.split(",").map((p) => p.trim());

  for (const part of parts) {
    // Match "field: fieldName" or just "fieldName"
    const fieldMatch = part.match(/^field:\s*(\w+)$/);
    if (fieldMatch?.[1]) {
      parameters.push({ name: fieldMatch[1], type: "field" });
    } else if (part.match(/^\w+$/)) {
      parameters.push({ name: part, type: "unknown" });
    }
  }

  return parameters;
}

/**
 * Parse hook definitions from Mermaid flowchart code
 */
export function parseHooksFromFlowchart(flowchartCode: string): ParseResult {
  const hooks: ParsedHookDefinition[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  const lines = flowchartCode.split("\n");
  let hookOrder = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines and non-comments
    if (!trimmedLine?.startsWith("%%")) {
      continue;
    }

    // Try to parse as hook comment
    const hook = parseHookComment(trimmedLine, hookOrder);

    if (hook) {
      hooks.push(hook);
      hookOrder++;
    } else if (trimmedLine.startsWith("%%hook")) {
      // It looks like a hook comment but failed to parse
      errors.push(`Invalid hook syntax: "${trimmedLine}"`);
    }
  }

  return {
    hooks,
    errors,
    warnings,
  };
}

/**
 * Generate hook comment from hook definition
 */
export function generateHookComment(hook: ParsedHookDefinition): string {
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
export function generateFlowchartFromHooks(
  entityName: string,
  hooks: ParsedHookDefinition[]
): string {
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
    flowchart += `    ${generateHookComment(hook)}\n`;
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
export function validateHookDefinition(hook: ParsedHookDefinition): string[] {
  const errors: string[] = [];

  // Validate hook type
  if (!HOOK_TYPE_PATTERN.test(hook.type)) {
    errors.push(`Invalid hook type: ${hook.type}`);
  }

  // Validate hook name
  if (!hook.name || hook.name.length === 0) {
    errors.push("Hook name cannot be empty");
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(hook.name)) {
    errors.push(
      `Invalid hook name: ${hook.name}. Must start with letter or underscore and contain only letters, numbers, and underscores`
    );
  }

  // Validate entity name
  if (!hook.entity || hook.entity.length === 0) {
    errors.push("Entity name cannot be empty");
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(hook.entity)) {
    errors.push(
      `Invalid entity name: ${hook.entity}. Must start with letter or underscore and contain only letters, numbers, and underscores`
    );
  }

  return errors;
}

/**
 * Convert parsed hook to HookDefinition (for use in components)
 */
export interface HookDefinition {
  type: HookType;
  name: string;
  entity: string;
  enabled: boolean;
  code?: string;
  order: number;
}

export function toHookDefinition(
  parsedHook: ParsedHookDefinition,
  enabled: boolean = true
): HookDefinition {
  return {
    type: parsedHook.type,
    name: parsedHook.name,
    entity: parsedHook.entity,
    enabled,
    order: parsedHook.order,
  };
}

/**
 * Convert HookDefinition to ParsedHookDefinition
 */
export function fromHookDefinition(hook: HookDefinition): ParsedHookDefinition {
  const comment = `%%hook ${hook.type} ${hook.name} on ${hook.entity}`;

  return {
    type: hook.type,
    name: hook.name,
    entity: hook.entity,
    rawComment: comment,
    order: hook.order,
  };
}
