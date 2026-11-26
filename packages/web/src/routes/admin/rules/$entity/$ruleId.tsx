import { RuleTableEditor } from "@appwithai/editors/components/automation/RuleTableEditor";
import {
  asDecisionTable,
  wouldReplaceStoredContent,
} from "@appwithai/editors/lib/automation/rule-content";
import type { DecisionTable } from "@appwithai/editors/lib/workflow/bpmn-model";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, CheckIcon, SaveIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requestContext } from "@/lib/request-context";

async function checkAuthMe() {
  const { baseUrl, fetchInit } = await requestContext();
  const res = await fetch(`${baseUrl}/api/auth/me`, fetchInit);
  return res.json() as Promise<{ user: { id: string; email: string; role: string } | null }>;
}

export const Route = createFileRoute("/admin/rules/$entity/$ruleId")({
  beforeLoad: async () => {
    try {
      const data = await checkAuthMe();
      if (!data.user) throw redirect({ to: "/login" });
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
      throw redirect({ to: "/login" });
    }
  },
  component: RuleEditorPage,
});

interface RuleDefinition {
  id: string;
  entityName: string;
  ruleName: string;
  operation: string;
  version: number;
  isActive: boolean;
  jdmContent: unknown;
  createdAt: string;
  updatedAt: string;
}

function RuleEditorPage() {
  const navigate = useNavigate();
  const { ruleId } = Route.useParams();

  const [rule, setRule] = useState<RuleDefinition | null>(null);
  const [table, setTable] = useState<DecisionTable | null>(null);
  // True when the stored rule was not a table, so saving would replace it.
  const [replacesStored, setReplacesStored] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    errors?: string[];
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"edit" | "validate" | "history">("edit");

  useEffect(() => {
    fetchRule();
  }, [ruleId]);

  const fetchRule = async () => {
    try {
      const response = await fetch(`/api/rules/${ruleId}`);
      if (!response.ok) throw new Error("Failed to fetch rule");

      // GET /api/rules/:id answers { rule }, not the rule itself. Reading
      // data.jdmContent gave undefined, so the editor fell back to an empty
      // table — and saving then wrote that empty table over the stored rule.
      const data = await response.json();
      const loaded = data.rule ?? data;
      setRule(loaded);
      setTable(asDecisionTable(loaded.jdmContent));
      setReplacesStored(wouldReplaceStoredContent(loaded.jdmContent));
    } catch (error) {
      toast.error("Failed to load rule");
      console.error(error);
    }
  };

  const handleSave = async () => {
    if (!table) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/rules/${ruleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jdmContent: table,
        }),
      });

      if (!response.ok) throw new Error("Failed to save rule");

      toast.success("Rule saved successfully");
      await fetchRule();
    } catch (error) {
      toast.error("Failed to save rule");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleValidate = async () => {
    if (!table) return;

    try {
      const response = await fetch("/api/rules/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jdm: table }),
      });

      if (!response.ok) throw new Error("Failed to validate rule");

      const result = await response.json();
      setValidationResult(result);
    } catch (error) {
      toast.error("Failed to validate rule");
      console.error(error);
    }
  };

  if (!rule || !table) {
    return (
      <div className="container mx-auto py-8">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-6xl">
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate({ to: "/admin/rules" })} className="mb-4">
          <ArrowLeftIcon className="mr-2 h-4 w-4" />
          Back to Rules
        </Button>
        <h1 className="text-3xl font-bold">Edit Rule: {rule.ruleName}</h1>
        <p className="text-muted-foreground">
          {rule.entityName} • {rule.operation} • Version {rule.version}
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v: string) => setActiveTab(v as "edit" | "validate" | "history")}
      >
        <TabsList>
          <TabsTrigger value="edit">Edit Rule</TabsTrigger>
          <TabsTrigger value="validate">Validate</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="edit">
          <Card>
            <CardHeader>
              <CardTitle>Rule Editor</CardTitle>
              <CardDescription>
                Rows are read top to bottom. The first row where every check fits is the answer.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {replacesStored ? (
                <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  This rule was saved in the older decision-graph format, which this editor cannot
                  show. It is starting from an empty table — saving will replace what was stored.
                </p>
              ) : null}
              <RuleTableEditor name={rule.ruleName} table={table} onChange={setTable} />
              <div className="flex justify-end mt-4">
                <Button onClick={handleSave} disabled={loading}>
                  {loading ? "Saving..." : "Save"}
                  {!loading && <SaveIcon className="ml-2 h-4 w-4" />}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="validate">
          <Card>
            <CardHeader>
              <CardTitle>Validate Rule</CardTitle>
              <CardDescription>Check your rule syntax before saving</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Button onClick={handleValidate} variant="outline">
                  <CheckIcon className="mr-2 h-4 w-4" />
                  Validate Rule
                </Button>
              </div>

              {validationResult && (
                <div
                  className={`p-4 rounded ${
                    validationResult.valid ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {validationResult.valid ? (
                      <CheckIcon className="h-5 w-5 text-green-600" />
                    ) : (
                      <XIcon className="h-5 w-5 text-red-600" />
                    )}
                    <span className="font-medium">
                      {validationResult.valid ? "Rule is valid" : "Rule has errors"}
                    </span>
                  </div>
                  {validationResult.errors && validationResult.errors.length > 0 && (
                    <ul className="list-disc list-inside ml-6">
                      {validationResult.errors.map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Version History</CardTitle>
              <CardDescription>Track changes to this rule over time</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <Badge>Version {rule.version}</Badge>
                    <Badge variant="outline">Current</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Created: {new Date(rule.createdAt).toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Updated: {new Date(rule.updatedAt).toLocaleString()}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
