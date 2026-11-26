/**
 * Regression: ISSUE-002 — the Priority input took 2.5, which both runtimes
 * store in an INTEGER column and so rounded without saying so.
 * Found by /qa on 2026-09-25.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyDecisionTable } from "../../../lib/workflow/bpmn-model";
import { RuleEditor } from "../RuleEditor";

describe("RuleEditor priority", () => {
  it("keeps the priority a whole number", () => {
    const onChange = vi.fn();
    render(
      <RuleEditor
        rule={{
          key: "k",
          name: "r",
          entity: "Student",
          event: "beforeCreate",
          priority: 10,
          table: emptyDecisionTable(),
        }}
        entities={[{ name: "Student", attributes: ["id", "status"] }]}
        projectId="p"
        onChange={onChange}
        onError={() => undefined}
      />
    );
    const input = screen.getByLabelText("Priority");
    expect(input.getAttribute("step")).toBe("1");
    fireEvent.change(input, { target: { value: "2.5" } });
    expect(onChange).toHaveBeenLastCalledWith({ priority: 2 });
    fireEvent.change(input, { target: { value: "-5" } });
    expect(onChange).toHaveBeenLastCalledWith({ priority: -5 });
  });
});
