/**
 * Lifecycle handlers for Ticket — written the way an author writes them.
 *
 * The generator emits these as stubs and never overwrites them, so the runner
 * (`run.ts`, `installHandlers`) copies this file over the stub after generating
 * `rule-kinds.eml.mmd`. They are what lets spec 08 observe the order of a write:
 * hook, then rules, then process.
 *
 *   stampReference  beforeCreate  A subject starting "[hook-bump]" raises
 *                   impact_score to 95. Nothing else in the model does, so a
 *                   ticket that ends up urgent from a low score got there
 *                   because this ran *before* the rules read the record.
 *   notifyCustomer  afterCreate   Records that it ran, after the insert.
 *
 * Each appends one line to $HOOK_TRACE_FILE, which the spec reads back.
 */

import { appendFileSync } from "node:fs";

const trace = (line: string) => {
  const file = process.env.HOOK_TRACE_FILE;
  if (file) appendFileSync(file, `${line}\n`);
};

export async function stampReference(data: Record<string, any>): Promise<Record<string, any>> {
  trace(`beforeCreate:stampReference:${String(data.subject ?? "")}`);
  if (typeof data.subject === "string" && data.subject.startsWith("[hook-bump]")) {
    return { ...data, impact_score: 95 };
  }
  return data;
}

export async function notifyCustomer(record: Record<string, any>): Promise<void> {
  trace(`afterCreate:notifyCustomer:${String(record.subject ?? "")}`);
}

export async function logStatusChange(_record: Record<string, any>): Promise<void> {
  trace("afterUpdate:logStatusChange");
}
