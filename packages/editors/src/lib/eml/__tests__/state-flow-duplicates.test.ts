/**
 * Regression: ISSUE-003 — the Status editor let two states share a value.
 * The saved diagram names states by value, so the two became one node and the
 * second state's transitions joined the first without a word.
 * Found by /qa on 2026-09-25.
 */

import { describe, expect, it } from "vitest";
import { validateStateFlow } from "../workflow-flow";

describe("validateStateFlow", () => {
  it("names a status value used by two states", () => {
    const problems = validateStateFlow({
      states: [
        { id: "a", name: "draft" },
        { id: "b", name: "draft" },
      ],
      transitions: [],
      initial: "a",
      terminal: ["b"],
    });
    expect(problems).toEqual(['Two states are called "draft" — give each state its own value.']);
  });

  it("has nothing to say about distinct states", () => {
    expect(
      validateStateFlow({
        states: [
          { id: "a", name: "draft" },
          { id: "b", name: "done" },
        ],
        transitions: [{ id: "t", from: "a", to: "b" }],
        initial: "a",
        terminal: ["b"],
      })
    ).toEqual([]);
  });
});
