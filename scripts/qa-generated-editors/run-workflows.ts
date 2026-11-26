/**
 * Sixty workflows, driven the way the builder drives them: serialise what was
 * built, save a draft, publish, set it off with real writes, read what it did,
 * switch it off, edit it, delete it.
 */

import { parseAutomation, serializeAutomation } from "@/lib/automation/model";
import { Session } from "./client";
import { make, owner, unique } from "./records";
import { withMarker } from "./rules-catalog";
import {
  type Act,
  type Expectation,
  setOwner,
  TABLE_OF,
  WORKFLOWS,
  type WorkflowSpec,
} from "./workflows-catalog";

interface Finding {
  workflow: string;
  step: string;
  detail: string;
}

const s = await Session.signIn();
setOwner(await owner(s));
const only = process.argv[2];
const findings: Finding[] = [];
let checks = 0;
const groups = new Map<string, number>();

const fail = (workflow: string, step: string, detail: string) =>
  findings.push({ workflow, step, detail });
const ok = () => {
  checks++;
};

/** The write a stored automation runs on — the same arithmetic the Automations screen applies. */
function operationOf(a: any): "CREATE" | "UPDATE" | "DELETE" | "ALL" {
  if (a.kind === "saga") return a.sagaOperation ?? "CREATE";
  const hooks: Record<string, string> = {
    created: "afterCreate",
    beforeCreated: "beforeCreate",
    updated: "afterUpdate",
    beforeUpdated: "beforeUpdate",
    deleted: "afterDelete",
    beforeDeleted: "beforeDelete",
  };
  const events: string[] =
    a.kind === "hook"
      ? a.hooks.map((h: any) => h.event)
      : [hooks[a.trigger.event] ?? "afterCreate"];
  const op = (e: string) =>
    /create/i.test(e)
      ? "CREATE"
      : /update/i.test(e)
        ? "UPDATE"
        : /delete/i.test(e)
          ? "DELETE"
          : "ALL";
  const set = new Set(events.map(op));
  return set.size === 1 ? ([...set][0] as any) : events.length === 0 ? "CREATE" : "ALL";
}
const triggerType = (a: any) =>
  a.kind === "saga" && a.sagaTrigger === "rule" ? "rule" : "automatic";

async function exercise(spec: WorkflowSpec) {
  const marker = unique(spec.id);
  const label = `${spec.id} ${spec.title}`;
  groups.set(spec.group, (groups.get(spec.group) ?? 0) + 1);
  const table = TABLE_OF[spec.entity] as string;
  const cleanup = spec.setup
    ? await spec.setup({ post: (p, b) => s.post(p, b), del: (p) => s.del(p), marker })
    : async () => {};

  const a: any = spec.build(marker);
  const mermaid = serializeAutomation(a);

  // 1. What the builder would read back from what it wrote.
  const reread = parseAutomation(mermaid, spec.entity);
  const sameSteps =
    JSON.stringify(reread.steps.map((x) => x.type)) ===
    JSON.stringify(a.steps.map((x: any) => x.type));
  if (!sameSteps)
    fail(
      label,
      "round trip",
      `steps came back as ${reread.steps.map((x) => x.type).join(",")}, wrote ${a.steps.map((x: any) => x.type).join(",")}`
    );
  else if (reread.conditions.length !== a.conditions.length)
    fail(label, "round trip", "conditions were lost");
  else ok();

  // 2. Save a draft, as "+ New workflow" does, then publish.
  const body = {
    kind: "automation",
    name: a.name,
    entityName: spec.entity,
    operation: operationOf(a),
    triggerType: triggerType(a),
    mermaid,
  };
  const created = await s.post("/workflow-definitions", { ...body, isActive: false });
  if (created.status !== 201) {
    fail(label, "create", `${created.status} ${JSON.stringify(created.body).slice(0, 250)}`);
    await cleanup();
    return;
  }
  ok();
  const id: string = created.body.id;
  const read = await s.get(`/workflow-definitions/${id}`);
  if (read.status !== 200 || read.body?.mermaid_code !== mermaid)
    fail(
      label,
      "read back",
      `status ${read.status}; the stored flowchart differs from the one saved`
    );
  else ok();
  if (a.steps.length > 0 && !read.body?.bpmn_xml)
    fail(label, "compile", "saved with steps but nothing was compiled for the executor to run");
  else if (a.steps.length === 0 && read.body?.bpmn_xml)
    fail(label, "compile", "no steps, yet BPMN was written");
  else ok();
  const listed = await s.get(`/workflow-definitions?kind=automation&limit=200`);
  if (!(listed.body?.items ?? []).some((x: any) => x.id === id))
    fail(label, "list", "the draft is not in the Automations list");
  else ok();
  if (read.body?.is_active !== false) fail(label, "draft", "a new workflow should start inactive");
  else ok();

  const publish = () => s.put(`/workflow-definitions/${id}`, { ...body, isActive: true });
  const pause = () => s.put(`/workflow-definitions/${id}`, { isActive: false });

  const recordsMade: Array<{ table: string; id: string }> = [];
  const runsOf = async (recordId: string) => {
    const res = await s.get(`/workflows/entity/${table}/${recordId}`);
    return ((Array.isArray(res.body) ? res.body : []) as any[]).filter(
      (r) => r.workflow_name === a.name
    );
  };

  async function perform(act: Act, arrange: Record<string, unknown> | undefined) {
    let target: string | undefined;
    if (arrange) {
      await pause(); // made while the workflow is not live, so it is the act that is judged
      const seeded = await make(s, table, withMarker(arrange, marker));
      target = seeded.id;
      if (target) recordsMade.push({ table, id: target });
      else fail(label, "arrange", `${seeded.status} ${JSON.stringify(seeded.body).slice(0, 200)}`);
      await publish();
    }
    if ("create" in act) {
      const res = await make(s, table, withMarker(act.create, marker));
      if (!res.id) {
        fail(label, "write", `${res.status} ${JSON.stringify(res.body).slice(0, 250)}`);
        return undefined;
      }
      recordsMade.push({ table, id: res.id });
      return res.id;
    }
    if (!target) return undefined;
    if ("update" in act) {
      const res = await s.call("PATCH", `/bus/${table}/${target}`, withMarker(act.update, marker));
      if (res.status >= 300)
        fail(
          label,
          "write",
          `update answered ${res.status} ${JSON.stringify(res.body).slice(0, 250)}`
        );
      return target;
    }
    const res = await s.del(`/bus/${table}/${target}`);
    if (res.status >= 300)
      fail(
        label,
        "write",
        `delete answered ${res.status} ${JSON.stringify(res.body).slice(0, 250)}`
      );
    return target;
  }

  async function check(
    recordId: string | undefined,
    expectation: Expectation,
    scenarioLabel: string
  ) {
    const here = `${scenarioLabel}`;
    if (!recordId) return;
    if ("record" in expectation) {
      const res = await s.get(`/bus/${table}/${recordId}`);
      for (const [field, want] of Object.entries(withMarker(expectation.record, marker))) {
        const got = res.body?.[field];
        // The application hands dates back as timestamps; a date written is the same day.
        const same =
          got === want ||
          (typeof want === "string" && typeof got === "string" && got.startsWith(want));
        if (!same)
          fail(
            label,
            `${here}: record`,
            `${field} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`
          );
        else ok();
      }
    } else if ("recordGone" in expectation) {
      const res = await s.get(`/bus/${table}/${recordId}`);
      if (res.status !== 404) fail(label, `${here}: record`, `still there (${res.status})`);
      else ok();
    } else if ("runs" in expectation) {
      const runs = await runsOf(recordId);
      if (runs.length !== expectation.runs)
        fail(label, `${here}: runs`, `expected ${expectation.runs} run(s), found ${runs.length}`);
      else ok();
    } else if ("runStatus" in expectation) {
      const runs = await runsOf(recordId);
      if (runs.length === 0 || runs.some((r) => r.status !== expectation.runStatus)) {
        fail(
          label,
          `${here}: run status`,
          `expected ${expectation.runStatus}, runs were ${JSON.stringify(runs.map((r) => [r.status, r.error_details]))}`
        );
      } else ok();
    } else if ("mutations" in expectation) {
      const runs = await runsOf(recordId);
      const nodeTypes = ((runs[0]?.mutations_applied ?? []) as any[])
        .map((m) => m.nodeType)
        .filter((t) => t !== "Loop");
      if (JSON.stringify(nodeTypes) !== JSON.stringify(expectation.mutations))
        fail(
          label,
          `${here}: steps run`,
          `expected ${expectation.mutations.join(" → ")}, ran ${nodeTypes.join(" → ") || "nothing"}`
        );
      else ok();
    } else if ("made" in expectation) {
      const { table: t, column, count, fields } = expectation.made;
      const res = await s.get(`/bus/${t}?${column}=${encodeURIComponent(marker)}&limit=20`);
      const rows: any[] = res.body?.data ?? [];
      if (rows.length !== count)
        fail(label, `${here}: made`, `expected ${count} row(s) in ${t}, found ${rows.length}`);
      else {
        for (const row of rows) {
          for (const [f, want] of Object.entries(fields ?? {})) {
            if (row[f] !== want && String(row[f]) !== String(want))
              fail(
                label,
                `${here}: made`,
                `${t}.${f} is ${JSON.stringify(row[f])}, expected ${JSON.stringify(want)}`
              );
            else ok();
          }
          recordsMade.push({ table: t, id: row.id });
        }
        if (!fields) ok();
      }
    }
  }

  // 3. Publish, then drive each scenario with real writes.
  const published = await publish();
  if (published.status !== 200) {
    fail(label, "publish", `${published.status} ${JSON.stringify(published.body).slice(0, 250)}`);
  } else {
    ok();
    for (const sc of spec.scenarios) {
      const recordId = await perform(sc.act, sc.arrange);
      for (const e of sc.expect) await check(recordId, e, sc.label);
      // `made` rows are removed between scenarios so each is counted alone.
      await tidy(
        recordsMade.filter((r) => r.table !== table),
        true
      );
    }
  }

  // 4. Switch it off: the same write sets nothing off. Switch it on: it does again.
  const first = spec.scenarios.find((sc) => "create" in sc.act);
  if (first && "create" in first.act && published.status === 200) {
    await pause();
    const res = await make(s, table, withMarker(first.act.create, marker));
    if (res.id) {
      recordsMade.push({ table, id: res.id });
      const runs = await runsOf(res.id);
      if (runs.length !== 0) fail(label, "pause", `ran ${runs.length} time(s) while inactive`);
      else ok();
    }
    await publish();
  }

  // 5. Rename it and save, as the builder's autosave does.
  const renamed = await s.put(`/workflow-definitions/${id}`, {
    name: `${a.name} (edited)`,
    entityName: spec.entity,
    mermaid,
  });
  const after = await s.get(`/workflow-definitions/${id}`);
  if (renamed.status !== 200 || after.body?.name !== `${a.name} (edited)`)
    fail(label, "update", `rename answered ${renamed.status}; name is ${after.body?.name}`);
  else ok();
  if (a.steps.length > 0 && !after.body?.bpmn_xml)
    fail(label, "update", "the steps were no longer compiled after a save");
  else ok();

  // 6. Delete it. Gone from the list, and no longer reachable.
  const gone = await s.del(`/workflow-definitions/${id}`);
  if (gone.status !== 200)
    fail(label, "delete", `${gone.status} ${JSON.stringify(gone.body).slice(0, 200)}`);
  else {
    const missing = await s.get(`/workflow-definitions/${id}`);
    if (missing.status !== 404) fail(label, "delete", `still readable (${missing.status})`);
    else ok();
  }

  await tidy(recordsMade, false);
  await cleanup();
}

/** Remove records a scenario made, so the next one starts clean. */
async function tidy(list: Array<{ table: string; id: string }>, onlyOthers: boolean) {
  for (const r of list.splice(0)) await s.del(`/bus/${r.table}/${r.id}`);
  void onlyOthers;
}

for (const spec of WORKFLOWS) {
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
  process.stdout.write(findings.some((f) => f.workflow.startsWith(spec.id)) ? "x" : ".");
}

console.log(
  `\n${WORKFLOWS.filter((w) => !only || w.id.startsWith(only)).length} workflows, ${checks} checks, ${findings.length} findings`
);
console.log("groups:", Object.fromEntries(groups));
for (const f of findings) console.log(`- ${f.workflow} · ${f.step}: ${f.detail}`);
process.exit(findings.length ? 1 : 0);
