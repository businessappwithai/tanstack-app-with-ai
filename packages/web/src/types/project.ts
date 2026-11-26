export interface Project {
  id: string;
  name: string;
  description: string;
  icon: string;
  iconColor: string;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "active" | "archived";
  isDeleted: boolean;
  ownerId?: string;

  // Configuration (Step 1)
  stackType: "tanstackjs-nestjs";
  port: number;
  databaseUrl?: string;

  // ERD Design (Step 2)
  erdCode?: string;
  gitCommit?: string | null;
  erdValidationErrors?: ValidationError[];

  // Generation (Step 3)
  generatedPath?: string;
  deploymentStatus?:
    | "pending"
    | "generating"
    | "completed"
    | "failed"
    | "running"
    | "stopped"
    | "error";

  // Workflow Enhancement (Step 4)
  workflows?: WorkflowDefinition[];

  // Deployment (Step 5)
  deploymentUrl?: string;
  uptime?: string;
}

export interface ValidationError {
  line: number;
  message: string;
  severity: "error" | "warning";
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  serviceName: string;
  mermaidCode: string;
  description?: string;
}

export type ProjectStep = "init" | "design" | "generate" | "enhance" | "deploy";

export const STEP_ORDER: ProjectStep[] = [
  "init",
  "design",
  "generate",
  "enhance",
  "deploy",
];

export const STEP_LABELS: Record<ProjectStep, string> = {
  init: "Init",
  design: "Design",
  generate: "Gen",
  enhance: "Enhance",
  deploy: "Deploy",
};

/** Where each step lives, so the stepper can navigate without a lookup table per page. */
export const STEP_ROUTES: Record<ProjectStep, string> = {
  init: "/projects/$id/init",
  design: "/projects/$id/design",
  generate: "/projects/$id/generate",
  enhance: "/projects/$id/enhance",
  deploy: "/projects/$id/deploy",
};

export interface MermaidFile {
  filename: string;
  type: "erd" | "rules";
  projectId: string;
  projectName: string;
  content: string;
  createdAt: string;
  downloadUrl: string;
}

export const STACK_LABELS: Record<Project["stackType"], string> = {
  "tanstackjs-nestjs": "tanstackjs-nestjs: NestJS + TanStack Start",
};
