/**
 * Projects API client
 * Handles all project-related API calls
 */

import type { Project, ValidationError, WorkflowDefinition } from "@/types/project";
import { ApiClient } from "../api-client";

const apiClient = new ApiClient("/api");

export interface CreateProjectInput {
  name: string;
  description?: string;
  icon?: string;
  iconColor?: string;
  stackType?: Project["stackType"];
  port?: number;
  databaseUrl?: string;
  environmentVariables?: Record<string, string>;
  /**
   * A complete EML document to start from.
   *
   * The API has always accepted this and stored it as version 1; leaving it off
   * the type meant the only way to begin a project was to describe the domain
   * in prose, even when a model already existed.
   */
  erdCode?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  icon?: string;
  iconColor?: string;
  status?: Project["status"];
  stackType?: Project["stackType"];
  port?: number;
  databaseUrl?: string;
  environmentVariables?: Record<string, string>;
  generatedPath?: string;
  deploymentUrl?: string;
  deploymentStatus?: Project["deploymentStatus"];
  uptime?: string;
}

export interface ERDVersion {
  git_commit?: string | null;
  id: string;
  project_id: string;
  version_number: number;
  mermaid_code: string;
  description: string | null;
  is_current: boolean;
  validation_errors: ValidationError[] | null;
  created_by: string | null;
  created_at: string;
}

export interface CreateERDVersionInput {
  mode?: "draft" | "version";
  requestId?: string;
  expectedCommit?: string | null;
  mermaidCode: string;
  description?: string;
  createdBy?: string;
  validationErrors?: ValidationError[];
}

export interface CreateWorkflowInput {
  name: string;
  serviceName: string;
  mermaidCode: string;
  description?: string;
  extensionPoints?: Record<string, unknown>;
}

export interface DeploymentInput {
  status: "running" | "stopped" | "error";
  deploymentUrl?: string;
  port?: number;
  uptime?: string;
}

export interface ProjectsListResponse {
  projects: Project[];
}

export interface ProjectResponse {
  project: Project;
}

export interface ERDVersionsResponse {
  versions: ERDVersion[];
}

export interface ERDVersionResponse {
  version: ERDVersion;
}

export interface WorkflowsResponse {
  workflows: WorkflowDefinition[];
}

export interface WorkflowResponse {
  workflow: WorkflowDefinition;
}

export interface DeploymentResponse {
  deployment: {
    id: string;
    project_id: string;
    status: string;
    deployment_url: string | null;
    port: number;
    uptime: string | null;
    started_at: string | null;
    stopped_at: string | null;
  } | null;
  url?: string;
}

/**
 * Projects API
 */
export const projectsApi = {
  /**
   * Get all projects with optional filtering
   */
  async getAll(options?: { search?: string; status?: string }): Promise<Project[]> {
    const params = new URLSearchParams();
    if (options?.search) params.set("search", options.search);
    if (options?.status) params.set("status", options.status);

    const response = await apiClient.get<ProjectsListResponse>(
      `/projects${params.toString() ? `?${params.toString()}` : ""}`
    );
    return response.projects;
  },

  /**
   * Get a project by ID
   */
  async getById(id: string): Promise<Project> {
    const response = await apiClient.get<ProjectResponse>(`/projects/${id}`);
    return response.project;
  },

  /**
   * Create a new project
   */
  async create(input: CreateProjectInput): Promise<Project> {
    const response = await apiClient.post<ProjectResponse, CreateProjectInput>("/projects", input);
    return response.project;
  },

  /**
   * Update a project
   */
  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const response = await apiClient.patch<ProjectResponse, UpdateProjectInput>(
      `/projects/${id}`,
      input
    );
    return response.project;
  },

  /**
   * Delete a project (soft delete)
   */
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/projects/${id}`);
  },
};

/**
 * ERD Versions API
 */
export const erdVersionsApi = {
  async saveDraft(projectId: string, input: CreateERDVersionInput): Promise<void> {
    await apiClient.post(`/projects/${projectId}/erd-versions`, { ...input, mode: "draft" });
  },
  /**
   * Get all ERD versions for a project
   */
  async getAll(projectId: string): Promise<ERDVersion[]> {
    const response = await apiClient.get<ERDVersionsResponse>(
      `/projects/${projectId}/erd-versions`
    );
    return response.versions;
  },

  /**
   * Create a new ERD version
   */
  async create(projectId: string, input: CreateERDVersionInput): Promise<ERDVersion> {
    const response = await apiClient.post<ERDVersionResponse, CreateERDVersionInput>(
      `/projects/${projectId}/erd-versions`,
      input
    );
    return response.version;
  },

  /**
   * Restore a version as current
   */
  async restore(projectId: string, versionId: string): Promise<ERDVersion> {
    const response = await apiClient.post<ERDVersionResponse, never>(
      `/projects/${projectId}/erd-versions/${versionId}/restore`
    );
    return response.version;
  },

  /**
   * Delete a version
   */
  async delete(projectId: string, versionId: string): Promise<void> {
    await apiClient.delete(`/projects/${projectId}/erd-versions/${versionId}`);
  },
};

/**
 * Workflows API
 */
export const workflowsApi = {
  /**
   * Get all workflows for a project
   */
  async getAll(projectId: string): Promise<WorkflowDefinition[]> {
    const response = await apiClient.get<WorkflowsResponse>(`/projects/${projectId}/workflows`);
    return response.workflows;
  },

  /**
   * Create a new workflow
   */
  async create(projectId: string, input: CreateWorkflowInput): Promise<WorkflowDefinition> {
    const response = await apiClient.post<WorkflowResponse, CreateWorkflowInput>(
      `/projects/${projectId}/workflows`,
      input
    );
    return response.workflow;
  },

  /**
   * Update a workflow
   */
  async update(
    projectId: string,
    workflowId: string,
    input: Partial<CreateWorkflowInput>
  ): Promise<WorkflowDefinition> {
    const response = await apiClient.patch<WorkflowResponse, Partial<CreateWorkflowInput>>(
      `/projects/${projectId}/workflows/${workflowId}`,
      input
    );
    return response.workflow;
  },

  /**
   * Delete a workflow
   */
  async delete(projectId: string, workflowId: string): Promise<void> {
    await apiClient.delete(`/projects/${projectId}/workflows/${workflowId}`);
  },
};

/**
 * Deployment API
 */
export const deploymentApi = {
  /**
   * Get deployment status for a project
   */
  async get(projectId: string): Promise<DeploymentResponse["deployment"]> {
    const response = await apiClient.get<DeploymentResponse>(`/projects/${projectId}/deployment`);
    return response.deployment;
  },

  /**
   * Create or update deployment
   */
  async upsert(projectId: string, input: DeploymentInput): Promise<DeploymentResponse> {
    const response = await apiClient.post<DeploymentResponse, DeploymentInput>(
      `/projects/${projectId}/deployment`,
      input
    );
    return response;
  },

  /**
   * Stop and remove deployment
   */
  async stop(projectId: string): Promise<void> {
    await apiClient.delete(`/projects/${projectId}/deployment`);
  },
};
