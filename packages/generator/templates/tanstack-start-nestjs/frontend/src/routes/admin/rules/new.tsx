import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RuleGraphEditor } from "@/components/rules/RuleGraphEditor";
import { emptyDecisionTable } from "@/editors/lib/workflow/bpmn-model";
import { useRuleEntities } from "@/hooks/use-rule-entities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api-client";

export const Route = createFileRoute("/admin/rules/new")({
  component: NewRulePage,
});

/**
 * A rule has no "runs when" of its own: it gets its moment from the workflow it
 * is attached to, in Automations. Until then it judges a new record.
 */
const DEFAULT_OPERATION = "CREATE";

/** A new rule starts as the modelling tool's does: a Record, one decision table, a Response. */
const DEFAULT_JDM = JSON.stringify(emptyDecisionTable(), null, 2);

function NewRulePage() {
  const navigate = useNavigate();
  const [entityName, setEntityName] = useState("");
  const [ruleName, setRuleName] = useState("");
  const [jdmContent, setJdmContent] = useState(DEFAULT_JDM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMutation = useMutation({
    mutationFn: async (data: {
      entityName: string;
      ruleName: string;
      operation: string;
      jdmContent: string;
    }) => {
      return await apiClient.post("/rules", data);
    },
    onSuccess: () => {
      toast.success("Rule created successfully");
      navigate({ to: "/admin/rules" });
    },
    onError: (error: Error) => {
      toast.error(`Failed to create rule: ${error.message}`);
    },
  });

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!entityName) newErrors.entityName = "Entity is required";
    if (!ruleName.trim()) newErrors.ruleName = "Rule name is required";
    try {
      JSON.parse(jdmContent);
    } catch {
      newErrors.jdmContent = "Invalid JDM content";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    createMutation.mutate({ entityName, ruleName, operation: DEFAULT_OPERATION, jdmContent });
  };

  // This application's own record types, from its dictionary.
  const { data: entities = [], isLoading: entitiesLoading } = useRuleEntities();
  const chosen = entities.find((entity) => entity.value === entityName);
  const entityFields = chosen?.fields ?? [];

  return (
    <div className="min-h-screen bg-card">
      <header className="border-b-4 border-foreground bg-card">
        <div className="max-w-6xl mx-auto px-8 py-8">
          <div className="flex items-center gap-4">
            <Link to="/admin/rules">
              <Button variant="ghost" size="sm" className="rounded-none">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">Create Business Rule</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Define conditions and actions that run automatically when entity records are
                created, updated, or deleted.
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-8 py-8">
        {/* The form holds the rule's details only. The graph editor's own toolbar is made of
            plain buttons, and a button inside a form submits it: pressing the Simulator's
            play control saved the rule. The editor sits outside, and Save names the form. */}
        <form id="rule-form" onSubmit={handleSubmit}>
          {/* Rule metadata section */}
          <div className="border-2 border-foreground mb-8">
            <div className="bg-muted/40 px-6 py-3 border-b-2 border-foreground">
              <h2 className="text-sm font-semibold uppercase tracking-wider">Rule Configuration</h2>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Entity *
                  </Label>
                  <Select value={entityName} onValueChange={setEntityName}>
                    <SelectTrigger className="mt-1 border-2 border-border rounded-none">
                      <SelectValue placeholder="Select entity..." />
                    </SelectTrigger>
                    <SelectContent>
                      {entitiesLoading ? (
                        <SelectItem value="__loading" disabled>
                          Loading…
                        </SelectItem>
                      ) : null}
                      {entities.map((e) => (
                        <SelectItem key={e.value} value={e.value}>
                          {e.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.entityName && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.entityName}</p>
                  )}
                </div>

                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Rule Name *
                  </Label>
                  <Input
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    placeholder="e.g. Validate Email Format"
                    className="mt-1 border-2 border-border rounded-none"
                  />
                  {errors.ruleName && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.ruleName}</p>
                  )}
                </div>

              </div>
            </div>
          </div>

        </form>

          {/* The rule: the modelling tool's own graph editor */}
          <div className="border-2 border-foreground mb-8">
            <div className="bg-muted/40 px-6 py-3 border-b-2 border-foreground">
              <h2 className="text-sm font-semibold uppercase tracking-wider">Decision Logic</h2>
            </div>
            {/* Keyed by the record type: the editor offers only that type's fields. */}
            <RuleGraphEditor
              key={entityName}
              entityName={entityName}
              ruleName={ruleName || "New rule"}
              initialContent={DEFAULT_JDM}
              fallbackFields={entityFields.map((field) => field.value)}
              onChange={setJdmContent}
            />
            {errors.jdmContent && (
              <p className="text-xs text-red-600 dark:text-red-400 px-4 pb-2">{errors.jdmContent}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <Link to="/admin/rules">
              <Button
                type="button"
                variant="outline"
                className="rounded-none border-2 border-foreground"
              >
                Cancel
              </Button>
            </Link>
            <Button
              type="submit"
              form="rule-form"
              disabled={createMutation.isPending}
              className="bg-foreground text-background hover:bg-foreground/90 rounded-none px-8"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {createMutation.isPending ? "Creating..." : "Create Rule"}
            </Button>
          </div>
      </div>
    </div>
  );
}
