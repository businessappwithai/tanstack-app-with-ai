/**
 * The actions at the end of an administrative row — Edit, and a Delete that
 * asks once more in place. Used by the User and Role screens.
 */

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Loader2, Pencil, Trash2 } from 'lucide-react';

/** The server's own words for a refusal, or `fallback` when it gave none. */
export const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string } | null)?.message ?? fallback;

/**
 * Edit, and a delete that asks once more in place. In place rather than a
 * browser confirm(): the application can run inside a frame, where a modal
 * dialog is not guaranteed to appear.
 */
export function RowActions({
  label,
  onEdit,
  remove,
  onRemoved,
}: {
  label: string;
  onEdit: () => void;
  remove: () => Promise<unknown>;
  onRemoved: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const removal = useMutation({ mutationFn: remove, onSuccess: onRemoved });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1">
        {confirming ? (
          <>
            <button
              type="button"
              onClick={() => removal.mutate()}
              disabled={removal.isPending}
              className="inline-flex items-center gap-1 rounded-md bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground disabled:opacity-60"
            >
              {removal.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              Delete {label}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                removal.reset();
              }}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
            >
              Keep
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${label}`}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={`Delete ${label}`}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
      {removal.isError && (
        <p className="max-w-xs text-right text-xs text-destructive">{errorText(removal.error, 'Could not delete')}</p>
      )}
    </div>
  );
}
