/** Remove what earlier QA runs left behind: their rules, switched off first and then deleted for good. */
import { Session } from "./client";

const s = await Session.signIn();
let removed = 0;
for (let round = 0; round < 40; round++) {
  const list = await s.get(`/rules?limit=200`);
  const rows: any[] = Array.isArray(list.body) ? list.body : (list.body?.items ?? []);
  const mine = rows.filter((r) => /^R\d\d |^QA-|^Hot lead guard QA-UI|^QA /.test(r.ruleName));
  if (mine.length === 0) break;
  for (const rule of mine) {
    if (rule.isActive) await s.del(`/rules/${rule.id}`);
    const gone = await s.del(`/rules/${rule.id}?permanent=true`);
    if (gone.status === 200) removed++;
  }
}
const workflows = await s.get(`/workflow-definitions?limit=200`);
for (const w of (workflows.body?.items ?? []).filter((x: any) => /^QA /.test(x.name))) {
  await s.del(`/workflow-definitions/${w.id}`);
  removed++;
}
console.log(`removed ${removed}`);
