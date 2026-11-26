/**
 * Regression: ISSUE-002 — a generated application had no navigation on a phone.
 * Found by /qa on 2026-10-30
 * Report: .gstack/qa-reports/run-20261030T005141Z/qa-report-localhost-2026-10-30.md
 *
 * The sidebar is `hidden md:flex`, and nothing took its place below `md`: at 375px
 * the header held notifications, theme and the avatar, so the only way to another
 * screen was the breadcrumb back to Dashboard. `components/ui/mobile-sidebar.tsx`, a
 * drawer, was copied into every application and used by none. The header now has a
 * menu button below `md` that opens the same sidebar in that drawer, and the drawer
 * closes when a screen is chosen.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../../../templates/tanstack-start-nestjs/frontend/src");
const read = (file: string) => readFileSync(join(SRC, file), "utf8");

describe("mobile navigation", () => {
  const layout = read("components/layout/app-layout.tsx");
  const header = read("components/layout/header.tsx");
  const sidebar = read("components/layout/sidebar.tsx.hbs");
  const drawer = read("components/ui/mobile-sidebar.tsx");

  it("opens the sidebar in the drawer from a header button shown only below md", () => {
    expect(layout).toMatch(/<MobileSidebar open=\{isNavigationOpen\} onOpenChange=\{setNavigationOpen\}>\s*<Sidebar inDrawer \/>/);
    expect(layout).toContain("onOpenNavigation={() => setNavigationOpen(true)}");
    expect(header).toMatch(/className="h-9 w-9 md:hidden"\s*onClick=\{onOpenNavigation\}\s*aria-label="Open the navigation"/);
  });

  it("closes the drawer when the route changes", () => {
    expect(layout).toMatch(/useEffect\(\(\) => \{\s*setNavigationOpen\(false\);\s*\}, \[pathname\]\);/);
  });

  it("draws the sidebar in the drawer expanded and without the rail toggle", () => {
    expect(sidebar).toContain("const isCollapsed = !inDrawer && collapsedRail;");
    expect(sidebar).toMatch(/\{!inDrawer && \(\s*<Button/);
  });

  it("names the drawer so Radix does not report an untitled dialog", () => {
    expect(drawer).toContain('<DialogPrimitive.Title className="sr-only">');
  });
});
