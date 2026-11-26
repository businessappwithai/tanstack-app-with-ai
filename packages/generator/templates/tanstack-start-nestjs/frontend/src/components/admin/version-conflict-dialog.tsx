import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ConflictField } from "@/lib/version-conflict";

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * What the form offers when someone else saved the record first.
 *
 * Two ways out, and neither is a default: Reload takes the saved record and
 * drops this user's edits; Overwrite saves this user's edits over it (checked
 * again against the version just read, so a third save in the meantime is
 * caught rather than overwritten too). Cancel keeps the edits on screen and
 * saves nothing, for a reader who wants to copy something out first.
 */
export function VersionConflictDialog({
  open,
  entityLabel,
  fields,
  labelOf,
  theirVersion,
  isSaving,
  onReload,
  onOverwrite,
  onCancel,
}: {
  open: boolean;
  entityLabel: string;
  fields: ConflictField[];
  labelOf: (field: string) => string;
  theirVersion?: number;
  isSaving?: boolean;
  onReload: () => void;
  onOverwrite: () => void;
  onCancel: () => void;
}) {
  const clashes = fields.filter((f) => f.clash).length;
  return (
    <AlertDialog open={open} onOpenChange={(next) => (!next ? onCancel() : undefined)}>
      <AlertDialogContent className="max-w-2xl" data-testid="version-conflict-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>This {entityLabel.toLowerCase()} was changed while you were editing</AlertDialogTitle>
          <AlertDialogDescription>
            Someone else saved it first{theirVersion ? ` (it is now at version ${theirVersion})` : ""}.
            {fields.length === 0
              ? " None of the fields you can see differ — saving yours will keep your changes."
              : clashes > 0
                ? ` ${clashes} of the fields below were changed by both of you.`
                : " They changed the fields below; you did not."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {fields.length > 0 && (
          <div className="max-h-72 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Field</th>
                  <th className="px-3 py-2 font-medium">Their saved value</th>
                  <th className="px-3 py-2 font-medium">Your value</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.field} className={f.clash ? "bg-amber-50 dark:bg-amber-950/30" : undefined}>
                    <td className="px-3 py-2 font-medium">
                      {labelOf(f.field)}
                      {f.clash && <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">both changed</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{show(f.theirs)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{show(f.mine)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <AlertDialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={isSaving}>
            Keep editing
          </Button>
          <Button variant="outline" onClick={onReload} disabled={isSaving} data-testid="version-conflict-reload">
            Reload their version
          </Button>
          <Button onClick={onOverwrite} disabled={isSaving} data-testid="version-conflict-overwrite">
            {isSaving ? "Saving…" : "Overwrite with mine"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
