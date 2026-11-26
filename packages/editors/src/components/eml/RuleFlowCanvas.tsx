"use client";

/**
 * The decision-flow canvas.
 *
 * Drag steps around, join them up, label the branches. What you draw is exactly
 * what the model stores — the canvas edits the same node roles and edge labels
 * an EML `%%rule` flowchart carries, so nothing is lost on the way to the
 * generated application.
 */

import {
  applyNodeChanges,
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  Handle,
  MarkerType,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Diamond, Play, Plus, Settings2, Square, Trash2, Zap } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ROLE_HINTS,
  ROLE_LABELS,
  type RuleFlow,
  type RuleFlowNode,
  type RuleNodeRole,
} from "../../lib/eml/rule-flow";

const ROLE_STYLES: Record<RuleNodeRole, { ring: string; chip: string; icon: React.ElementType }> = {
  start: {
    ring: "border-emerald-400 bg-emerald-50",
    chip: "bg-emerald-100 text-emerald-800",
    icon: Play,
  },
  decision: {
    ring: "border-amber-400 bg-amber-50",
    chip: "bg-amber-100 text-amber-800",
    icon: Diamond,
  },
  action: { ring: "border-sky-400 bg-sky-50", chip: "bg-sky-100 text-sky-800", icon: Square },
  compute: {
    ring: "border-violet-400 bg-violet-50",
    chip: "bg-violet-100 text-violet-800",
    icon: Zap,
  },
  end: { ring: "border-slate-400 bg-slate-100", chip: "bg-slate-200 text-slate-800", icon: Square },
};

type StepData = { label: string; role: RuleNodeRole; selected?: boolean };

function StepNode({ data, selected }: NodeProps) {
  const stepData = data as StepData;
  const style = ROLE_STYLES[stepData.role];
  const Icon = style.icon;

  return (
    <div
      className={`min-w-[170px] max-w-[230px] rounded-lg border-2 px-3 py-2 shadow-sm transition ${style.ring} ${
        selected ? "ring-2 ring-offset-1 ring-primary" : ""
      } ${stepData.role === "decision" ? "rounded-2xl" : ""}`}
    >
      {stepData.role !== "start" && <Handle type="target" position={Position.Top} />}
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className={`rounded px-1 py-0.5 text-[10px] font-medium uppercase ${style.chip}`}>
          {ROLE_LABELS[stepData.role]}
        </span>
      </div>
      <p className="mt-1 break-words text-sm font-medium leading-snug text-slate-900">
        {stepData.label || "Untitled step"}
      </p>
      {stepData.role !== "end" && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}

const NODE_TYPES = { step: StepNode };

export interface RuleFlowCanvasProps {
  flow: RuleFlow;
  onChange: (flow: RuleFlow) => void;
  /** Entity attribute names, offered as hints when labelling a condition. */
  fieldHints?: string[];
}

let idCounter = 0;
const nextId = (role: string) => `${role}_${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function RuleFlowCanvas({ flow, onChange, fieldHints = [] }: RuleFlowCanvasProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The canvas owns positions while dragging; committing every pixel to the
  // parent would re-serialise the model on each mouse move.
  const positions = useRef(new Map<string, { x: number; y: number }>());

  useEffect(() => {
    for (const node of flow.nodes) {
      if (node.position && !positions.current.has(node.id)) {
        positions.current.set(node.id, node.position);
      }
    }
  }, [flow.nodes]);

  const nodes: Node[] = useMemo(
    () =>
      flow.nodes.map((node) => ({
        id: node.id,
        type: "step",
        position: positions.current.get(node.id) ?? node.position ?? { x: 80, y: 60 },
        data: { label: node.label, role: node.role } satisfies StepData,
      })),
    [flow.nodes]
  );

  const edges: Edge[] = useMemo(
    () =>
      flow.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        labelStyle: { fontSize: 11, fontWeight: 600 },
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 1.5 },
      })),
    [flow.edges]
  );

  const selectedNode = flow.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedEdge = flow.edges.find((edge) => edge.id === selectedId) ?? null;

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, nodes);
      for (const node of next) positions.current.set(node.id, node.position);
      // Only a finished drag is worth telling the parent about.
      if (changes.some((change) => change.type === "position" && change.dragging === false)) {
        onChange({
          ...flow,
          nodes: flow.nodes.map((node) => ({
            ...node,
            position: positions.current.get(node.id) ?? node.position,
          })),
        });
      }
    },
    [flow, nodes, onChange]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = changes.filter((change) => change.type === "remove").map((c) => c.id);
      if (!removed.length) return;
      onChange({ ...flow, edges: flow.edges.filter((edge) => !removed.includes(edge.id)) });
    },
    [flow, onChange]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      const exists = flow.edges.some(
        (edge) => edge.source === connection.source && edge.target === connection.target
      );
      if (exists) return;

      const source = flow.nodes.find((node) => node.id === connection.source);
      onChange({
        ...flow,
        edges: [
          ...flow.edges,
          {
            id: nextId("edge"),
            source: connection.source,
            target: connection.target,
            // A branch needs a condition; seed it so the requirement is visible.
            label: source?.role === "decision" ? "Yes" : undefined,
          },
        ],
      });
    },
    [flow, onChange]
  );

  const addStep = (role: RuleNodeRole) => {
    const id = nextId(role);
    const row = flow.nodes.length;
    const position = { x: 80 + (row % 3) * 260, y: 60 + Math.floor(row / 3) * 130 };
    positions.current.set(id, position);
    onChange({
      ...flow,
      nodes: [...flow.nodes, { id, role, label: defaultLabel(role), position }],
    });
    setSelectedId(id);
  };

  const updateNode = (id: string, patch: Partial<RuleFlowNode>) => {
    onChange({
      ...flow,
      nodes: flow.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    });
  };

  const deleteSelected = () => {
    if (selectedNode) {
      onChange({
        nodes: flow.nodes.filter((node) => node.id !== selectedNode.id),
        edges: flow.edges.filter(
          (edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id
        ),
      });
    } else if (selectedEdge) {
      onChange({ ...flow, edges: flow.edges.filter((edge) => edge.id !== selectedEdge.id) });
    }
    setSelectedId(null);
  };

  return (
    <div className="flex h-full min-h-[460px] gap-3">
      {/* The palette sits above the canvas rather than floating over it — an
          overlay hides whatever node happens to be drawn in that corner. */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(["start", "decision", "action", "compute", "end"] as RuleNodeRole[]).map((role) => {
            const Icon = ROLE_STYLES[role].icon;
            return (
              <button
                key={role}
                type="button"
                onClick={() => addStep(role)}
                title={ROLE_HINTS[role]}
                className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium shadow-sm hover:bg-muted"
              >
                <Plus className="h-3 w-3" />
                <Icon className="h-3 w-3 opacity-70" />
                {ROLE_LABELS[role]}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-white">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={handleConnect}
              onNodeClick={(_event, node) => setSelectedId(node.id)}
              onEdgeClick={(_event, edge) => setSelectedId(edge.id)}
              onPaneClick={() => setSelectedId(null)}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={16} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </div>

      {/* Inspector */}
      <aside className="w-72 shrink-0 overflow-y-auto rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
          <Settings2 className="h-3.5 w-3.5" />
          {selectedNode ? "Step" : selectedEdge ? "Branch" : "Nothing selected"}
        </div>

        {!selectedNode && !selectedEdge && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Add a step with the buttons above the canvas, then drag from the bottom of one step to
            the top of another to connect them. Click anything to edit it here.
          </p>
        )}

        {selectedNode && (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium">Label</span>
              <input
                className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
                value={selectedNode.label}
                onChange={(event) => updateNode(selectedNode.id, { label: event.target.value })}
                placeholder="What happens here?"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium">Kind</span>
              <select
                className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
                value={selectedNode.role}
                onChange={(event) =>
                  updateNode(selectedNode.id, { role: event.target.value as RuleNodeRole })
                }
              >
                {(Object.keys(ROLE_LABELS) as RuleNodeRole[]).map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                {ROLE_HINTS[selectedNode.role]}
              </span>
            </label>
          </div>
        )}

        {selectedEdge && (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium">Condition</span>
              <input
                className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
                value={selectedEdge.label ?? ""}
                onChange={(event) =>
                  onChange({
                    ...flow,
                    edges: flow.edges.map((edge) =>
                      edge.id === selectedEdge.id ? { ...edge, label: event.target.value } : edge
                    ),
                  })
                }
                placeholder="Yes / amount > 1000"
                list="rule-field-hints"
              />
              <datalist id="rule-field-hints">
                {fieldHints.map((hint) => (
                  <option key={hint} value={hint} />
                ))}
              </datalist>
              <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                Leaving a decision, this is the branch condition.
              </span>
            </label>
          </div>
        )}

        {(selectedNode || selectedEdge) && (
          <button
            type="button"
            onClick={deleteSelected}
            className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-md border border-destructive/40 px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete {selectedNode ? "step" : "branch"}
          </button>
        )}
      </aside>
    </div>
  );
}

function defaultLabel(role: RuleNodeRole): string {
  switch (role) {
    case "start":
      return "Start";
    case "end":
      return "End";
    case "decision":
      return "Condition?";
    case "compute":
      return "Calculate value";
    default:
      return "Apply outcome";
  }
}

/** A blank rule that already has the two ends every decision flow needs. */
export function emptyRuleFlow(): RuleFlow {
  const start = nextId("start");
  const end = nextId("end");
  return {
    nodes: [
      { id: start, role: "start", label: "Start", position: { x: 120, y: 40 } },
      { id: end, role: "end", label: "End", position: { x: 120, y: 300 } },
    ],
    edges: [],
  };
}
