import {
  Copy,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ADToolbarProps {
  onNew?: () => void;
  onCopy?: () => void;
  onSave?: () => void;
  onDelete?: () => void;
  onUndo?: () => void;
  onRefresh?: () => void;
  onEdit?: () => void;
  onCancelEdit?: () => void;
  onAdvancedSearchToggle?: () => void;
  onPrint?: () => void;
  advancedFilterCount?: number;
  isSaving?: boolean;
  isDeleting?: boolean;
  hasChanges?: boolean;
  canDelete?: boolean;
  canCreate?: boolean;
  isEditing?: boolean;
  isDetailView?: boolean;
  /** False for a record at the end of its flow: Final is locked until reopened. */
  canEdit?: boolean;
  isAdvancedSearchOpen?: boolean;
  hasPrintReport?: boolean;
}

export function ADToolbar({
  onNew,
  onCopy,
  onSave,
  onDelete,
  onUndo,
  onRefresh,
  onEdit,
  canEdit = true,
  onCancelEdit,
  onAdvancedSearchToggle,
  onPrint,
  advancedFilterCount = 0,
  isSaving,
  isDeleting,
  hasChanges,
  canDelete = true,
  canCreate = true,
  isEditing = false,
  isDetailView = false,
  isAdvancedSearchOpen = false,
  hasPrintReport = false,
}: ADToolbarProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-muted/20 flex-wrap">
        {/* Search button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isAdvancedSearchOpen ? "secondary" : "outline"}
              size="sm"
              onClick={onAdvancedSearchToggle}
              className="h-9 gap-2 px-3 text-sm font-medium"
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">Search</span>
              {advancedFilterCount > 0 && (
                <Badge variant="default" className="h-4 px-1 text-[10px] min-w-[16px]">
                  {advancedFilterCount}
                </Badge>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Advanced Search</TooltipContent>
        </Tooltip>

        {canCreate && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={onNew}
                className="h-9 gap-2 px-3 text-sm font-medium hover:bg-primary/10 hover:text-primary hover:border-primary/30"
              >
                <Plus className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">New</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>New Record</TooltipContent>
          </Tooltip>
        )}

        {onCopy && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={onCopy}
                className="h-9 gap-2 px-3 text-sm font-medium"
              >
                <Copy className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">Copy</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy Record</TooltipContent>
          </Tooltip>
        )}

        {(isDetailView || isEditing) && <Separator orientation="vertical" className="h-7 mx-1" />}

        {/* Detail view action buttons */}
        {isDetailView && !isEditing && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                onClick={onEdit}
                disabled={!canEdit}
                className="h-9 gap-2 px-4 text-sm font-semibold bg-teal-700 hover:bg-teal-800 text-white shadow-sm"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {canEdit ? "Edit Record" : "Final — this record is locked. Reopen it to change it."}
            </TooltipContent>
          </Tooltip>
        )}

        {isEditing && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={onSave}
                  disabled={isSaving || !hasChanges}
                  className="h-9 gap-2 px-4 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {isSaving ? "Saving…" : "Save Changes"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save Changes</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={onCancelEdit}
                  className="h-9 gap-2 px-4 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cancel Editing</TooltipContent>
            </Tooltip>

            {canDelete && (
              <AlertDialog>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        disabled={isDeleting}
                        className="h-9 gap-2 px-4 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white shadow-sm disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        {isDeleting ? "Deleting…" : "Delete"}
                      </Button>
                    </AlertDialogTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Delete Record</TooltipContent>
                </Tooltip>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this record?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. The record will be permanently deleted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={onDelete}
                      className="bg-red-600 hover:bg-red-700 text-white"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {hasChanges && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onUndo}
                    className="h-9 gap-2 px-3 text-sm font-medium"
                  >
                    <RotateCcw className="h-4 w-4" />
                    <span className="sr-only sm:not-sr-only">Undo</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Undo Changes</TooltipContent>
              </Tooltip>
            )}
          </>
        )}

        {/* Non-editing Save for list view */}
        {!isDetailView && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                onClick={onSave}
                disabled={isSaving || !hasChanges}
                className="h-9 gap-2 px-4 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {isSaving ? "Saving…" : "Save"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Save</TooltipContent>
          </Tooltip>
        )}

        <div className="ml-auto flex items-center gap-2">
          {isDetailView && hasPrintReport && onPrint && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onPrint}
                  className="h-9 gap-2 px-3 text-sm font-medium text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-800 hover:bg-violet-50 dark:hover:bg-violet-950/40 hover:border-violet-400"
                >
                  <Printer className="h-4 w-4" />
                  <span className="sr-only sm:not-sr-only">Print</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Print Report</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefresh}
                aria-label="Refresh"
                className="h-9 w-9 p-0 hover:bg-primary/10 hover:text-primary"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          {/* No theme control here any more. It was in this toolbar because the
              four AD shells were the only chrome an entity screen had, and it
              was the one place that could put the control on all of them.
              `AppLayout`'s header is on every screen now, so keeping this one
              put two theme toggles a few centimetres apart. */}
        </div>
      </div>
    </TooltipProvider>
  );
}
