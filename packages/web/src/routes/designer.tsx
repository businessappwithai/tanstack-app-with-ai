import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Database,
  Download,
  Play,
  Save,
  Sparkles,
  Upload,
} from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";

export const Route = createFileRoute("/designer")({
  component: DesignerPage,
});

const SAMPLE_ERD = `erDiagram
    User {
        int id PK
        string email UK
        string name
        timestamp created_at
    }
    
    Post {
        int id PK
        int user_id FK
        string title
        text content
        timestamp created_at
    }
    
    User ||--o{ Post : "creates"
`;

interface ValidationError {
  line: number;
  message: string;
  type: "error" | "warning";
}

function DesignerPage() {
  const [erdCode, setErdCode] = useState(SAMPLE_ERD);
  const [activeTab, setActiveTab] = useState<"editor" | "preview" | "generate">("editor");
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [isValidating, setIsValidating] = useState(false);

  const validateERD = useCallback(() => {
    setIsValidating(true);
    const errors: ValidationError[] = [];

    const lines = erdCode.split("\n");

    if (!erdCode.includes("erDiagram")) {
      errors.push({
        line: 1,
        message: "Missing erDiagram declaration",
        type: "error",
      });
    }

    const entityPattern = /^\s*(\w+)\s*\{/;
    const entities: string[] = [];

    lines.forEach((line, index) => {
      const match = line.match(entityPattern);
      if (match?.[1]) {
        entities.push(match[1]);
      }

      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;
      if (openBraces > closeBraces) {
        const remainingLines = lines.slice(index + 1);
        const hasClosing = remainingLines.some((l) => l.includes("}"));
        if (!hasClosing) {
          errors.push({
            line: index + 1,
            message: "Unclosed entity definition",
            type: "error",
          });
        }
      }
    });

    if (entities.length === 0) {
      errors.push({
        line: 1,
        message: "No entities defined",
        type: "warning",
      });
    }

    const relationshipPattern = /\|\|--|o\{|}\|--|\{o/;
    const hasRelationships = lines.some((line) => relationshipPattern.test(line));

    if (entities.length > 1 && !hasRelationships) {
      errors.push({
        line: 1,
        message: "Multiple entities but no relationships defined",
        type: "warning",
      });
    }

    setValidationErrors(errors);
    setIsValidating(false);

    if (errors.length === 0) {
      alert("✅ ERD is valid!");
    }
  }, [erdCode]);

  const handleSave = useCallback(() => {
    localStorage.setItem("appwithai-design", erdCode);
    alert("Design saved locally!");
  }, [erdCode]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([erdCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "schema.erd";
    a.click();
    URL.revokeObjectURL(url);
  }, [erdCode]);

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setErdCode(content);
    };
    reader.readAsText(file);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b bg-card px-4">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Link>
          <div className="h-4 w-px bg-border" />
          <h1 className="text-lg font-semibold">
            <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
              ERD Designer
            </span>
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              alert(
                "AI Assistant coming soon! CopilotKit integration requires ESM package configuration."
              )
            }
            className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors bg-secondary hover:bg-secondary/80 opacity-50 cursor-not-allowed"
            title="AI Assistant - Coming Soon"
          >
            <Sparkles className="h-4 w-4" />
            AI Assistant
          </button>

          <button
            type="button"
            onClick={validateERD}
            disabled={isValidating}
            className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm hover:bg-secondary/80 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            Validate ERD
          </button>

          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm hover:bg-secondary/80"
          >
            <Save className="h-4 w-4" />
            Save
          </button>

          <label className="flex cursor-pointer items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm hover:bg-secondary/80">
            <Upload className="h-4 w-4" />
            Import
            <input type="file" accept=".erd,.mmd,.txt" onChange={handleUpload} className="hidden" />
          </label>

          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm hover:bg-secondary/80"
          >
            <Download className="h-4 w-4" />
            Export
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("generate")}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
          >
            <Play className="h-4 w-4" />
            Generate Code
          </button>
        </div>
      </header>

      <div className="flex border-b bg-card">
        {[
          { id: "editor" as const, label: "ERD Editor", icon: Database },
          { id: "preview" as const, label: "Preview", icon: Play },
          { id: "generate" as const, label: "Code Generation", icon: Download },
        ].map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm transition-colors ${
              activeTab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <main className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {activeTab === "editor" && (
            <div className="flex h-full flex-col">
              {validationErrors.length > 0 && (
                <div className="border-b bg-muted/30 p-2">
                  <div className="space-y-1">
                    {validationErrors.map((error, index) => (
                      <div
                        key={index}
                        className={`flex items-start gap-2 rounded px-2 py-1 text-sm ${
                          error.type === "error"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-yellow-500/10 text-yellow-600 dark:text-yellow-500"
                        }`}
                      >
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <span>
                          Line {error.line}: {error.message}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex-1 p-4">
                <div className="h-full rounded-lg border bg-card">
                  <div className="border-b bg-muted/30 px-4 py-2">
                    <h3 className="text-sm font-medium">Mermaid ERD Syntax</h3>
                  </div>
                  <textarea
                    value={erdCode}
                    onChange={(e) => {
                      setErdCode(e.target.value);
                      setValidationErrors([]);
                    }}
                    className="h-[calc(100%-3rem)] w-full resize-none bg-transparent p-4 font-mono text-sm focus:outline-none"
                    placeholder="Enter your ERD code here..."
                    spellCheck={false}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === "preview" && (
            <div className="flex h-full items-center justify-center p-4">
              <div className="rounded-lg border bg-card p-8 text-center">
                <Database className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-semibold">ERD Preview</h3>
                <p className="text-sm text-muted-foreground">
                  Visual diagram preview will be rendered here
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  (Mermaid rendering coming soon)
                </p>
              </div>
            </div>
          )}

          {activeTab === "generate" && (
            <div className="h-full overflow-auto p-4">
              <div className="space-y-4">
                <div className="rounded-lg border bg-card">
                  <div className="border-b bg-muted/30 px-4 py-2">
                    <h3 className="text-sm font-medium">Kysely Migration</h3>
                  </div>
                  <pre className="overflow-auto p-4 text-sm">
                    <code className="text-muted-foreground">
                      {`// Code generation will be implemented here
// Based on your ERD schema above

export async function up(db) {
  // Create tables
}

export async function down(db) {
  // Drop tables
}`}
                    </code>
                  </pre>
                </div>

                <div className="rounded-lg border bg-card">
                  <div className="border-b bg-muted/30 px-4 py-2">
                    <h3 className="text-sm font-medium">SQL DDL</h3>
                  </div>
                  <pre className="overflow-auto p-4 text-sm">
                    <code className="text-muted-foreground">
                      {`-- SQL DDL generation will be implemented here
-- Based on your ERD schema above

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  name VARCHAR(255),
  created_at TIMESTAMP
);`}
                    </code>
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="flex h-8 items-center justify-between border-t bg-card px-4 text-xs text-muted-foreground">
        <span>APPWITHAI v0.01 - Visual Designer</span>
        <div className="flex items-center gap-4">
          <span>{erdCode.split("\n").length} lines</span>
          {validationErrors.length > 0 && (
            <span
              className={
                validationErrors.some((e) => e.type === "error")
                  ? "text-destructive"
                  : "text-yellow-600"
              }
            >
              {validationErrors.filter((e) => e.type === "error").length} errors,{" "}
              {validationErrors.filter((e) => e.type === "warning").length} warnings
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}
