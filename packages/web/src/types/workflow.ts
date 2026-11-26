/**
 * Workflow Types
 *
 * Type definitions for hook-based workflow system
 */

import type { HookParameter, HookType } from "@appwithai/editors/lib/workflow/hook-parser";

/**
 * Hook definition as stored in the database
 */
export interface HookDefinition {
  type: HookType;
  name: string;
  entity: string;
  parameters?: HookParameter[];
  enabled: boolean;
  code?: string;
  order: number;
}

/**
 * Hook workflow with flowchart representation
 */
export interface HookWorkflow {
  id: string;
  projectId: string;
  serviceName: string;
  hooks: HookDefinition[];
  flowchartCode: string;
  generatedHookCode?: string;
  isDraft: boolean;
  lastModified: string;
  description?: string;
  createdAt?: string;
}

/**
 * Legacy workflow definition (for backwards compatibility)
 */
export interface WorkflowDefinition {
  id: string;
  name: string;
  serviceName: string;
  mermaidCode: string;
  description?: string;
}

/**
 * Request to save draft workflow
 */
export interface SaveDraftRequest {
  serviceName: string;
  hooks: HookDefinition[];
  flowchartCode: string;
}

/**
 * Request to apply workflow (full save with validation)
 */
export interface ApplyWorkflowRequest {
  serviceName: string;
  hooks: HookDefinition[];
  flowchartCode: string;
}

/**
 * Response from applying workflow
 */
export interface ApplyWorkflowResponse {
  workflowId: string;
  generatedCode?: string;
  validationErrors?: string[];
  warnings?: string[];
}

/**
 * Service information for service selection page
 */
export interface ServiceInfo {
  name: string;
  entity: string;
  description: string;
  hooksCount: number;
}

/**
 * Draft data stored in localStorage
 */
export interface DraftWorkflowData {
  workflow: HookWorkflow;
  flowchartCode: string;
  selectedHooks: HookDefinition[];
  timestamp: string;
}
