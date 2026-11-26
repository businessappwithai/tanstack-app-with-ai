/**
 * Project Store with API integration
 * Uses Zustand for state management with SQLite backend
 */

import { create } from "zustand";
import {
  type CreateProjectInput,
  type CreateWorkflowInput,
  deploymentApi,
  erdVersionsApi,
  projectsApi,
  type UpdateProjectInput,
  workflowsApi,
} from "@/lib/api/projects";
import {
  type Project,
  type ProjectStep,
  STEP_ORDER,
  type WorkflowDefinition,
} from "../types/project";

interface ProjectStore {
  // State
  projects: Project[];
  currentProject: Project | null;
  currentStep: ProjectStep;
  currentActionId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadProjects: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  getProject: (id: string) => Project | undefined;
  addProject: (project: CreateProjectInput) => Promise<Project>;
  updateProject: (id: string, updates: UpdateProjectInput) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setCurrentProject: (id: string | null) => void;

  // Workflow
  setCurrentStep: (step: ProjectStep) => void;
  goToNextStep: () => void;
  goToPreviousStep: () => void;

  // ERD Operations
  updateErdCode: (id: string, code: string, description?: string) => Promise<void>;
  saveErdVersion: (projectId: string, code: string, description?: string) => Promise<void>;
  restoreErdVersion: (projectId: string, versionId: string) => Promise<void>;

  // Workflow Operations
  addWorkflow: (projectId: string, workflow: CreateWorkflowInput) => Promise<void>;
  updateWorkflow: (
    projectId: string,
    workflowId: string,
    updates: Partial<WorkflowDefinition>
  ) => Promise<void>;

  // Deployment
  startProject: (id: string) => Promise<void>;
  stopProject: (id: string) => Promise<void>;
}

// Preserve the same operation ID when a network failure leaves the outcome uncertain.
const pendingSaves = new Map<string, { fingerprint: string; requestId: string }>();
function saveRequest(projectId: string, kind: string, code: string, description?: string) {
  const key = `${projectId}:${kind}`;
  const fingerprint = JSON.stringify([code, description]);
  const previous = pendingSaves.get(key);
  if (previous?.fingerprint === fingerprint) return previous.requestId;
  const requestId = crypto.randomUUID();
  pendingSaves.set(key, { fingerprint, requestId });
  return requestId;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  // Initial state
  projects: [],
  currentProject: null,
  currentStep: "init",
  currentActionId: null,
  isLoading: false,
  error: null,

  // Load all projects
  loadProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const projects = await projectsApi.getAll();
      set({ projects, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to load projects",
        isLoading: false,
      });
    }
  },

  // Load a single project
  loadProject: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const project = await projectsApi.getById(id);
      set({ currentProject: project, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to load project",
        isLoading: false,
      });
    }
  },

  // Get a project from local state
  getProject: (id: string) => {
    return get().projects.find((p) => p.id === id && !p.isDeleted);
  },

  // Add a new project
  addProject: async (projectData: CreateProjectInput) => {
    set({ isLoading: true, error: null });
    try {
      const newProject = await projectsApi.create(projectData);
      set((state) => ({
        projects: [newProject, ...state.projects],
        currentProject: newProject,
        currentStep: "init",
        isLoading: false,
      }));
      return newProject;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to create project",
        isLoading: false,
      });
      throw error;
    }
  },

  // Update a project
  updateProject: async (id: string, updates: UpdateProjectInput) => {
    set({ isLoading: true, error: null });
    try {
      const updatedProject = await projectsApi.update(id, updates);
      set((state) => ({
        projects: state.projects.map((p) => (p.id === id ? updatedProject : p)),
        currentProject: state.currentProject?.id === id ? updatedProject : state.currentProject,
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to update project",
        isLoading: false,
      });
      throw error;
    }
  },

  // Delete a project
  deleteProject: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await projectsApi.delete(id);
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        currentProject: state.currentProject?.id === id ? null : state.currentProject,
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to delete project",
        isLoading: false,
      });
      throw error;
    }
  },

  // Set current project
  setCurrentProject: (id: string | null) => {
    if (id === null) {
      set({ currentProject: null, currentStep: "init" });
    } else {
      const project = get().projects.find((p) => p.id === id);
      if (project) {
        set({ currentProject: project, currentStep: "init" });
      }
    }
  },

  // Set current step
  setCurrentStep: (step: ProjectStep) => {
    set({ currentStep: step });
  },

  // Go to next step
  goToNextStep: () => {
    const steps = STEP_ORDER;
    const currentIndex = steps.indexOf(get().currentStep);
    if (currentIndex < steps.length - 1) {
      set({ currentStep: steps[currentIndex + 1] });
    }
  },

  // Go to previous step
  goToPreviousStep: () => {
    const steps = STEP_ORDER;
    const currentIndex = steps.indexOf(get().currentStep);
    if (currentIndex > 0) {
      set({ currentStep: steps[currentIndex - 1] });
    }
  },

  // Update ERD code and create a new version
  updateErdCode: async (id: string, code: string, description?: string) => {
    set({ isLoading: true, error: null });
    try {
      // Create a new version
      await erdVersionsApi.saveDraft(id, {
        mermaidCode: code,
        description,
        requestId: saveRequest(id, "draft", code, description),
        expectedCommit: get().currentProject?.gitCommit,
      });

      pendingSaves.delete(`${id}:draft`);
      // Update the project's ERD code
      await get().loadProject(id);
      set({ isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to update ERD",
        isLoading: false,
      });
      throw error;
    }
  },

  // Save ERD version
  saveErdVersion: async (projectId: string, code: string, description?: string) => {
    set({ isLoading: true, error: null });
    try {
      await erdVersionsApi.create(projectId, {
        mermaidCode: code,
        description,
        requestId: saveRequest(projectId, "version", code, description),
        expectedCommit: get().currentProject?.gitCommit,
      });
      pendingSaves.delete(`${projectId}:version`);
      await get().loadProject(projectId);
      set({ isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to save version",
        isLoading: false,
      });
      throw error;
    }
  },

  // Restore ERD version
  restoreErdVersion: async (projectId: string, versionId: string) => {
    set({ isLoading: true, error: null });
    try {
      await erdVersionsApi.restore(projectId, versionId);
      await get().loadProject(projectId);
      set({ isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to restore version",
        isLoading: false,
      });
      throw error;
    }
  },

  // Add workflow
  addWorkflow: async (projectId: string, workflowData: CreateWorkflowInput) => {
    set({ isLoading: true, error: null });
    try {
      await workflowsApi.create(projectId, workflowData);
      await get().loadProject(projectId);
      set({ isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to add workflow",
        isLoading: false,
      });
      throw error;
    }
  },

  // Update workflow
  updateWorkflow: async (
    projectId: string,
    workflowId: string,
    updates: Partial<WorkflowDefinition>
  ) => {
    set({ isLoading: true, error: null });
    try {
      await workflowsApi.update(projectId, workflowId, updates);
      await get().loadProject(projectId);
      set({ isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to update workflow",
        isLoading: false,
      });
      throw error;
    }
  },

  // Start project
  startProject: async (id: string) => {
    set({ isLoading: true, error: null, currentActionId: null });
    try {
      const project = get().projects.find((p) => p.id === id);
      if (!project) throw new Error("Project not found");

      const result = await deploymentApi.upsert(id, {
        status: "running",
        port: project.port, // Use the project's configured port, no fallback
      });

      // Store the actionId for logs viewer
      if ("actionId" in result) {
        set({ currentActionId: result.actionId as string });
      }

      // Reload the project to get updated deployment status
      const updatedProject = await projectsApi.getById(id);

      // Update both currentProject and the projects array
      set((state) => ({
        projects: state.projects.map((p) => (p.id === id ? updatedProject : p)),
        currentProject: updatedProject,
        isLoading: false,
      }));

      // Open the project URL in a new tab if available
      if (result.url) {
        window.open(result.url, "_blank");
      } else if (updatedProject.deploymentUrl) {
        window.open(updatedProject.deploymentUrl, "_blank");
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to start project",
        isLoading: false,
      });
      throw error;
    }
  },

  // Stop project
  stopProject: async (id: string) => {
    set({ isLoading: true, error: null, currentActionId: null });
    try {
      await deploymentApi.stop(id);

      // Note: actionId could be returned from stop API in future
      // if (result && typeof result === 'object' && "actionId" in result) {
      //   set({ currentActionId: result.actionId as string });
      // }

      // Reload the project to get updated deployment status
      const updatedProject = await projectsApi.getById(id);

      // Update both currentProject and the projects array
      set((state) => ({
        projects: state.projects.map((p) => (p.id === id ? updatedProject : p)),
        currentProject: updatedProject,
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to stop project",
        isLoading: false,
      });
      throw error;
    }
  },
}));
