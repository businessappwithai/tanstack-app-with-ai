/**
 * The rule editor's graph, driven the way an author drives it.
 *
 * The GoRules editor is a canvas, so there is no label to find a node by — but
 * every control has words on it (a node's own name, "Edit Table", "Add row",
 * a palette row's name), and those are what this reaches for. Where the canvas
 * forces coordinates (dragging a palette row onto it, drawing a line between two
 * handles), they are worked out from the elements' own boxes at the moment of
 * the drag, never fixed.
 */

import { expect, type Locator, type Page } from "@playwright/test";

export type NodeKind =
  | "Record"
  | "Response"
  | "Decision table"
  | "Expression"
  | "Function"
  | "Switch";

const EDITOR = ".jdm-scope";

export class RuleGraph {
  constructor(readonly page: Page) {}

  /** The whole editor, tab bar and canvas. */
  get editor(): Locator {
    return this.page.locator(EDITOR).first();
  }

  node(name: string): Locator {
    return this.page.locator(`${EDITOR} .react-flow__node`).filter({ hasText: name }).first();
  }

  get nodes(): Locator {
    return this.page.locator(`${EDITOR} .react-flow__node`);
  }

  get edges(): Locator {
    return this.page.locator(`${EDITOR} .react-flow__edge`);
  }

  /** A tab of the editor — "Graph", or a node that is open for editing. */
  tab(name: string): Locator {
    return this.page.locator(`${EDITOR} [role=tab]`).filter({ hasText: name }).first();
  }

  /** The tab bar scrolls its tabs out of reach, so click by script, not by pointer. */
  async openTab(name: string): Promise<void> {
    await this.tab(name).evaluate((el) => (el as HTMLElement).click());
    await this.page.waitForTimeout(600);
  }

  async waitReady(): Promise<void> {
    await this.page.locator(`${EDITOR} .react-flow`).first().waitFor({ timeout: 150_000 });
    await this.page.waitForTimeout(1500);
  }

  /** Remove a node through its menu, answering the confirmation. */
  async remove(name: string): Promise<void> {
    await this.page.keyboard.press("Escape");
    await this.node(name).locator("button").first().click({ force: true });
    await this.page
      .locator(".ant-dropdown-menu-item")
      .filter({ hasText: "Delete" })
      .first()
      .click();
    await this.page.getByRole("button", { name: "OK", exact: true }).click();
    await expect(this.node(name)).toHaveCount(0);
  }

  async clear(): Promise<void> {
    for (let i = 0; i < 10 && (await this.nodes.count()) > 0; i++) {
      const text = (await this.nodes.first().innerText()).split("\n")[0] ?? "";
      await this.remove(text);
    }
    await expect(this.nodes).toHaveCount(0);
  }

  /**
   * Where the next node goes: three to a row, left to right, so a line between
   * neighbours is a short horizontal one and no node sits on another.
   */
  private async nextSpot(index: number): Promise<{ x: number; y: number }> {
    const pane = this.page.locator(`${EDITOR} .react-flow__pane`).first();
    await pane.scrollIntoViewIfNeeded();
    const box = (await pane.boundingBox())!;
    const width = await this.nodes
      .first()
      .evaluate((e) => e.getBoundingClientRect().width)
      .catch(() => 230);
    const height = await this.nodes
      .first()
      .evaluate((e) => e.getBoundingClientRect().height)
      .catch(() => 80);
    const column = index % 3;
    const row = Math.floor(index / 3);
    return {
      x: box.x + 60 + column * (width + 110),
      y: box.y + 90 + row * (height + 110),
    };
  }

  /** Zoom out until a node is small enough that several fit beside one another. */
  private async makeRoom(): Promise<void> {
    for (let i = 0; i < 6; i++) {
      const width = await this.nodes
        .first()
        .evaluate((e) => e.getBoundingClientRect().width)
        .catch(() => 0);
      if (width === 0 || width < 190) return;
      await this.page.locator(`${EDITOR} .react-flow__controls button`).nth(1).click();
      await this.page.waitForTimeout(300);
    }
  }

  /** Fit every node into view (the controls' third button) — a reopened graph can open scrolled. */
  async fitView(): Promise<void> {
    await this.page.locator(`${EDITOR} .react-flow__controls button`).nth(2).click();
    await this.page.waitForTimeout(400);
  }

  /** Drag a node from the Components panel onto the canvas. */
  async add(kind: NodeKind): Promise<void> {
    const before = await this.nodes.count();
    await this.page
      .locator(`${EDITOR} .react-flow__node >> visible=true`)
      .first()
      .waitFor({ timeout: 4000 })
      .catch(() => {});
    if (before > 0) await this.makeRoom();
    const target = await this.nextSpot(before);
    const drag = async () => {
      const row = this.page.locator(EDITOR).getByText(kind, { exact: true }).last();
      const from = (await row.boundingBox())!;
      const sx = from.x + from.width / 2;
      const sy = from.y + from.height / 2;
      const mouse = this.page.mouse;
      await mouse.move(sx, sy);
      await mouse.down();
      await mouse.move(sx - 40, sy + 10, { steps: 5 });
      await mouse.move(target.x, target.y, { steps: 20 });
      await mouse.up();
    };
    await drag();
    // On a loaded machine the canvas can miss the drop altogether — nothing is added, not
    // even slowly. Drag once more only then; the strict count below still fails a drop
    // that added two.
    const landed = await expect(this.nodes)
      .toHaveCount(before + 1, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!landed && (await this.nodes.count()) === before) await drag();
    await expect(this.nodes).toHaveCount(before + 1);
  }

  /**
   * Draw a line from one node's output to another's input.
   *
   * `edgesAfter` is how many lines the canvas should then hold. Pass it when the caller knows:
   * the canvas re-mounts its edges just after a line is drawn, so a count read at the start of
   * the next link can briefly be one short and the wait would then expect one line too few.
   */
  async link(from: string, to: string, fromHandle = 0, edgesAfter?: number): Promise<void> {
    const before = edgesAfter === undefined ? await this.edges.count() : edgesAfter - 1;
    const source = this.node(from).locator(".react-flow__handle-right").nth(fromHandle);
    const target = this.node(to).locator(".react-flow__handle-left").first();
    await source.scrollIntoViewIfNeeded();
    const a = (await source.boundingBox())!;
    const b = (await target.boundingBox())!;
    const mouse = this.page.mouse;
    // The canvas only starts a connection on a real pointer path, so move in steps.
    await mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await mouse.down();
    await mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, { steps: 4 });
    await mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
    await mouse.up();
    await expect(this.edges).toHaveCount(before + 1);
  }

  /** Everything the editor's code boxes hold, by model, for assertions on what was typed. */
  async codeBoxes(): Promise<string[]> {
    return this.page.evaluate(() => {
      const monaco = (
        window as unknown as {
          monaco?: { editor: { getModels: () => Array<{ getValue: () => string }> } };
        }
      ).monaco;
      return monaco ? monaco.editor.getModels().map((m) => m.getValue()) : [];
    });
  }

  /**
   * Replace the contents of the code box that is showing.
   *
   * Set on the model, not typed: Monaco closes brackets and indents as it is
   * typed into, so typing a function body leaves it with an extra brace.
   */
  async typeIntoCodeBox(text: string): Promise<void> {
    const box = this.page.locator(".monaco-editor >> visible=true").first();
    await box.click({ position: { x: 300, y: 80 } });
    await this.page.evaluate((value) => {
      type Editor = {
        getDomNode: () => HTMLElement | null;
        getModel: () => { setValue: (text: string) => void } | null;
        focus: () => void;
      };
      const monaco = (window as unknown as { monaco: { editor: { getEditors: () => Editor[] } } })
        .monaco;
      const shown = monaco.editor.getEditors().find((e) => e.getDomNode()?.offsetParent);
      if (!shown) throw new Error("No code box is showing");
      shown.getModel()?.setValue(value);
      shown.focus();
    }, text);
  }
}
