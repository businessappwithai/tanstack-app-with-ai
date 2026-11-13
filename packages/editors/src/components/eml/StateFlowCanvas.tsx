"use client";

/**
 * The state-machine canvas.
 *
 * States become the entity's status enum and transitions become the moves the
 * generated application allows, so this edits the two things that matter and
 * nothing else. Start and finish are marked on the state itself rather than
 * drawn as separate nodes — `[*]` is a marker in Mermaid, not a state, and
 * showing it as a box invites people to connect things to it that cannot be.
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
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Flag, Play, Plus, Settings2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StateFlow } from "../../lib/eml/workflow-flow";

type StateData = { name: string; isInitial: boolean; isTerminal: boolean; workflows?: string[] };

function StateNode({ data, selected }: NodeProps) {
  const stateData = data as StateData;
  return (
    <div
      className={`min-w-[140px] rounded-full border-2 px-4 py-2 text-center shadow-sm transition ${
        stateData.isInitial
          ? "border-emerald-400 bg-emerald-50"
          : stateData.isTerminal
            ? "border-slate-400 bg-slate-100"
            : "border-sky-400 bg-sky-50"
      } ${selected ? "ring-2 ring-offset-1 ring-primary" : ""}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 14, height: 14, background: "#94a3b8", border: "2px solid white", cursor: "crosshair" }}
      />
      <div className="flex items-center justify-center gap-1.5">
        {stateData.isInitial && <Play className="h-3 w-3 text-emerald-700" />}
        {stateData.isTerminal && <Flag className="h-3 w-3 text-slate-700" />}
        <span className="font-mono text-sm font-medium">{stateData.name}</span>
      </div>
      {stateData.workflows && stateData.workflows.length > 0 && (
        <div className="mt-1 flex flex-wrap justify-center gap-1">
          {stateData.workflows.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-0.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700"
              title={`Workflow runs when entering this state: ${name}`}
            >
              <Settings2 className="h-2.5 w-2.5" />
              {name}
            </span>
          ))}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 14, height: 14, background: "#64748b", border: "2px solid white", cursor: "crosshair" }}
      />
    </div>
  );
}

const NODE_TYPES = { state: StateNode };

export interface StateFlowCanvasProps {
  flow: StateFlow;
  onChange: (flow: StateFlow) => void;
  /** Workflows bound to each state (keyed by state name), shown as badges on the node. */
  boundWorkflows?: Record<string, string[]>;
}

let counter = 0;
const nextId = () => `s${Date.now().toString(36)}${(counter++).toString(36)}`;

export function StateFlowCanvas({ flow, onChange, boundWorkflows }: StateFlowCanvasProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());

  const nodes: Node[] = useMemo(
    () =>
      flow.states.map((state, index) => ({
        id: state.id,
        type: "state",
        position: positions.current.get(state.id) ??
          state.position ?? { x: 80 + index * 200, y: 80 },
        data: {
          name: state.name,
          isInitial: flow.initial === state.id,
          isTerminal: flow.terminal.includes(state.id),
          workflows: boundWorkflows?.[state.name],
        } satisfies StateData,
      })),
    [flow, boundWorkflows]
  );

  const edges: Edge[] = useMemo(
    () =>
      flow.transitions.map((transition) => ({
        id: transition.id,
        source: transition.from,
        target: transition.to,
        label: transition.label,
        labelStyle: { fontSize: 11, fontWeight: 600 },
        // An opaque plate, so a line crossing a label does not strike through it.
        labelShowBg: true,
        labelBgStyle: { fill: "hsl(var(--card))" },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 1.5 },
      })),
    [flow.transitions]
  );

  const selectedState = flow.states.find((state) => state.id === selectedId) ?? null;
  const selectedTransition = flow.transitions.find((t) => t.id === selectedId) ?? null;

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, nodes);
      for (const node of next) positions.current.set(node.id, node.position);
      if (changes.some((change) => change.type === "position" && change.dragging === false)) {
        onChange({
          ...flow,
          states: flow.states.map((state) => ({
            ...state,
            position: positions.current.get(state.id) ?? state.position,
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
      onChange({
        ...flow,
        transitions: flow.transitions.filter((t) => !removed.includes(t.id)),
      });
    },
    [flow, onChange]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const exists = flow.transitions.some(
        (t) => t.from === connection.source && t.to === connection.target
      );
      if (exists) return;
      onChange({
        ...flow,
        transitions: [
          ...flow.transitions,
          { id: nextId(), from: connection.source, to: connection.target },
        ],
      });
    },
    [flow, onChange]
  );

  const addState = () => {
    const id = nextId();
    const name = `state_${flow.states.length + 1}`;
    // Wrapped into rows rather than marching right forever: past the third
    // state a single row runs outside the canvas, and the node is added but
    // never seen.
    const position = {
      x: 80 + (flow.states.length % 3) * 200,
      y: 80 + Math.floor(flow.states.length / 3) * 130,
    };
    positions.current.set(id, position);
    onChange({
      ...flow,
      states: [...flow.states, { id, name, position }],
      initial: flow.initial ?? id,
    });
    setSelectedId(id);
  };

  const renameState = (id: string, name: string) => {
    onChange({
      ...flow,
      states: flow.states.map((state) => (state.id === id ? { ...state, name } : state)),
    });
  };

  const deleteSelected = () => {
    if (selectedState) {
      onChange({
        states: flow.states.filter((state) => state.id !== selectedState.id),
        transitions: flow.transitions.filter(
          (t) => t.from !== selectedState.id && t.to !== selectedState.id
        ),
        initial: flow.initial === selectedState.id ? undefined : flow.initial,
        terminal: flow.terminal.filter((id) => id !== selectedState.id),
      });
    } else if (selectedTransition) {
      onChange({
        ...flow,
        transitions: flow.transitions.filter((t) => t.id !== selectedTransition.id),
      });
    }
    setSelectedId(null);
  };

  return (
    <div className="flex h-full min-h-[420px] gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <button
            type="button"
            onClick={addState}
            className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium shadow-sm hover:bg-muted"
          >
            <Plus className="h-3 w-3" />
            Add state
          </button>
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
              <FitOnGrowth count={flow.states.length} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </div>

      <aside className="w-72 shrink-0 overflow-y-auto rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
          <Settings2 className="h-3.5 w-3.5" />
          {selectedState ? "State" : selectedTransition ? "Transition" : "Nothing selected"}
        </div>

        {!selectedState && !selectedTransition && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Add the statuses this record moves through, then drag from the right of one to the left
            of another to allow that move. Each state becomes a value of the entity's status.
          </p>
        )}

        {selectedState && (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium">Status value</span>
              <input
                className="w-full rounded-md border border-border px-2 py-1.5 font-mono text-sm"
                value={selectedState.name}
                onChange={(event) => renameState(selectedState.id, event.target.value)}
                placeholder="submitted"
              />
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={flow.initial === selectedState.id}
                onChange={() => onChange({ ...flow, initial: selectedState.id })}
              />
              Records start here
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={flow.terminal.includes(selectedState.id)}
                onChange={(event) =>
                  onChange({
                    ...flow,
                    terminal: event.target.checked
                      ? [...flow.terminal, selectedState.id]
                      : flow.terminal.filter((id) => id !== selectedState.id),
                  })
                }
              />
              The process finishes here
            </label>
          </div>
        )}

        {selectedTransition && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium">Trigger (optional)</span>
            <input
              className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
              value={selectedTransition.label ?? ""}
              onChange={(event) =>
                onChange({
                  ...flow,
                  transitions: flow.transitions.map((t) =>
                    t.id === selectedTransition.id ? { ...t, label: event.target.value } : t
                  ),
                })
              }
              placeholder="submit"
            />
            <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
              Names the action that moves a record along this arrow — the button's label.
            </span>
            <span className="mb-1 mt-3 block text-xs font-medium">Who may press it</span>
            <input
              className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
              aria-label="Roles that may press this move"
              value={(selectedTransition.roles ?? []).join(", ")}
              onChange={(event) =>
                onChange({
                  ...flow,
                  transitions: flow.transitions.map((t) =>
                    t.id === selectedTransition.id
                      ? {
                          ...t,
                          // Kept as typed (an empty entry lets a comma stay
                          // while the next role is written); emptied on save.
                          roles: event.target.value.split(/[,|]/).map((role) => role.trimStart()),
                        }
                      : t
                  ),
                })
              }
              placeholder="sales_manager"
            />
            <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
              Roles, separated by commas. Empty: anyone who may edit the record.
            </span>
          </label>
        )}

        {(selectedState || selectedTransition) && (
          <button
            type="button"
            onClick={deleteSelected}
            className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-md border border-destructive/40 px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete {selectedState ? "state" : "transition"}
          </button>
        )}
      </aside>
    </div>
  );
}

/**
 * Bring a newly added state into view.
 *
 * `fitView` as a prop only runs on the first render, so a state added later
 * stayed wherever it was placed while the viewport never moved — the node
 * existed, was selected, and was serialised, but the canvas showed nothing new
 * and the button read as broken. This has to sit inside the provider, which is
 * the only place the instance exists.
 */
function FitOnGrowth({ count }: { count: number }) {
  const instance = useReactFlow();
  const previous = useRef(count);

  useEffect(() => {
    if (count > previous.current) {
      previous.current = count;
      // The node is measured on the next frame; fitting before that uses a
      // zero-size node and lands the viewport in the wrong place.
      const frame = requestAnimationFrame(() => instance.fitView({ padding: 0.2, duration: 200 }));
      return () => cancelAnimationFrame(frame);
    }
    previous.current = count;
    return undefined;
  }, [count, instance]);

  return null;
}

/** A blank state machine with the draft state most processes start from. */
export function emptyStateFlow(): StateFlow {
  const id = nextId();
  return {
    states: [{ id, name: "draft", position: { x: 80, y: 80 } }],
    transitions: [],
    initial: id,
    terminal: [],
  };
}
