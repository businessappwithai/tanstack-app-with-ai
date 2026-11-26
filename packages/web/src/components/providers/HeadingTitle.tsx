import { useEffect } from "react";

const APP_TITLE = "APPWITHAI";

/**
 * Keeps the document title naming the screen.
 *
 * Every screen used to share the product name as its title, so a tab, a history
 * entry or a screen reader announcing a page change said the same thing
 * everywhere. Each screen already names itself in its `h1`, so the title follows
 * that heading, including when it arrives late (a project's name), instead of
 * every route restating it.
 */
export function HeadingTitle() {
  useEffect(() => {
    const apply = () => {
      const heading = document.querySelector("h1")?.textContent?.trim();
      document.title = heading && heading !== APP_TITLE ? `${heading} · ${APP_TITLE}` : APP_TITLE;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
