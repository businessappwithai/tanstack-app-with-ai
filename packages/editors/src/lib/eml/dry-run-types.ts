/**
 * What running a rule against a sample record answers, and how an editor asks.
 *
 * Kept apart from the runner so the editors that show the answer can be the
 * same files in the modelling tool and in a generated application: each hands
 * them a `RuleDryRun` that reaches its own server, and the answer has one shape.
 */

import type { Outcome } from "./rule-outcome";

export interface DryRunTraceStep {
  node: string;
  output: unknown;
}

export type DryRunResult =
  | { ok: true; result: unknown; outcomes: Outcome[]; trace: DryRunTraceStep[] }
  | { ok: false; problems: string[] };

export interface RuleDryRunInput {
  /** The editor's graph, as JSON text or an object. */
  graph: unknown;
  /** The sample record the rule is run against. */
  record: Record<string, unknown>;
  /** The entity the rule is on. */
  entity: string;
}

/** Run a rule without saving anything. Rejects with an Error whose message is shown. */
export type RuleDryRun = (input: RuleDryRunInput) => Promise<DryRunResult>;
