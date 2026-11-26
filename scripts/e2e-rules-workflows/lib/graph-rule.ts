/**
 * A rule drawn node by node in the graph editor — Record, then a chain of
 * Expression, Function and Switch nodes, then Response — the shape spec 03
 * builds and spec 14 creates, updates and deletes.
 */

import { expect, type Page } from "@playwright/test";
import type { RuleGraph } from "./rule-graph";
import { startRule, type TryItAnswer } from "./rule-table";

export type GraphNode =
  | { kind: "Expression"; rows: Array<[string, string]> }
  | { kind: "Function"; body: string }
  | { kind: "Switch"; condition: string };

export interface GraphRuleScenario {
  name: string;
  entity: string;
  /** Nodes to add, in order, between the Record and the Response. */
  chain: GraphNode[];
  tryIt: Array<{ sample: Record<string, unknown>; expect: TryItAnswer; message?: string }>;
}

/** A function node's body from its lines, wrapped in the handler zen runs. */
export const fn = (lines: string[]) => ({
  kind: "Function" as const,
  body: ["export const handler = async (input) => {", ...lines.map((l) => `  ${l}`), "};"].join(
    "\n"
  ),
});

/** The names the editor gives the chain's nodes: expression1, function1, switch1, … */
export function chainNames(chain: GraphNode[]): string[] {
  const counts: Record<string, number> = {};
  return chain.map((node) => {
    counts[node.kind] = (counts[node.kind] ?? 0) + 1;
    return `${node.kind.toLowerCase()}${counts[node.kind]}`;
  });
}

export async function configureNode(page: Page, graph: RuleGraph, node: GraphNode, name: string) {
  if (node.kind === "Expression") {
    await graph.node(name).getByText("Edit Expression").click();
    for (const [i, [key, expr]] of node.rows.entries()) {
      await graph.editor
        .getByText("Add row", { exact: true })
        .locator("visible=true")
        .first()
        .click();
      const editor = (await graph.editor.boundingBox())!;
      const y = editor.y + 107 + i * 40;
      await page.mouse.click(editor.x + 140, y);
      await page.keyboard.insertText(key);
      await page.mouse.click(editor.x + 520, y);
      await page.keyboard.insertText(expr);
      await page.keyboard.press("Escape");
    }
    await graph.openTab("Graph");
  } else if (node.kind === "Function") {
    await graph.node(name).getByText("Edit Function").click();
    await expect(graph.editor.locator(".monaco-editor >> visible=true").first()).toBeVisible({
      timeout: 30_000,
    });
    await graph.typeIntoCodeBox(node.body);
    await expect.poll(() => graph.codeBoxes()).toContainEqual(expect.stringContaining("handler"));
    await graph.openTab("Graph");
  } else {
    const condition = graph.node(name).locator("input, textarea, .cm-content").first();
    await condition.click();
    await page.keyboard.insertText(node.condition);
  }
}

/** New rule → clear the starter graph → Record, the chain, Response, linked in a line. */
export async function buildGraphRule(page: Page, graph: RuleGraph, rule: GraphRuleScenario) {
  await startRule(page, graph, rule);
  await graph.clear();
  await graph.add("Record");
  for (const node of rule.chain) await graph.add(node.kind);
  await graph.add("Response");
  const names = chainNames(rule.chain);
  const path = ["Record", ...names, "response"];
  for (let i = 0; i < path.length - 1; i++) {
    await graph.link(path[i] as string, path[i + 1] as string, 0, i + 1);
  }
  for (const [i, node] of rule.chain.entries()) {
    await configureNode(page, graph, node, names[i] as string);
  }
}
