/**
 * Fifty-odd business rules, driven the way the rule editor drives them:
 * simulate, save, read back, run against real writes, switch off, change,
 * delete. A failure names the rule, the case and what was seen.
 */

import { Session } from "./client";
import { make, unique } from "./records";
import { type Case, RULES, type RuleSpec, withMarker } from "./rules-catalog";

export interface Finding {
  rule: string;
  step: string;
  detail: string;
}

const session = await Session.signIn();
const only = process.argv[2];
const findings: Finding[] = [];
let checks = 0;
const kinds = new Map<string, number>();

const fail = (rule: string, step: string, detail: string) => findings.push({ rule, step, detail });
const ok = () => {
  checks++;
};

/** What a simulation says the record would meet: refusals, changes, or nothing. */
function judge(result: unknown): { blocks: string[]; transforms: Record<string, unknown> } {
  const rows = Array.isArray(result)
    ? result
    : result && typeof result === "object"
      ? [result]
      : [];
  const blocks: string[] = [];
  const transforms: Record<string, unknown> = {};
  for (const row of rows as Array<Record<string, any>>) {
    if (row.action === "validation-error" || row.action === "prevent")
      blocks.push(String(row.message ?? ""));
    if (row.action === "transform") {
      if (row.transformData && typeof row.transformData === "object")
        Object.assign(transforms, row.transformData);
      else if (row.field) transforms[row.field] = row.value;
    }
  }
  return { blocks, transforms };
}

async function exercise(spec: RuleSpec) {
  const marker = unique(spec.id);
  const graph = spec.build(marker);
  const label = `${spec.id} ${spec.title}`;
  kinds.set(spec.kind, (kinds.get(spec.kind) ?? 0) + 1);

  // 1. The Simulator: the answer for each record, before anything is saved.
  for (const c of spec.cases) {
    const record = withMarker(c.record, marker);
    const merged = c.changes ? { ...record, ...withMarker(c.changes, marker) } : record;
    const sim = await session.post("/rules/simulate", {
      jdmContent: graph,
      testData: merged,
      entityName: spec.entity,
    });
    if (!sim.body?.ok) {
      fail(label, `simulate: ${c.label}`, JSON.stringify(sim.body).slice(0, 300));
      continue;
    }
    const seen = judge(sim.body.result);
    const wantBlocks = c.expect === "blocks";
    if (wantBlocks !== seen.blocks.length > 0) {
      fail(
        label,
        `simulate: ${c.label}`,
        `expected ${c.expect}, simulator said ${JSON.stringify(sim.body.result).slice(0, 200)}`
      );
      continue;
    }
    for (const m of c.messages ?? []) {
      if (!seen.blocks.includes(m))
        fail(
          label,
          `simulate: ${c.label}`,
          `message "${m}" missing from ${JSON.stringify(seen.blocks)}`
        );
    }
    if (c.expect === "transforms" && seen.transforms[c.becomes!.field] !== c.becomes!.value) {
      fail(
        label,
        `simulate: ${c.label}`,
        `expected ${c.becomes!.field} → ${c.becomes!.value}, got ${JSON.stringify(seen.transforms)}`
      );
    }
    ok();
  }

  // 2. Save it, as the editor's Save does.
  const ruleName = `${spec.id} ${spec.title} ${marker}`;
  const created = await session.post("/rules", {
    entityName: spec.entity,
    ruleName,
    operation: spec.operation,
    jdmContent: JSON.stringify(graph),
  });
  if (created.status !== 201) {
    fail(label, "create", `${created.status} ${JSON.stringify(created.body).slice(0, 300)}`);
    return;
  }
  ok();
  const id: string = created.body.id;

  // 3. Open it again: what comes back is what was saved.
  const read = await session.get(`/rules/${id}`);
  const stored =
    typeof read.body?.jdmContent === "string"
      ? JSON.parse(read.body.jdmContent)
      : read.body?.jdmContent;
  if (read.status !== 200 || JSON.stringify(stored) !== JSON.stringify(graph)) {
    fail(label, "read back", `status ${read.status}; stored graph differs from the one saved`);
  } else ok();
  const listed = await session.get(`/rules?limit=500`);
  const rows = Array.isArray(listed.body)
    ? listed.body
    : (listed.body?.items ?? listed.body?.rules ?? []);
  if (!rows.some((r: any) => r.id === id))
    fail(label, "list", "the saved rule is not in the rules list");
  else ok();

  // 4. Real writes.
  /** Records made along the way, removed so a case can reuse a marker the application keeps unique. */
  const made: string[] = [];
  const tidy = async () => {
    for (const recordId of made.splice(0)) await session.del(`/bus/${spec.entity}/${recordId}`);
  };
  const write = async (c: Case) => {
    await tidy();
    const record = withMarker(c.record, marker);
    if (spec.operation === "CREATE") {
      const res = await make(session, spec.entity, record);
      if (res.id) made.push(res.id);
      return { status: res.status, body: res.body, id: res.id };
    }
    // UPDATE and DELETE need the record to exist first — made while no rule judges that write.
    const seeded = await make(session, spec.entity, record);
    if (!seeded.id)
      return { status: seeded.status, body: seeded.body, id: undefined, seedFailed: true };
    made.push(seeded.id);
    if (spec.operation === "UPDATE") {
      const res = await session.call(
        "PATCH",
        `/bus/${spec.entity}/${seeded.id}`,
        withMarker(c.changes ?? {}, marker)
      );
      return { status: res.status, body: res.body, id: seeded.id };
    }
    const res = await session.del(`/bus/${spec.entity}/${seeded.id}`);
    if (res.status >= 400) made.push(seeded.id);
    return { status: res.status, body: res.body, id: seeded.id };
  };

  for (const c of spec.cases) {
    const res = await write(c);
    if ((res as any).seedFailed) {
      fail(
        label,
        `write: ${c.label}`,
        `could not make the record to work on: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`
      );
      continue;
    }
    if (c.expect === "blocks") {
      const errors: string[] = res.body?.errors ?? [];
      if (res.status < 400)
        fail(label, `write: ${c.label}`, `expected a refusal, got ${res.status}`);
      else {
        for (const m of c.messages ?? []) {
          if (!errors.includes(m))
            fail(
              label,
              `write: ${c.label}`,
              `refused, but "${m}" is not among ${JSON.stringify(errors).slice(0, 250)}`
            );
        }
        ok();
      }
    } else {
      if (res.status >= 300)
        fail(
          label,
          `write: ${c.label}`,
          `expected success, got ${res.status} ${JSON.stringify(res.body).slice(0, 250)}`
        );
      else if (c.expect === "transforms" && res.id) {
        const back = await session.get(`/bus/${spec.entity}/${res.id}`);
        if (back.body?.[c.becomes!.field] !== c.becomes!.value) {
          fail(
            label,
            `write: ${c.label}`,
            `expected ${c.becomes!.field} = ${c.becomes!.value}, the record holds ${JSON.stringify(back.body?.[c.becomes!.field])}`
          );
        } else ok();
      } else ok();
    }
  }

  /** Whether this very rule refused the write: its message is among the errors, or — with none named — the write failed. */
  const refusedByRule = (res: { status: number; body: any }, c: Case) =>
    c.messages?.length
      ? (res.body?.errors ?? []).some((e: string) => c.messages!.includes(e))
      : res.status >= 400;

  // 5. Switch it off: a refusal stops refusing. Switch it on: it refuses again.
  const blocker = spec.cases.find((c) => c.expect === "blocks");
  if (blocker) {
    const off = await session.put(`/rules/${id}`, { isActive: false });
    if (off.status !== 200)
      fail(label, "deactivate", `${off.status} ${JSON.stringify(off.body).slice(0, 200)}`);
    else {
      const res = await write(blocker);
      if (refusedByRule(res, blocker))
        fail(label, "deactivate", `still refused (${res.status}) while inactive`);
      else ok();
      const on = await session.put(`/rules/${id}`, { isActive: true });
      if (on.status !== 200) fail(label, "reactivate", `${on.status}`);
      else {
        const again = await write(blocker);
        if (!refusedByRule(again, blocker))
          fail(label, "reactivate", "did not refuse after being switched back on");
        else ok();
      }
    }
  }

  await tidy();

  // 6. Edit it: save the graph again with its name changed, as Save does after an edit.
  const edited = JSON.parse(JSON.stringify(graph));
  const first = edited.nodes.find((n: any) => n.type !== "inputNode" && n.type !== "outputNode");
  if (first) first.name = `${first.name} (edited)`;
  const saved = await session.put(`/rules/${id}`, { jdmContent: JSON.stringify(edited) });
  if (saved.status !== 200)
    fail(label, "update", `${saved.status} ${JSON.stringify(saved.body).slice(0, 250)}`);
  else {
    const back = await session.get(`/rules/${id}`);
    const text =
      typeof back.body?.jdmContent === "string"
        ? back.body.jdmContent
        : JSON.stringify(back.body?.jdmContent);
    if (!text.includes("(edited)") || back.body?.version < 2)
      fail(label, "update", "the edit did not come back, or the version did not move");
    else ok();
    if (blocker) {
      const res = await write(blocker);
      if (!refusedByRule(res, blocker)) fail(label, "update", "the edited rule no longer refuses");
      else ok();
    }
  }

  // 7. Delete it. The first delete switches it off; a rule cannot be removed
  // while it is on; a second delete removes it for good.
  const purgeLive = await session.del(`/rules/${id}?permanent=true`);
  if (purgeLive.status !== 400)
    fail(label, "delete", `an active rule was removed (${purgeLive.status})`);
  else ok();
  const gone = await session.del(`/rules/${id}`);
  if (gone.status !== 200)
    fail(label, "delete", `${gone.status} ${JSON.stringify(gone.body).slice(0, 200)}`);
  else {
    const after = await session.get(`/rules/${id}`);
    if (after.status !== 200 || after.body?.isActive !== false)
      fail(
        label,
        "delete",
        `not deactivated after delete (${after.status}, isActive ${after.body?.isActive})`
      );
    else ok();
    if (blocker) {
      const res = await write(blocker);
      if (refusedByRule(res, blocker))
        fail(label, "delete", `still refused (${res.status}) after the rule was deleted`);
      else ok();
    }
    await tidy();
    const purged = await session.del(`/rules/${id}?permanent=true`);
    if (purged.status !== 200)
      fail(
        label,
        "delete permanently",
        `${purged.status} ${JSON.stringify(purged.body).slice(0, 200)}`
      );
    else {
      const finalRead = await session.get(`/rules/${id}`);
      if (finalRead.status !== 404)
        fail(label, "delete permanently", `still readable (${finalRead.status})`);
      else ok();
    }
  }
}

for (const spec of RULES) {
  if (only && !spec.id.startsWith(only)) continue;
  try {
    await exercise(spec);
  } catch (error) {
    fail(
      `${spec.id} ${spec.title}`,
      "harness",
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    );
  }
  process.stdout.write(findings.some((f) => f.rule.startsWith(spec.id)) ? "x" : ".");
}

console.log(
  `\n${RULES.filter((r) => !only || r.id.startsWith(only)).length} rules, ${checks} checks, ${findings.length} findings`
);
console.log("kinds:", Object.fromEntries(kinds));
for (const f of findings) console.log(`- ${f.rule} · ${f.step}: ${f.detail}`);
process.exit(findings.length ? 1 : 0);
