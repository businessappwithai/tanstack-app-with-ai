import { useEffect } from "react";

/**
 * Gives CopilotKit's message box an accessible name.
 *
 * The chat window draws its own `<textarea>` and exposes no prop for an
 * `aria-label`, only a placeholder, which assistive technology does not treat
 * as a name and which disappears once something is typed. The box is created
 * when the sidebar opens, so this watches for it rather than looking once.
 * A name the library one day sets for itself is left alone.
 */
export function useCopilotInputLabel(label = "Message the assistant") {
  useEffect(() => {
    const apply = () => {
      document
        .querySelectorAll<HTMLTextAreaElement>(".copilotKitInput textarea")
        .forEach((box) => {
          if (!box.hasAttribute("aria-label") && !box.hasAttribute("aria-labelledby")) {
            box.setAttribute("aria-label", label);
          }
        });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [label]);
}
