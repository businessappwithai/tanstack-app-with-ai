/**
 * The administrator's model assistant, and everything it drags in with it.
 *
 * This module exists to be a chunk boundary. `@copilotkit/react-core` depends
 * on `streamdown`, which depends on `mermaid` and on `shiki` with its full
 * grammar set — a measured 2.36MB of JavaScript for mermaid alone, and enough
 * shiki grammars (emacs-lisp, wolfram, objective-cpp, asciidoc, …) to take the
 * built client output past 20MB. Imported from the /admin layout directly,
 * every one of those bytes was on the critical path of every administrator
 * screen, whether or not anyone opened the assistant. It made /admin the
 * heaviest page in the application by a factor of three while it rendered
 * nothing anyone could see.
 *
 * Nothing here is imported statically anywhere. `src/routes/admin.tsx` reaches
 * it through `React.lazy`, when the administrator asks for the assistant.
 */

import { CopilotKit } from '@copilotkit/react-core';
import { CopilotSidebar } from '@copilotkit/react-ui';
import { useEffect } from 'react';
import { useModelAssistant } from '../../hooks/useModelAssistant';
import '@copilotkit/react-ui/styles.css';
import { APP_NAME } from '@/lib/app-meta';

/**
 * The hook has to run below CopilotKit's provider — calling it in
 * ModelAssistant itself would place the context below its own consumer and
 * throw. It renders nothing; it registers what the assistant can read and do.
 */
function AssistantActions() {
  useModelAssistant();
  return null;
}

/**
 * Gives the chat's message box an accessible name. CopilotKit draws its own
 * `<textarea>` and exposes only a placeholder, which is not a name and vanishes
 * once something is typed. The box appears when the sidebar opens, so this
 * watches for it. A name the library sets for itself is left alone.
 */
function useMessageBoxLabel(label: string) {
  useEffect(() => {
    const apply = () => {
      document
        .querySelectorAll<HTMLTextAreaElement>('.copilotKitInput textarea')
        .forEach((box) => {
          if (!box.hasAttribute('aria-label') && !box.hasAttribute('aria-labelledby')) {
            box.setAttribute('aria-label', label);
          }
        });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [label]);
}

const ASSISTANT_LABELS = {
  title: `${APP_NAME} assistant`,
  initial:
    "I can search this application's model — its entities and fields, the business " +
    'rules that run on them, and the processes that create, update and delete records. ' +
    'Ask what already happens on an entity, or describe a change and I will tell you ' +
    'what it would affect.',
};

/**
 * Opens straight away: the only thing that mounts this component is somebody
 * asking for the assistant, so starting closed would ask them twice.
 */
export default function ModelAssistant() {
  useMessageBoxLabel(`Message the ${APP_NAME} assistant`);
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      // The inspector is gated on `enableInspector`, NOT `showDevConsole` —
      // the <CopilotKit> wrapper reads them from different props, and
      // `showDevConsole` only silences error toasts and banners. Left unset,
      // `enableInspector` falls back to "is this localhost?", so it mounts a
      // <cpk-web-inspector> floating button above everything at z-index
      // 2147483646 that swallows clicks landing under it — including from any
      // script driving the UI. Off unless someone asks for it.
      enableInspector={false}
      showDevConsole={false}
    >
      <AssistantActions />
      <CopilotSidebar
        labels={ASSISTANT_LABELS}
        defaultOpen={true}
        clickOutsideToClose={false}
      />
    </CopilotKit>
  );
}
