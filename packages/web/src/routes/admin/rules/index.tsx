import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2Icon,
  CircleIcon,
  EditIcon,
  PlusIcon,
  RefreshCwIcon,
  TrashIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { requestContext } from "@/lib/request-context";

interface RuleDefinition {
  id: string;
  entityName: string;
  ruleName: string;
  operation: string;
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RuleCondition {
  id: string;
  sequence: number;
  entityAttribute: string;
  operator: string;
  value: string;
  isActive: boolean;
}

async function checkAuthMe() {
  const { baseUrl, fetchInit } = await requestContext();
  const res = await fetch(`${baseUrl}/api/auth/me`, fetchInit);
  return res.json() as Promise<{ user: { id: string; email: string; role: string } | null }>;
}

export const Route = createFileRoute("/admin/rules/")({
  beforeLoad: async () => {
    try {
      const data = await checkAuthMe();
      if (!data.user) throw redirect({ to: "/login" });
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
      throw redirect({ to: "/login" });
    }
  },
  component: RulesListPage,
});

function RulesListPage() {
  const navigate = useNavigate();
  const [rules, setRules] = useState<RuleDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<{
    entity?: string;
    operation?: string;
  }>({});
  const [selectedRule, setSelectedRule] = useState<RuleDefinition | null>(null);
  const [conditions, setConditions] = useState<RuleCondition[]>([]);
  const [activeTab, setActiveTab] = useState<"properties" | "conditions">("properties");

  const fetchRules = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter.entity) params.append("entity", filter.entity);
      if (filter.operation) params.append("operation", filter.operation);

      const response = await fetch(`/api/rules?${params}`);
      if (!response.ok) throw new Error("Failed to fetch rules");

      const data = await response.json();
      setRules(data.rules || []);
    } catch (error) {
      console.error("Failed to load rules:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchRuleConditions = async (ruleId: string) => {
    try {
      const response = await fetch(`/api/rules/${ruleId}/conditions`);
      if (!response.ok) throw new Error("Failed to fetch conditions");
      const data = await response.json();
      setConditions(data.conditions || []);
    } catch (error) {
      console.error("Failed to load conditions:", error);
      setConditions([]);
    }
  };

  useEffect(() => {
    fetchRules();
  }, [filter]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "r") {
        e.preventDefault();
        fetchRules();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSelectRule = (rule: RuleDefinition) => {
    setSelectedRule(rule);
    setActiveTab("properties");
    fetchRuleConditions(rule.id);
  };

  const deleteRule = async (ruleId: string) => {
    if (!confirm("Are you sure you want to delete this rule?")) return;

    try {
      const response = await fetch(`/api/rules/${ruleId}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete rule");
      setSelectedRule(null);
      fetchRules();
    } catch (error) {
      console.error("Failed to delete rule:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
          <div className="px-6 py-8">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-50">
                  Business Rules
                </h1>
                <p className="text-slate-600 dark:text-slate-400 mt-2">
                  Manage JDM (JSON Decision Model) rules for entity automation
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate({ to: "/admin/rules/new" })}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#FF8400] text-slate-900 rounded-lg hover:bg-[#E67300] transition-all duration-200 font-medium shadow-md hover:shadow-lg"
              >
                <PlusIcon className="h-5 w-5" />
                New Rule
              </button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="p-6 flex gap-6">
          {/* Left: Rules List */}
          <div className="w-96 flex-shrink-0">
            {/* Filter Bar */}
            <div className="bg-white dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 p-4 mb-4 shadow-sm">
              <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-50 uppercase tracking-wide mb-3">
                Filters
              </h2>
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="index-entity-2"
                    className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5 block"
                  >
                    Entity
                  </label>
                  <select
                    id="index-entity-2"
                    className="w-full px-2.5 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-50 focus:outline-none focus:ring-2 focus:ring-[#FF8400] focus:ring-offset-1 dark:focus:ring-offset-slate-950 transition-all"
                    value={filter.entity || ""}
                    onChange={(e) => setFilter({ ...filter, entity: e.target.value || undefined })}
                  >
                    <option value="">All Entities</option>
                    <option value="Patient">Patient</option>
                    <option value="Appointment">Appointment</option>
                    <option value="Prescription">Prescription</option>
                    <option value="Invoice">Invoice</option>
                    <option value="Ward">Ward</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="index-operation-2"
                    className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5 block"
                  >
                    Operation
                  </label>
                  <select
                    id="index-operation-2"
                    className="w-full px-2.5 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-50 focus:outline-none focus:ring-2 focus:ring-[#FF8400] focus:ring-offset-1 dark:focus:ring-offset-slate-950 transition-all"
                    value={filter.operation || ""}
                    onChange={(e) =>
                      setFilter({ ...filter, operation: e.target.value || undefined })
                    }
                  >
                    <option value="">All Operations</option>
                    <option value="CREATE">CREATE</option>
                    <option value="READ">READ</option>
                    <option value="UPDATE">UPDATE</option>
                    <option value="DELETE">DELETE</option>
                    <option value="ALL">ALL</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={fetchRules}
                  className="w-full flex items-center justify-center gap-2 px-2.5 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-[#FF8400] transition-all duration-200 text-sm font-medium"
                  title="Refresh (Ctrl+R)"
                >
                  <RefreshCwIcon className="h-4 w-4" />
                  Refresh
                </button>
              </div>
            </div>

            {/* Rules List */}
            {loading ? (
              <div className="bg-white dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 p-8 text-center shadow-sm">
                <div className="animate-spin inline-block h-6 w-6 border-3 border-[#FF8400] border-t-transparent rounded-full mb-3"></div>
                <p className="text-xs text-slate-600 dark:text-slate-400">Loading rules...</p>
              </div>
            ) : rules.length === 0 ? (
              <div className="bg-white dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 p-6 text-center shadow-sm">
                <div className="text-3xl mb-2">📋</div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50 mb-1">
                  No Rules Yet
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
                  Create your first rule to get started.
                </p>
                <button
                  type="button"
                  onClick={() => navigate({ to: "/admin/rules/new" })}
                  className="w-full px-3 py-2 bg-[#FF8400] text-slate-900 text-xs font-medium rounded-lg hover:bg-[#E67300] transition-all duration-200"
                >
                  Create Rule
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-[calc(100vh-300px)] overflow-y-auto">
                {rules.map((rule) => (
                  <button
                    type="button"
                    key={rule.id}
                    onClick={() => handleSelectRule(rule)}
                    className={`w-full text-left p-4 rounded-lg border transition-all duration-200 cursor-pointer ${
                      selectedRule?.id === rule.id
                        ? "border-[#FF8400] bg-orange-50 dark:bg-slate-900/50 shadow-md"
                        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">
                          {rule.ruleName}
                        </h4>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                          {rule.entityName}
                        </p>
                      </div>
                      <div
                        className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${
                          rule.isActive
                            ? "bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        {rule.isActive ? (
                          <CheckCircle2Icon className="h-3 w-3" />
                        ) : (
                          <CircleIcon className="h-3 w-3" />
                        )}
                        {rule.isActive ? "Active" : "Inactive"}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: Rule Details Window (AD-Style Tabbed) */}
          {selectedRule ? (
            <div className="flex-1">
              <div className="bg-white dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 shadow-lg overflow-hidden flex flex-col h-[calc(100vh-200px)]">
                {/* Window Header + Toolbar */}
                <div className="border-b border-slate-200 dark:border-slate-800 p-4 bg-gradient-to-r from-slate-50 to-transparent dark:from-slate-900 dark:to-transparent">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
                        {selectedRule.ruleName}
                      </h2>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {selectedRule.entityName} • {selectedRule.operation}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          navigate({
                            to: "/admin/rules/$entity/$ruleId",
                            params: { entity: selectedRule.entityName, ruleId: selectedRule.id },
                          });
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-[#FF8400] hover:border-[#FF8400] transition-all duration-200 font-medium"
                      >
                        <EditIcon className="h-4 w-4" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRule(selectedRule.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-red-300 dark:border-red-900 rounded-lg text-red-700 dark:text-red-300 text-sm hover:bg-red-50 dark:hover:bg-red-950/30 transition-all duration-200 font-medium"
                      >
                        <TrashIcon className="h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Tab Navigation (AD-Style) */}
                  <div className="flex gap-1 border-t border-slate-200 dark:border-slate-800 pt-3 mt-3">
                    <button
                      type="button"
                      onClick={() => setActiveTab("properties")}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-all duration-200 ${
                        activeTab === "properties"
                          ? "border-[#FF8400] text-[#FF8400]"
                          : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-50"
                      }`}
                    >
                      Properties
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("conditions")}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-all duration-200 ${
                        activeTab === "conditions"
                          ? "border-[#FF8400] text-[#FF8400]"
                          : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-50"
                      }`}
                    >
                      Conditions ({conditions.length})
                    </button>
                  </div>
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-y-auto p-6">
                  {activeTab === "properties" ? (
                    <div className="space-y-4 max-w-2xl">
                      <div>
                        <label
                          htmlFor="index-rule-name"
                          className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-2"
                        >
                          Rule Name
                        </label>
                        <input
                          id="index-rule-name"
                          type="text"
                          defaultValue={selectedRule.ruleName}
                          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 focus:outline-none focus:ring-2 focus:ring-[#FF8400] transition-all"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label
                            htmlFor="index-entity"
                            className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-2"
                          >
                            Entity
                          </label>
                          <input
                            id="index-entity"
                            type="text"
                            defaultValue={selectedRule.entityName}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50 focus:outline-none focus:ring-2 focus:ring-[#FF8400] transition-all"
                            readOnly
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="index-operation"
                            className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-2"
                          >
                            Operation
                          </label>
                          <input
                            id="index-operation"
                            type="text"
                            defaultValue={selectedRule.operation}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50 focus:outline-none focus:ring-2 focus:ring-[#FF8400] transition-all"
                            readOnly
                          />
                        </div>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-2">
                          Status
                        </span>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              checked={selectedRule.isActive}
                              className="w-4 h-4"
                            />
                            <span className="text-sm text-slate-700 dark:text-slate-300">
                              Active
                            </span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              checked={!selectedRule.isActive}
                              className="w-4 h-4"
                            />
                            <span className="text-sm text-slate-700 dark:text-slate-300">
                              Inactive
                            </span>
                          </label>
                        </div>
                      </div>
                      <div>
                        <label
                          htmlFor="index-version"
                          className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-2"
                        >
                          Version
                        </label>
                        <input
                          id="index-version"
                          type="text"
                          defaultValue={selectedRule.version}
                          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50 focus:outline-none focus:ring-2 focus:ring-[#FF8400] transition-all"
                          readOnly
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="index-last-updated"
                          className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-2"
                        >
                          Last Updated
                        </label>
                        <input
                          id="index-last-updated"
                          type="text"
                          defaultValue={new Date(selectedRule.updatedAt).toLocaleString()}
                          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50 focus:outline-none focus:ring-2 focus:ring-[#FF8400] transition-all"
                          readOnly
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50 mb-4">
                        Rule Conditions
                      </h3>
                      {conditions.length === 0 ? (
                        <div className="text-center py-8 text-slate-600 dark:text-slate-400">
                          <p className="text-sm">No conditions defined yet.</p>
                        </div>
                      ) : (
                        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                              <tr>
                                <th className="text-left px-4 py-2 font-semibold text-slate-700 dark:text-slate-300">
                                  #
                                </th>
                                <th className="text-left px-4 py-2 font-semibold text-slate-700 dark:text-slate-300">
                                  Attribute
                                </th>
                                <th className="text-left px-4 py-2 font-semibold text-slate-700 dark:text-slate-300">
                                  Operator
                                </th>
                                <th className="text-left px-4 py-2 font-semibold text-slate-700 dark:text-slate-300">
                                  Value
                                </th>
                                <th className="text-left px-4 py-2 font-semibold text-slate-700 dark:text-slate-300">
                                  Status
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {conditions.map((cond) => (
                                <tr
                                  key={cond.id}
                                  className="border-t border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                                >
                                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                    {cond.sequence}
                                  </td>
                                  <td className="px-4 py-3 text-slate-900 dark:text-slate-50 font-mono text-xs">
                                    {cond.entityAttribute}
                                  </td>
                                  <td className="px-4 py-3 text-slate-900 dark:text-slate-50">
                                    {cond.operator}
                                  </td>
                                  <td className="px-4 py-3 text-slate-900 dark:text-slate-50">
                                    {cond.value}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span
                                      className={`text-xs font-medium px-2 py-1 rounded ${
                                        cond.isActive
                                          ? "bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300"
                                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                                      }`}
                                    >
                                      {cond.isActive ? "Active" : "Inactive"}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-slate-600 dark:text-slate-400">
                <p className="text-lg font-medium">Select a rule to view details</p>
                <p className="text-sm mt-1">Choose a rule from the list on the left</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
