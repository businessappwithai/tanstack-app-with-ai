/**
 * Records for the generated CRM, made the way a person would: say what matters
 * and let the application's own validation say what else is needed. A required
 * column that is a reference is filled by making the parent record.
 */

import { readFileSync } from "node:fs";
import type { Session } from "./client";

/** The model's own enums, read from the file the generator wrote for the rule editor. */
const GEN_DIR = process.env.GEN_DIR ?? "/var/tmp/gen2";
export const MODEL: Array<{
  table: string;
  fields: Array<{ name: string; type: string }>;
  values: Record<string, string[]>;
}> = (() => {
  const text = readFileSync(`${GEN_DIR}/frontend/src/lib/rule-model.ts`, "utf8");
  return JSON.parse(text.slice(text.indexOf("= [") + 2, text.lastIndexOf("];") + 1));
})();

export interface Ids {
  [table: string]: string | undefined;
}

const pool: Ids = {};
let ownerId: string | undefined;
let serial = Date.now() % 100000;

const ENUMS: Record<string, string[]> = Object.fromEntries(
  MODEL.flatMap((e) => Object.entries(e.values).map(([c, v]) => [`${e.table}.${c}`, v]))
);

export async function owner(s: Session): Promise<string> {
  if (!ownerId) {
    const users = await s.get("/bus/bus_user?limit=1");
    ownerId = users.body?.data?.[0]?.id;
  }
  return ownerId as string;
}

/** Defaults for one required column, from what the application said about it. */
async function fill(s: Session, column: string, table: string, fresh = false): Promise<unknown> {
  const declared = MODEL.find((e) => e.table === table)?.fields.find(
    (f) => f.name === column
  )?.type;
  if (declared === "boolean") return false;
  if (declared === "number") return 1;
  if (column === "owner_id" || column.endsWith("_by_id")) return owner(s);
  if (column.endsWith("_id")) {
    const parent = `bus_${column.replace(/_id$/, "")}`;
    const alias: Record<string, string> = {
      bus_escalated_by: "bus_user",
      bus_approved_by: "bus_user",
      bus_signed_by: "bus_user",
      bus_manager: "bus_user",
    };
    const target = alias[parent] ?? parent;
    if (target === "bus_user") return owner(s);
    return (fresh ? (await make(s, target, {})).id : await fixture(s, target)) ?? null;
  }
  if (/(_at|_date|date)$/.test(column)) return new Date().toISOString().slice(0, 10);
  if (/email/.test(column)) return `qa${++serial}@example.com`;
  if (
    /(count|amount|total|price|cost|quantity|months|days|hours|minutes|score|percent|revenue|version)/.test(
      column
    )
  )
    return 1;
  void table;
  return `QA ${column} ${++serial}`;
}

/** Make a record, filling every column the application reports as required. */
export async function make(
  s: Session,
  table: string,
  values: Record<string, unknown> = {}
): Promise<{ status: number; body: any; id?: string }> {
  const payload: Record<string, unknown> = { ...values };
  const filled: string[] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await s.post(`/bus/${table}`, payload);
    // A shared parent can be taken: one contract per quote, say. Give the
    // columns this call filled for itself a parent of their own and try again.
    if (res.status === 409 && filled.length > 0) {
      for (const column of filled) payload[column] = await fill(s, column, table, true);
      filled.length = 0;
      continue;
    }
    if (res.status === 201 || res.status === 200) {
      return { status: res.status, body: res.body, id: res.body?.id ?? res.body?.data?.id };
    }
    const errors: string[] = res.body?.errors ?? [];
    const missing = errors
      .map((e) => /\((\w+)\) is required/.exec(e)?.[1])
      .filter((c): c is string => !!c && payload[c] === undefined);
    if (missing.length === 0) return { status: res.status, body: res.body };
    for (const column of missing) {
      payload[column] = ENUMS[`${table}.${column}`]?.[0] ?? (await fill(s, column, table));
      filled.push(column);
    }
  }
  return { status: 0, body: "gave up filling required columns" };
}

/** One shared parent record per table. */
export async function fixture(s: Session, table: string): Promise<string | undefined> {
  if (pool[table]) return pool[table];
  const made = await make(s, table, {});
  pool[table] = made.id;
  return made.id;
}

export function setEnum(table: string, column: string, values: string[]) {
  ENUMS[`${table}.${column}`] = values;
}

export const unique = (label: string) => `${label}-${++serial}`;
