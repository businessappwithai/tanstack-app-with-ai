/**
 * The Logic step's help, one Markdown file per editor.
 *
 * Kept as `.md` beside the application rather than as JSX so the words can be
 * read, reviewed and changed without touching a component — and so a reviewer
 * can hold them against the editors they describe. `?raw` inlines each file at
 * build time; nothing is fetched at run time, so the help works offline and in
 * the same bundle as the screen it explains.
 *
 * `help-content.test.ts` holds each page to the editor it documents: every
 * event, step type and outcome the editor offers must appear on its page, so a
 * control added to an editor without a word of help fails a test.
 */

import businessRules from "./business-rules.md?raw";
import lifecycle from "./lifecycle.md?raw";
import overview from "./overview.md?raw";
import processSteps from "./process.md?raw";
import status from "./status.md?raw";

export type HelpTopicId = "overview" | "rules" | "lifecycle" | "status" | "process";

export interface HelpTopic {
  id: HelpTopicId;
  /** The tab label. */
  label: string;
  markdown: string;
}

export const HELP_TOPICS: readonly HelpTopic[] = [
  { id: "overview", label: "Overview", markdown: overview },
  { id: "rules", label: "Business rules", markdown: businessRules },
  { id: "lifecycle", label: "Lifecycle", markdown: lifecycle },
  { id: "status", label: "Status", markdown: status },
  { id: "process", label: "Process", markdown: processSteps },
];

export function helpTopic(id: HelpTopicId): HelpTopic {
  return HELP_TOPICS.find((topic) => topic.id === id) ?? (HELP_TOPICS[0] as HelpTopic);
}
