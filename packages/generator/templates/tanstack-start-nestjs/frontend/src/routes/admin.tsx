/**
 * Admin layout.
 *
 * Also where the model assistant lives. Mounted here rather than on individual
 * admin pages so it is available across all of them, and behind the same role
 * check as the rest of this section: the model describes the whole
 * application's data design, including entities a given user may have no
 * access to.
 *
 * Available, not mounted. The assistant's dependency tree — CopilotKit, and
 * through it streamdown, mermaid and shiki's grammars — is several megabytes of
 * JavaScript, and importing it here put all of it on the critical path of every
 * administrator screen. It now lives in `../components/admin/model-assistant`,
 * which nothing imports statically; the button below is what fetches it. An
 * administrator who never opens the assistant never downloads it.
 */

import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { Component, type ErrorInfo, lazy, type ReactNode, Suspense, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { getClientLogger, reportClientError } from '@/lib/logger'

export const Route = createFileRoute('/admin')({
  // Redirect non-admin users before the component tree renders
  beforeLoad: ({ context }: any) => {
    const role = (context as any)?.user?.role;
    if (role && role !== 'admin') {
      throw redirect({ to: '/dashboard' });
    }
  },
  component: AdminLayout,
});

const ModelAssistant = lazy(() => import('../components/admin/model-assistant'));

/**
 * What stands in for the assistant until somebody wants it.
 *
 * Deliberately a plain button rather than a preloaded sidebar: the point of the
 * split is that nothing of CopilotKit is fetched until this is clicked.
 */
function AssistantLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open the model assistant"
      data-testid="assistant-launcher"
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
    >
      <Sparkles className="h-4 w-4" />
      <span className="text-sm font-medium">Assistant</span>
    </button>
  );
}

/**
 * Keeps a failed assistant from taking the admin section with it.
 *
 * The assistant arrives as a chunk fetched on demand, and the most likely way
 * for that fetch to fail is the ordinary one: a deploy replaced the build while
 * this tab was open, so the hashed filename this page remembers is gone. That
 * throws during render, and without a boundary here it propagates to the root
 * error component — replacing every admin screen with an error page because
 * somebody clicked a chat button.
 *
 * Errors from below are not caught: `<Outlet />` sits outside this, so a real
 * fault in an admin page still reaches the root boundary that is meant to
 * report it.
 */
class AssistantBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError({
      level: 'error',
      source: 'boundary',
      component: 'admin/model-assistant',
      message: error.message || 'the model assistant failed to load',
      stack: error.stack,
    })
    getClientLogger('admin').error('the model assistant failed to load', {
      message: error.message,
      componentStack: info.componentStack,
    })
    this.props.onFailure();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function AdminLayout() {
  // Once the assistant has been asked for it stays mounted: unmounting it would
  // throw away the conversation, and the chunk is in the browser's cache
  // anyway. The exception is a load failure, which puts the launcher back so
  // the next click can retry — a stale-chunk error clears on a reload, and
  // leaving no control at all would mean the only way back is to know to
  // refresh.
  const [assistantRequested, setAssistantRequested] = useState(false);

  return (
    <>
      <Outlet />
      {assistantRequested ? (
        <AssistantBoundary onFailure={() => setAssistantRequested(false)}>
          {/*
           * No fallback: the launcher has already been replaced, and a spinner
           * where a sidebar is about to appear reads as a fault rather than a
           * download.
           */}
          <Suspense fallback={null}>
            <ModelAssistant />
          </Suspense>
        </AssistantBoundary>
      ) : (
        <AssistantLauncher onOpen={() => setAssistantRequested(true)} />
      )}
    </>
  );
}
