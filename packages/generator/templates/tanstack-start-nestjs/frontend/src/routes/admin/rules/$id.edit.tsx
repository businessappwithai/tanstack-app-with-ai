import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RuleGraphEditor } from "@/components/rules/RuleGraphEditor";
import { ruleEntityLabel, useRuleEntities } from "@/hooks/use-rule-entities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api-client";

export const Route = createFileRoute("/admin/rules/$id/edit")({
  component: EditRulePage,
});


interface Rule {
  id: string;
  entityName: string;
  ruleName: string;
  operation: string;
  version: number;
  isActive: boolean;
  jdmContent: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

const OPERATION_LABELS: Record<string, string> = {
  CREATE: "Creating a record",
  UPDATE: "Changing a record",
  DELETE: "Deleting a record",
  ALL: "Any write",
};

function EditRulePage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [jdmContent, setJdmContent] = useState("");
  // The rule as it was stored; the editor reads it once, on opening.
  const [loaded, setLoaded] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: rule, isLoading } = useQuery({
    queryKey: ["admin", "rules", id],
    queryFn: async () => {
      return await apiClient.get<Rule>(`/rules/${id}`);
    },
  });

  // The rule's entity's own columns, for the table's input pickers.
  const { data: entities = [] } = useRuleEntities();
  const entityFields = entities.find((entity) => entity.value === rule?.entityName)?.fields ?? [];
  const entityLabel = ruleEntityLabel(entities, rule?.entityName);

  useEffect(() => {
    if (rule) {
      let text = rule.jdmContent;
      try {
        text = JSON.stringify(JSON.parse(rule.jdmContent), null, 2);
      } catch {
        // kept as stored
      }
      setJdmContent(text);
      setLoaded(text);
      setIsActive(rule.isActive);
    }
  }, [rule]);

  const updateMutation = useMutation({
    mutationFn: async (data: { jdmContent?: string; isActive?: boolean }) => {
      return await apiClient.put(`/rules/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "rules"] });
      toast.success("Rule updated successfully");
      navigate({ to: "/admin/rules" });
    },
    onError: (error: Error) => {
      toast.error(`Failed to update rule: ${error.message}`);
    },
  });

  const validate = () => {
    const newErrors: Record<string, string> = {};
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
    updateMutation.mutate({ jdmContent, isActive });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-card flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  if (!rule) {
    return (
      <div className="min-h-screen bg-card flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Rule not found</p>
          <Link to="/admin/rules">
            <Button variant="outline" className="rounded-none">
              Back to Rules
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-card">
      <header className="border-b-4 border-foreground bg-card">
        <div className="max-w-6xl mx-auto px-8 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/admin/rules">
                <Button variant="ghost" size="sm" className="rounded-none">
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>
              </Link>
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Edit Rule</h1>
                <p className="text-sm text-muted-foreground mt-1">{rule.ruleName}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="font-mono text-xs">
                v{rule.version}
              </Badge>
              <Badge
                variant={rule.operation === "ALL" ? "default" : "secondary"}
                className="text-xs"
              >
                {rule.operation}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {entityLabel}
              </Badge>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-8 py-8">
        {/* The form holds the rule's details only. The graph editor's own toolbar is made of
            plain buttons, and a button inside a form submits it: pressing the Simulator's
            play control saved the rule. The editor sits outside, and Save names the form. */}
        <form id="rule-form" onSubmit={handleSubmit}>
          {/* Rule metadata display (read-only) */}
          <div className="border-2 border-foreground mb-8">
            <div className="bg-muted/40 px-6 py-3 border-b-2 border-foreground">
              <h2 className="text-sm font-semibold uppercase tracking-wider">Rule Details</h2>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-4 gap-6">
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                    Entity
                  </Label>
                  <p className="mt-1 font-medium">{entityLabel}</p>
                </div>
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                    Runs at
                  </Label>
                  <p className="mt-1 font-medium">{OPERATION_LABELS[rule.operation] ?? rule.operation}</p>
                  <p className="text-[11px] text-muted-foreground">Set by the workflow it is attached to.</p>
                </div>
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                    Version
                  </Label>
                  <p className="mt-1 font-medium">v{rule.version}</p>
                </div>
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                    Status
                  </Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Switch checked={isActive} onCheckedChange={setIsActive} />
                    <span
                      className={`text-sm font-medium ${isActive ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/70"}`}
                    >
                      {isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-6 mt-4 pt-4 border-t border-border">
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                    Created
                  </Label>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {new Date(rule.createdAt).toLocaleString()}
                    {rule.createdBy && <span className="text-muted-foreground/70"> by {rule.createdBy}</span>}
                  </p>
                </div>
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                    Last Updated
                  </Label>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {new Date(rule.updatedAt).toLocaleString()}
                    {rule.updatedBy && <span className="text-muted-foreground/70"> by {rule.updatedBy}</span>}
                  </p>
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
            {loaded && (
              <RuleGraphEditor
                key={rule.id}
                entityName={rule.entityName}
                ruleName={rule.ruleName}
                initialContent={loaded}
                fallbackFields={entityFields.map((field) => field.value)}
                onChange={setJdmContent}
              />
            )}
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
              disabled={updateMutation.isPending}
              className="bg-foreground text-background hover:bg-foreground/90 rounded-none px-8"
            >
              {updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
      </div>
    </div>
  );
}
