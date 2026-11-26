/**
 * Regression: CopilotKit's message box had a placeholder and no accessible name.
 *
 * The library draws the `<textarea>` itself and exposes no `aria-label` prop, so
 * the hook names it after the fact. The box only exists once the sidebar opens,
 * so naming has to follow it into the page, and a name already present (the
 * library's own, or ours) is never replaced.
 *
 * Found by /qa on 2026-10-21 (accessibility audit of the designer).
 */

import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useCopilotInputLabel } from "../useCopilotInputLabel";

function Host({ label }: { label?: string }) {
  useCopilotInputLabel(label);
  return null;
}

function addMessageBox(attrs: Record<string, string> = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "copilotKitInput";
  const box = document.createElement("textarea");
  box.placeholder = "Type a message...";
  for (const [key, value] of Object.entries(attrs)) box.setAttribute(key, value);
  wrapper.appendChild(box);
  document.body.appendChild(wrapper);
  return box;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useCopilotInputLabel", () => {
  it("names a message box that is already on the page", () => {
    const box = addMessageBox();
    render(<Host />);
    expect(box.getAttribute("aria-label")).toBe("Message the assistant");
  });

  it("names a box that appears later, when the sidebar opens", async () => {
    render(<Host label="Ask about the model" />);
    let box!: HTMLTextAreaElement;
    await act(async () => {
      box = addMessageBox();
      await Promise.resolve();
    });
    expect(box.getAttribute("aria-label")).toBe("Ask about the model");
  });

  it("leaves a name the library or the page already gave", () => {
    const box = addMessageBox({ "aria-label": "Chat input" });
    render(<Host />);
    expect(box.getAttribute("aria-label")).toBe("Chat input");
  });

  it("does not touch textareas outside the chat", () => {
    const other = document.createElement("textarea");
    document.body.appendChild(other);
    render(<Host />);
    expect(other.hasAttribute("aria-label")).toBe(false);
  });
});
