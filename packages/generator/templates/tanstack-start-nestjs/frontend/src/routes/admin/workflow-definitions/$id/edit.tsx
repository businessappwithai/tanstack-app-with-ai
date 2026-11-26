/**
 * Workflow Definition Detail — Jira-style automation viewer with interleaved rules
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  ChevronRight,
  Zap,
  ArrowDown,
  Play,
  CheckCircle2,
  Code2,
  PlusCircle,
  RefreshCcw,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  Trash2,
  GitBranch,
  Shield,
  Plus,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/api-client';

export const Route = createFileRoute('/admin/workflow-definitions/$id/edit')({
  component: WorkflowDefinitionDetail,
});

interface WfDef {
  id: string;
  name: string;
  entity_name: string;
  operation: string;
  bpmn_xml: string;
  description?: string;
  trigger_type?: string;
  source?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface BpmnStep {
  id: string;
  name: string;
  nodeType: string;
  props: Record<string, string>;
}

interface LinkedRule {
  id: string;
  ruleName: string;
  entityName: string;
  operation: string;
  isActive: boolean;
  jdmContent?: string;
}

/** Strip bus_ prefix, snake_case → Title Case */
function fmt(name: string): string {
  return name
    .replace(/^bus_/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Count rows in a JDM decision table stored as a JSON string */
function countRuleRows(jdmContent?: string): number {
  if (!jdmContent) return 0;
  try {
    const parsed = JSON.parse(jdmContent);
    if (Array.isArray(parsed?.rules)) return parsed.rules.length;
    if (Array.isArray(parsed?.nodes)) {
      const tableNode = parsed.nodes.find((n: any) => n.type === 'decisionTableNode');
      if (Array.isArray(tableNode?.content?.rules)) return tableNode.content.rules.length;
    }
    return 0;
  } catch {
    return 0;
  }
}

/** Parse BPMN XML string → ordered steps using sequenceFlow to sort */
function parseBpmn(xml: string): BpmnStep[] {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');

    const flows: Record<string, string> = {};
    doc.querySelectorAll('sequenceFlow').forEach((f) => {
      const src = f.getAttribute('sourceRef') ?? '';
      const tgt = f.getAttribute('targetRef') ?? '';
      flows[src] = tgt;
    });

    const startEl = doc.querySelector('startEvent');
    const startId = startEl?.getAttribute('id') ?? 'start';

    const steps: BpmnStep[] = [];
    let cur = flows[startId];
    const visited = new Set<string>();
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      const taskEl = doc.getElementById(cur) ?? doc.querySelector(`[id="${cur}"]`);
      if (!taskEl) break;
      const tag = taskEl.tagName.toLowerCase().replace(/^bpmn:/, '');
      if (tag.includes('endevent')) break;

      const props: Record<string, string> = {};
      taskEl.querySelectorAll('[name]').forEach((p) => {
        const n = p.getAttribute('name');
        const v = p.getAttribute('value');
        if (n && v !== null) props[n] = v;
      });

      steps.push({
        id: cur,
        name: taskEl.getAttribute('name') ?? cur,
        nodeType: props['nodeType'] ?? 'Unknown',
        props,
      });

      cur = flows[cur] ?? '';
    }
    return steps;
  } catch {
    return [];
  }
}

const NODE_META: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string; border: string }> = {
  UpdateEntity: {
    icon: <RefreshCcw className="h-5 w-5" />,
    label: 'Update Record',
    color: 'text-blue-700 dark:text-blue-300',
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    border: 'border-blue-200/60 dark:border-blue-800',
  },
  CreateEntity: {
    icon: <PlusCircle className="h-5 w-5" />,
    label: 'Create Record',
    color: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    border: 'border-emerald-200/60 dark:border-emerald-800',
  },
  Formula: {
    icon: <Code2 className="h-5 w-5" />,
    label: 'Run Formula',
    color: 'text-purple-700 dark:text-purple-300',
    bg: 'bg-purple-50 dark:bg-purple-950/40',
    border: 'border-purple-200/60 dark:border-purple-800',
  },
  Unknown: {
    icon: <AlertCircle className="h-5 w-5" />,
    label: 'Step',
    color: 'text-muted-foreground',
    bg: 'bg-muted/40',
    border: 'border-border',
  },
};

/** Connector between items. Shows a "+Rule" insertion button on hover. */
function StepConnector({ onAddRule }: { onAddRule?: () => void }) {
  return (
    <div className="group flex justify-center py-1 relative">
      <div className="flex flex-col items-center gap-0.5">
        <div className="w-px h-3 bg-border" />
        <ArrowDown className="h-4 w-4 text-muted-foreground/70" />
        <div className="w-px h-3 bg-border" />
      </div>
      {onAddRule && (
        <button
          onClick={onAddRule}
          className="absolute top-1/2 -translate-y-1/2 left-1/2 ml-6 opacity-0 group-hover:opacity-100 transition-opacity
                     flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/40
                     border border-amber-200/60 dark:border-amber-800 rounded-full px-2 py-0.5 font-medium"
          title="Insert rule check here"
        >
          <Plus className="h-3 w-3" />
          Add rule
        </button>
      )}
    </div>
  );
}

/** Rule gate card — amber, links to the rule editor */
function RuleGateCard({ rule }: { rule: LinkedRule }) {
  const rowCount = countRuleRows(rule.jdmContent);
  // "Fee Invoice validation" now; "bus_fee_invoice_validation" in older databases.
  const isValidation = /[_ ]validation$/i.test(rule.ruleName);

  return (
    <Link to="/admin/rules/$id/edit" params={{ id: rule.id }}>
      <div className="border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 rounded-lg p-4 hover:bg-amber-100 dark:hover:bg-amber-900/40 hover:border-amber-400 transition-colors cursor-pointer group">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center border-2 border-amber-300 dark:border-amber-800 bg-card text-amber-700 dark:text-amber-300">
            <Shield className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-semibold text-sm">
              <span>{isValidation ? 'Validation check' : 'Rule gate'}</span>
              <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800">
                {rule.operation}
              </Badge>
              {!rule.isActive && (
                <Badge className="text-[10px] px-1.5 py-0 bg-muted text-muted-foreground border-border">
                  Inactive
                </Badge>
              )}
            </div>
            <div className="text-foreground font-medium mt-0.5 flex items-center gap-1.5">
              {rule.ruleName}
              <ExternalLink className="h-3 w-3 text-muted-foreground/70 group-hover:text-amber-600 transition-colors" />
            </div>
            {rowCount > 0 && (
              <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                {rowCount} {rowCount === 1 ? 'condition' : 'conditions'} · click to edit
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function StepCard({ step, index }: { step: BpmnStep; index: number }) {
  const meta = NODE_META[step.nodeType] ?? NODE_META['Unknown']!;

  const renderDetail = () => {
    if (step.nodeType === 'UpdateEntity') {
      return (
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {step.props['targetEntity'] && (
            <div>
              <span className="text-xs uppercase tracking-widest text-muted-foreground/70 block mb-0.5">Target entity</span>
              <span className="font-medium text-foreground">{fmt(step.props['targetEntity'])}</span>
            </div>
          )}
          {step.props['updateField'] && (
            <div>
              <span className="text-xs uppercase tracking-widest text-muted-foreground/70 block mb-0.5">Field</span>
              <code className="font-mono text-foreground">{step.props['updateField']}</code>
            </div>
          )}
          {step.props['updateValue'] !== undefined && (
            <div>
              <span className="text-xs uppercase tracking-widest text-muted-foreground/70 block mb-0.5">Set value to</span>
              <span className="font-semibold text-blue-700 dark:text-blue-300">"{step.props['updateValue']}"</span>
            </div>
          )}
          {step.props['targetId'] && (
            <div>
              <span className="text-xs uppercase tracking-widest text-muted-foreground/70 block mb-0.5">Record ID</span>
              <code className="text-xs text-muted-foreground font-mono">{step.props['targetId']}</code>
            </div>
          )}
        </div>
      );
    }
    if (step.nodeType === 'CreateEntity') {
      let createData: Record<string, unknown> = {};
      try { createData = JSON.parse(step.props['createData'] ?? '{}'); } catch { /* ignore */ }
      return (
        <div className="mt-3 text-sm">
          {step.props['targetEntity'] && (
            <div className="mb-2">
              <span className="text-xs uppercase tracking-widest text-muted-foreground/70 block mb-0.5">Create in</span>
              <span className="font-medium text-foreground">{fmt(step.props['targetEntity'])}</span>
            </div>
          )}
          {Object.keys(createData).length > 0 && (
            <div>
              <span className="text-xs uppercase tracking-widest text-muted-foreground/70 block mb-1">With fields</span>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                {Object.entries(createData).map(([k, v]) => (
                  <div key={k}>
                    <code className="text-xs text-muted-foreground">{k}</code>
                    <span className="text-xs text-muted-foreground/70"> = </span>
                    <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">"{String(v)}"</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }
    if (step.nodeType === 'Formula') {
      return (
        <div className="mt-3 text-sm">
          {step.props['expression'] && (
            <div className="mb-2">
              <span className="text-xs uppercase tracking-widest text-muted-foreground/70 block mb-1">Expression</span>
              <code className="block bg-card border border-purple-200/60 dark:border-purple-800 px-3 py-2 rounded text-xs font-mono text-purple-800 dark:text-purple-300">
                {step.props['expression']}
              </code>
            </div>
          )}
          {step.props['outputVar'] && (
            <div>
              <span className="text-xs uppercase tracking-widest text-muted-foreground/70 block mb-0.5">Output variable</span>
              <code className="text-xs text-purple-700 dark:text-purple-300 font-mono">{step.props['outputVar']}</code>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`border-2 ${meta.border} ${meta.bg} rounded-lg p-4`}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center border-2 ${meta.border} bg-card ${meta.color}`}>
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`flex items-center gap-2 ${meta.color} font-semibold text-sm`}>
            {meta.icon}
            <span>{meta.label}</span>
          </div>
          <div className="text-foreground font-medium mt-0.5">{step.name}</div>
          {renderDetail()}
        </div>
      </div>
    </div>
  );
}

function WorkflowDefinitionDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: wf, isLoading, error } = useQuery<WfDef>({
    queryKey: ['workflow-definition', id],
    queryFn: () => apiClient.get<WfDef>(`/workflow-definitions/${id}`),
  });

  const { data: runsData } = useQuery<any>({
    queryKey: ['workflow-runs', id],
    queryFn: () =>
      apiClient
        .get<any>(`/api/workflows/runs?limit=5`)
        .then((r: any) =>
          (Array.isArray(r) ? r : r?.items ?? []).filter(
            (run: any) => run.workflow_name === wf?.name
          )
        ),
    enabled: !!wf,
  });

  const { data: linkedRules = [] } = useQuery<LinkedRule[]>({
    queryKey: ['linked-rules', wf?.entity_name, wf?.operation],
    queryFn: async () => {
      const data = await apiClient.get<any>(`/rules?entityName=${wf!.entity_name}`);
      const all: any[] = Array.isArray(data) ? data : data?.items ?? data?.data ?? [];
      return all.filter(
        (r: any) => r.operation === wf!.operation || r.operation === 'ALL'
      ) as LinkedRule[];
    },
    enabled: !!wf,
  });

  const toggleMutation = useMutation({
    mutationFn: () =>
      apiClient.patch(`/workflow-definitions/${id}`, { is_active: !wf?.is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-definition', id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete(`/workflow-definitions/${id}`),
    onSuccess: () => navigate({ to: '/admin/workflow-definitions' }),
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center text-muted-foreground/70 animate-pulse">
        Loading automation…
      </div>
    );
  }

  if (error || !wf) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center">
        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
        <p className="text-muted-foreground">Workflow not found.</p>
        <Link to="/admin/workflow-definitions" className="text-teal-600 dark:text-teal-400 underline text-sm mt-2 inline-block">
          ← Back to Workflows
        </Link>
      </div>
    );
  }

  const steps = parseBpmn(wf.bpmn_xml);
  const recentRuns: any[] = runsData ?? [];

  const opColor =
    wf.operation === 'CREATE'
      ? 'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-300 border-teal-300 dark:border-teal-800'
      : wf.operation === 'UPDATE'
      ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800'
      : 'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-800';

  const handleAddRule = () => {
    navigate({ to: '/admin/rules/new' });
  };

  return (
    <div className="min-h-screen bg-muted/40">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-5xl mx-auto px-8 pt-5 pb-4">
          <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-3">
            <Link to="/dashboard" className="hover:underline">Dashboard</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link to="/admin/workflow-definitions" className="hover:underline">Workflows</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-foreground font-medium truncate max-w-xs">{wf.name}</span>
          </nav>

          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <GitBranch className="h-5 w-5 text-muted-foreground shrink-0" />
                <h1 className="text-2xl font-bold text-foreground truncate">{wf.name}</h1>
                {wf.is_active ? (
                  <Badge className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-300 dark:border-green-800 shrink-0">Active</Badge>
                ) : (
                  <Badge className="bg-muted text-muted-foreground shrink-0">Inactive</Badge>
                )}
                {wf.source === 'model' && (
                  <Badge variant="outline" className="border-indigo-200/60 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs shrink-0">From model</Badge>
                )}
              </div>
              {wf.description && (
                <p className="text-muted-foreground text-sm ml-8">{wf.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleMutation.mutate()}
                disabled={toggleMutation.isPending || wf.source === 'model'}
                className="gap-1.5"
              >
                {wf.is_active
                  ? <><ToggleRight className="h-4 w-4 text-green-600 dark:text-green-400" /> Disable</>
                  : <><ToggleLeft className="h-4 w-4 text-muted-foreground/70" /> Enable</>
                }
              </Button>
              {wf.source !== 'model' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 gap-1.5"
                  onClick={() => { if (confirm(`Delete "${wf.name}"?`)) deleteMutation.mutate(); }}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-8 grid grid-cols-3 gap-8">
        {/* Left: automation flow */}
        <div className="col-span-2 space-y-0">

          {/* TRIGGER */}
          <div className="border-2 border-foreground bg-foreground text-background rounded-lg p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground/70 mb-2">
              <Zap className="h-3.5 w-3.5 text-yellow-400" />
              Trigger
            </div>
            <div className="flex items-center gap-3">
              <Play className="h-5 w-5 text-yellow-400 shrink-0" />
              <div>
                <div className="font-semibold text-background text-base">
                  When a <span className="text-yellow-300">{fmt(wf.entity_name)}</span> record is{' '}
                  <span className={`inline px-1.5 py-0.5 rounded text-xs font-bold ${opColor}`}>
                    {wf.operation}D
                  </span>
                </div>
                <div className="text-xs text-muted-foreground/70 mt-0.5">
                  Runs {wf.trigger_type === 'rule' ? 'when triggered by a rule' : 'automatically on every matching write'}
                </div>
              </div>
            </div>
          </div>

          {/* RULE GATES — shown before the first step */}
          <StepConnector onAddRule={handleAddRule} />

          {linkedRules.length > 0 && (
            <div className="border border-amber-200/60 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/40 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-3">
                <Shield className="h-3.5 w-3.5" />
                Rule gates · {fmt(wf.entity_name)} {wf.operation}
                <Link
                  to="/admin/rules"
                  className="ml-auto text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 hover:underline normal-case tracking-normal font-normal"
                >
                  View all rules →
                </Link>
              </div>
              <div className="space-y-2">
                {linkedRules.map((rule) => (
                  <RuleGateCard key={rule.id} rule={rule} />
                ))}
              </div>
              <button
                onClick={handleAddRule}
                className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300
                           border border-dashed border-amber-300 dark:border-amber-800 hover:border-amber-400 rounded-lg py-2 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add another rule
              </button>
            </div>
          )}

          {linkedRules.length === 0 && (
            <button
              onClick={handleAddRule}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300
                         border border-dashed border-amber-300 dark:border-amber-800 hover:border-amber-400 rounded-lg py-3 transition-colors bg-amber-50/40 dark:bg-amber-950/40"
            >
              <Plus className="h-3.5 w-3.5" />
              Add a rule gate before these steps
            </button>
          )}

          {/* STEPS with +Rule insertion between each */}
          {steps.map((step, i) => (
            <div key={step.id}>
              <StepConnector onAddRule={handleAddRule} />
              <StepCard step={step} index={i} />
            </div>
          ))}

          {steps.length === 0 && (
            <div className="mt-4 text-center py-8 border-2 border-dashed border-border rounded-lg text-muted-foreground/70 text-sm">
              No steps parsed from BPMN.
            </div>
          )}

          {/* END */}
          <StepConnector />
          <div className="border-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg p-3 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="text-emerald-800 dark:text-emerald-300 font-semibold text-sm">Automation complete</span>
          </div>
        </div>

        {/* Right: metadata + linked rules + recent runs */}
        <div className="space-y-6">
          {/* Metadata */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">Details</h3>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground/70 mb-0.5">Entity</dt>
                <dd className="font-medium text-foreground">{fmt(wf.entity_name)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground/70 mb-0.5">Trigger operation</dt>
                <dd>
                  <span className={`inline px-2 py-0.5 text-xs font-semibold border rounded ${opColor}`}>
                    {wf.operation}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground/70 mb-0.5">Run mode</dt>
                <dd className="text-foreground/80">
                  {wf.trigger_type === 'rule' ? 'Rule-gated' : 'Automatic'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground/70 mb-0.5">Steps</dt>
                <dd className="font-medium text-foreground">{steps.length}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground/70 mb-0.5">Rule gates</dt>
                <dd className="font-medium text-amber-700 dark:text-amber-300">{linkedRules.length}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground/70 mb-0.5">Created</dt>
                <dd className="text-foreground/80">{new Date(wf.created_at).toLocaleDateString()}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground/70 mb-0.5">Last updated</dt>
                <dd className="text-foreground/80">{new Date(wf.updated_at).toLocaleDateString()}</dd>
              </div>
            </dl>
          </div>

          {/* Quick navigation: linked rules */}
          {linkedRules.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-amber-500" />
                Linked Rules
              </h3>
              <div className="space-y-1.5">
                {linkedRules.map((rule) => (
                  <Link
                    key={rule.id}
                    to="/admin/rules/$id/edit"
                    params={{ id: rule.id }}
                    className="flex items-center justify-between text-xs p-2 rounded hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors group"
                  >
                    <span className="text-foreground/80 group-hover:text-amber-800 font-medium truncate max-w-[130px]">
                      {rule.ruleName}
                    </span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground/70 group-hover:text-amber-500 ml-1 shrink-0" />
                  </Link>
                ))}
              </div>
              <button
                onClick={handleAddRule}
                className="mt-2 w-full flex items-center justify-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300
                           border border-dashed border-amber-200/60 dark:border-amber-800 hover:border-amber-400 rounded py-1.5 transition-colors"
              >
                <Plus className="h-3 w-3" />
                New rule
              </button>
            </div>
          )}

          {/* Recent runs */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Recent Runs</h3>
            {recentRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground/70">No runs recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {recentRuns.slice(0, 5).map((run: any) => (
                  <div key={run.id} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      {run.status === 'success'
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        : <AlertCircle className="h-3.5 w-3.5 text-red-400" />}
                      <span className="font-mono text-muted-foreground">{run.entity_id?.slice(0, 8)}…</span>
                    </div>
                    <span className="text-muted-foreground/70">{new Date(run.created_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
            <Link
              to="/admin/workflows"
              className="text-teal-600 dark:text-teal-400 hover:underline text-xs mt-3 inline-block"
            >
              View all runs →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
