/**
 * `%%dashboard` reaches the generator.
 *
 * A dashboard groups a role's own `%%report` directives. It can only name what
 * was compiled, so the cases that matter are the ones where a name is wrong or a
 * line is not a directive at all — a tile pointing at nothing renders empty,
 * which reads as no data rather than as a mistake.
 */

import { describe, expect, it } from "vitest";
import { compileDashboards, parseDashboardDirective } from "../index";

const LINE =
  "    %%dashboard sales-manager-pipeline-review title: Pipeline review role: sales_manager " +
  "reports: sales-manager-pipeline-by-stage, sales-manager-pipeline-by-owner, sales-manager-slipped " +
  "help: The Monday forecast meeting: the role reviews the reports and decides what to chase.";

describe("parseDashboardDirective", () => {
  it("reads every key and keeps the report list in order", () => {
    const d = parseDashboardDirective(LINE);
    expect("error" in d).toBe(false);
    if ("error" in d) return;
    expect(d.name).toBe("sales-manager-pipeline-review");
    expect(d.title).toBe("Pipeline review");
    expect(d.role).toBe("sales_manager");
    expect(d.reports).toEqual([
      "sales-manager-pipeline-by-stage",
      "sales-manager-pipeline-by-owner",
      "sales-manager-slipped",
    ]);
  });

  it("stops a value at a real key, not at a word that is only a word", () => {
    const d = parseDashboardDirective(LINE);
    if ("error" in d) throw new Error(d.error);
    // `help:` is a sentence containing "role" and "reports"; only `key:` ends a value.
    expect(d.help).toBe("The Monday forecast meeting: the role reviews the reports and decides what to chase.");
    expect(d.role).toBe("sales_manager");
  });

  it("refuses a dashboard that names no reports", () => {
    expect(parseDashboardDirective("%%dashboard empty title: Nothing role: sales")).toEqual({
      error: "names no reports",
    });
  });

  it("is anchored at ^%%, so prose that mentions a dashboard is prose", () => {
    expect("error" in parseDashboardDirective("The %%dashboard directive groups reports")).toBe(true);
  });
});

describe("compileDashboards", () => {
  const known = ["a", "b", "c"];

  it("compiles each dashboard once, in document order", () => {
    const out = compileDashboards(
      ["%%dashboard one title: One role: r reports: a, b", "%%dashboard two title: Two role: r reports: c"].join("\n"),
      known
    );
    expect(out.map((d) => d.name)).toEqual(["one", "two"]);
  });

  it("leaves off a report that is not declared, and says so", () => {
    const warnings: string[] = [];
    const out = compileDashboards("%%dashboard one title: One role: r reports: a, ghost, b", known, (m) =>
      warnings.push(m)
    );
    expect(out[0]?.reports).toEqual(["a", "b"]);
    expect(warnings.join("\n")).toContain('"ghost", which is not a %%report');
  });

  it("skips a dashboard left with nothing to show", () => {
    const warnings: string[] = [];
    const out = compileDashboards("%%dashboard one title: One role: r reports: ghost", known, (m) => warnings.push(m));
    expect(out).toEqual([]);
    expect(warnings.join("\n")).toContain("shows no declared report");
  });

  it("keeps the first of two dashboards sharing a name", () => {
    const warnings: string[] = [];
    const out = compileDashboards(
      ["%%dashboard one title: First role: r reports: a", "%%dashboard one title: Second role: r reports: b"].join("\n"),
      known,
      (m) => warnings.push(m)
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("First");
    expect(warnings.join("\n")).toContain("declared more than once");
  });
});
