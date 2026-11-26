/**
 * Regression: a failed sign-in was reported twice, inline and as a toast.
 *
 * The inline banner stays beside the fields it is about; the toast said the
 * same words and vanished. The banner is the one that is kept, and it has to be
 * announced, so it carries `role="alert"`.
 *
 * Found by /qa on 2026-10-21 (sign-in with a wrong password, airport model).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LOGIN = join(
  import.meta.dirname,
  "../../../templates/tanstack-start-nestjs/frontend/src/routes/auth/login.tsx"
);

describe("sign-in screen template", () => {
  const source = readFileSync(LOGIN, "utf8");

  it("does not repeat a failure in a toast", () => {
    expect(source).not.toMatch(/toast\.(error|warning|info)/);
    expect(source).not.toContain("from 'sonner'");
  });

  it("announces the inline failure to assistive technology", () => {
    expect(source).toMatch(/role="alert"/);
  });

  it("explains why its entity counts exceed the sidebar's when there are line items", () => {
    expect(source).toContain("LINE_ITEM_ENTITIES");
  });
});
