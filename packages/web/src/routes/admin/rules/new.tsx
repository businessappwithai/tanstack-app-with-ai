import { RuleTableEditor } from "@appwithai/editors/components/automation/RuleTableEditor";
import { type DecisionTable, emptyDecisionTable } from "@appwithai/editors/lib/workflow/bpmn-model";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, SaveIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requestContext } from "@/lib/request-context";

async function checkAuthMe() {
  const { baseUrl, fetchInit } = await requestContext();
  const res = await fetch(`${baseUrl}/api/auth/me`, fetchInit);
  return res.json() as Promise<{ user: { id: string; email: string; role: string } | null }>;
}

export const Route = createFileRoute("/admin/rules/new")({
  beforeLoad: async () => {
    try {
      const data = await checkAuthMe();
      if (!data.user) throw redirect({ to: "/login" });
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
      throw redirect({ to: "/login" });
    }
  },
  component: NewRulePage,
});

function NewRulePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    entityName: "",
    ruleName: "",
    operation: "CREATE" as "CREATE" | "READ" | "UPDATE" | "DELETE" | "ALL",
  });

  const [table, setTable] = useState<DecisionTable>(emptyDecisionTable());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityName: formData.entityName,
          ruleName: formData.ruleName,
          operation: formData.operation,
          jdmContent: table,
        }),
      });

      if (!response.ok) throw new Error("Failed to create rule");

      toast.success("Rule created successfully");
      navigate({ to: "/admin/rules" });
    } catch (error) {
      toast.error("Failed to create rule");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate({ to: "/admin/rules" })} className="mb-4">
          <ArrowLeftIcon className="mr-2 h-4 w-4" />
          Back to Rules
        </Button>
        <h1 className="text-3xl font-bold">Create New Rule</h1>
        <p className="text-muted-foreground">
          Rows are read top to bottom. The first row where every check fits is the answer.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Rule Information</CardTitle>
            <CardDescription>Basic information about this business rule</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="entityName">Entity *</Label>
              <Select
                value={formData.entityName}
                onValueChange={(value) => setFormData({ ...formData, entityName: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select entity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Patient">Patient</SelectItem>
                  <SelectItem value="Appointment">Appointment</SelectItem>
                  <SelectItem value="Prescription">Prescription</SelectItem>
                  <SelectItem value="Invoice">Invoice</SelectItem>
                  <SelectItem value="Ward">Ward</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="ruleName">Rule Name *</Label>
              <Input
                id="ruleName"
                value={formData.ruleName}
                onChange={(e) => setFormData({ ...formData, ruleName: e.target.value })}
                placeholder="e.g., Age Stratification"
                required
              />
            </div>

            <div>
              <Label htmlFor="operation">Operation *</Label>
              <Select
                value={formData.operation}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    operation: value as "CREATE" | "READ" | "UPDATE" | "DELETE" | "ALL",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CREATE">CREATE</SelectItem>
                  <SelectItem value="READ">READ</SelectItem>
                  <SelectItem value="UPDATE">UPDATE</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                  <SelectItem value="ALL">ALL</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>The rules</CardTitle>
            <CardDescription>
              Give the table its inputs and outcomes, then add a row per decision. End with a
              catch-all so it always returns an answer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RuleTableEditor
              name={formData.ruleName || "New rule"}
              table={table}
              onChange={setTable}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => navigate({ to: "/admin/rules" })}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Creating..." : "Create Rule"}
            {!loading && <SaveIcon className="ml-2 h-4 w-4" />}
          </Button>
        </div>
      </form>
    </div>
  );
}
