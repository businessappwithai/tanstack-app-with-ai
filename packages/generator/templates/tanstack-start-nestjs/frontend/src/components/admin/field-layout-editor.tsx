
/**
 * Field Layout Editor
 *
 * Admin component for modifying field order (seq_no) at runtime.
 * Uses drag-and-drop to reorder fields which updates sys_field.seq_no.
 *
 * Auto-generated component
 */

import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Columns,
  Eye,
  EyeOff,
  FormInput,
  GripVertical,
  Layers,
  Palette,
  RotateCcw,
  Save,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  entityKeys,
  type FieldMetadata,
  useAllFormFields,
  useAllGridFields,
  useFieldGroups,
  useUpdateFieldStyle,
} from "@/hooks/use-entities";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { getClientLogger } from "@/lib/logger";

const log = getClientLogger("field-layout");

// ============================================================================
// Types
// ============================================================================

interface FieldLayoutEditorProps {
  entityName: string;
}

interface EditableField extends FieldMetadata {
  originalSeqNo: number;
  hasChanges: boolean;
}

// Color options for field styling
const COLOR_OPTIONS = [
  { value: "contrast", label: "Auto", color: "bg-muted border-border" },
  { value: "#3b82f6", label: "Blue", color: "bg-blue-500" },
  { value: "#ef4444", label: "Red", color: "bg-red-500" },
  { value: "#22c55e", label: "Green", color: "bg-green-500" },
  { value: "#f59e0b", label: "Orange", color: "bg-orange-500" },
  { value: "#8b5cf6", label: "Purple", color: "bg-purple-500" },
  { value: "#06b6d4", label: "Cyan", color: "bg-cyan-500" },
  { value: "#ec4899", label: "Pink", color: "bg-pink-500" },
];

// ============================================================================
// Reference Type Labels
// ============================================================================

const REFERENCE_TYPE_LABELS: Record<number, string> = {
  10: "String",
  11: "Integer",
  12: "Decimal",
  13: "UUID",
  14: "Text",
  15: "Date",
  16: "DateTime",
  17: "List",
  18: "Table Ref",
  19: "Direct Ref",
  20: "Boolean",
  24: "URL",
  30: "Email",
  31: "Phone",
};

// ============================================================================
// Field Layout Editor Component
// ============================================================================

export function FieldLayoutEditor({ entityName }: FieldLayoutEditorProps) {
  const queryClient = useQueryClient();

  const [editableFields, setEditableFields] = useState<EditableField[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [editMode, setEditMode] = useState<"form" | "grid">("form");
  const [expandedFieldIds, setExpandedFieldIds] = useState<Set<string>>(new Set());

  // Load field groups for displaying group information
  const { data: fieldGroups } = useFieldGroups(entityName);

  // Field style mutation
  const updateFieldStyleMutation = useUpdateFieldStyle(entityName);

  // Load ALL form and grid field data (including hidden ones) for layout editor
  const {
    data: formFields,
    isLoading: formLoading,
    error: formError,
    refetch: refetchForm,
  } = useAllFormFields(entityName);
  const {
    data: gridFields,
    isLoading: gridLoading,
    error: gridError,
    refetch: refetchGrid,
  } = useAllGridFields(entityName);

  // Select the appropriate fields based on current mode
  const fields = editMode === "form" ? formFields : gridFields;
  const isLoading = editMode === "form" ? formLoading : gridLoading;
  const error = editMode === "form" ? formError : gridError;
  const _refetch = editMode === "form" ? refetchForm : refetchGrid;

  // Initialize editable fields when data loads or edit mode changes
  useEffect(() => {
    if (fields) {
      setEditableFields(
        fields.map((f) => ({
          ...f,
          originalSeqNo: editMode === "form" ? f.seq_no : f.seq_no_grid,
          hasChanges: false,
        }))
      );
    }
  }, [fields, editMode]);

  // Batch update mutation
  const batchUpdateMutation = useMutation({
    mutationFn: async (
      updates: Array<{
        id: string;
        seq_no?: number;
        seq_no_grid?: number;
        is_displayed?: boolean;
        is_displayed_grid?: boolean;
      }>
    ) => {
      return apiClient.put("/sys/fields/batch-reorder", { fields: updates });
    },
    onSuccess: async (_, updates) => {
      // Create a map of updated field IDs to their new values
      const updatesMap = new Map(updates.map((u) => [u.id, u]));

      // Update the local state immediately with the saved values
      setEditableFields((prev) => {
        return prev.map((field) => {
          const update = updatesMap.get(field.sys_field_id);
          if (update) {
            return {
              ...field,
              seq_no: update.seq_no !== undefined ? update.seq_no : field.seq_no,
              seq_no_grid:
                update.seq_no_grid !== undefined ? update.seq_no_grid : field.seq_no_grid,
              is_displayed:
                update.is_displayed !== undefined ? update.is_displayed : field.is_displayed,
              is_displayed_grid:
                update.is_displayed_grid !== undefined
                  ? update.is_displayed_grid
                  : field.is_displayed_grid,
              hasChanges: false,
            };
          }
          return field;
        });
      });

      // Force immediate refetch of all field queries (bypasses staleTime)
      await queryClient.refetchQueries({ queryKey: entityKeys.fields(entityName, "form") });
      await queryClient.refetchQueries({ queryKey: entityKeys.fields(entityName, "grid") });
      await queryClient.refetchQueries({ queryKey: ["field-groups", entityName] });

      setHasChanges(false);
      toast.success("Field layout saved successfully");
    },
    onError: (error: any) => {
      toast.error(`Failed to update field layout: ${error.message}`);
    },
  });

  // Handle drag end
  const onDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return;

      const sourceIndex = result.source.index;
      const destIndex = result.destination.index;

      if (sourceIndex === destIndex) return;

      setEditableFields((prev) => {
        const items = Array.from(prev);
        const [reorderedItem] = items.splice(sourceIndex, 1);
        items.splice(destIndex, 0, reorderedItem);

        // Update sequence numbers based on new positions and current mode
        const updated = items.map((item, index) => {
          if (editMode === "form") {
            // Only update form seq_no, leave grid seq_no_grid unchanged
            return {
              ...item,
              seq_no: (index + 1) * 10,
              hasChanges: true,
            };
          } else {
            // Only update grid seq_no_grid, leave form seq_no unchanged
            return {
              ...item,
              seq_no_grid: (index + 1) * 10,
              hasChanges: true,
            };
          }
        });

        return updated;
      });

      setHasChanges(true);
    },
    [editMode]
  );

  // Toggle field visibility
  const toggleVisibility = useCallback((fieldId: string, visibilityType: "form" | "grid") => {
    setEditableFields((prev) => {
      const updated = prev.map((f) => {
        if (f.sys_field_id !== fieldId) return f;

        const newFormDisplayed = visibilityType === "form" ? !f.is_displayed : f.is_displayed;
        const newGridDisplayed =
          visibilityType === "grid" ? !f.is_displayed_grid : f.is_displayed_grid;

        log.debug(`Toggling ${fieldId} ${visibilityType}`, {
          before: { form: f.is_displayed, grid: f.is_displayed_grid },
          after: { form: newFormDisplayed, grid: newGridDisplayed },
        });

        return {
          ...f,
          is_displayed: newFormDisplayed,
          is_displayed_grid: newGridDisplayed,
          hasChanges: true,
        };
      });

      return updated;
    });
    setHasChanges(true);
  }, []);

  // Save changes
  const handleSave = useCallback(() => {
    const updates = editableFields
      .filter((f) => f.hasChanges)
      .map((f) => {
        // Always send both seq_no and seq_no_grid so backend can update both independently
        return {
          id: f.sys_field_id,
          seq_no: f.seq_no,
          seq_no_grid: f.seq_no_grid,
          is_displayed: f.is_displayed,
          is_displayed_grid: f.is_displayed_grid,
        };
      });

    log.debug(`Saving field updates (${editMode} mode)`, { count: updates.length });

    if (updates.length > 0) {
      batchUpdateMutation.mutate(updates);
    }
  }, [editableFields, editMode, batchUpdateMutation]);

  // Reset changes
  const handleReset = useCallback(() => {
    if (fields) {
      setEditableFields(
        fields.map((f) => ({
          ...f,
          originalSeqNo: editMode === "form" ? f.seq_no : f.seq_no_grid,
          hasChanges: false,
        }))
      );
      setHasChanges(false);
    }
  }, [fields, editMode]);

  // Toggle field detail expansion
  const toggleFieldExpansion = useCallback((fieldId: string) => {
    setExpandedFieldIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(fieldId)) {
        newSet.delete(fieldId);
      } else {
        newSet.add(fieldId);
      }
      return newSet;
    });
  }, []);

  // Update column span
  const updateColSpan = useCallback(
    (fieldId: string, colSpan: number) => {
      updateFieldStyleMutation.mutate(
        { fieldId, style: { col_span: colSpan } },
        {
          onSuccess: () => {
            // Update local state
            setEditableFields((prev) =>
              prev.map((f) => (f.sys_field_id === fieldId ? { ...f, col_span: colSpan } : f))
            );
            toast.success("Column span updated");
          },
        }
      );
    },
    [updateFieldStyleMutation]
  );

  // Update field color
  const updateFieldColor = useCallback(
    (fieldId: string, color: string) => {
      updateFieldStyleMutation.mutate(
        { fieldId, style: { color } },
        {
          onSuccess: () => {
            // Update local state
            setEditableFields((prev) =>
              prev.map((f) => (f.sys_field_id === fieldId ? { ...f, color } : f))
            );
            toast.success("Field color updated");
          },
        }
      );
    },
    [updateFieldStyleMutation]
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="rounded-md bg-destructive/15 p-4 text-destructive">
            Failed to load fields: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Field Layout Editor
              <Badge variant="outline" className="ml-2">
                {editMode === "form" ? "Form Fields" : "Grid Columns"}
              </Badge>
              {hasChanges && (
                <Badge variant="secondary" className="ml-2">
                  Unsaved changes
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {editMode === "form"
                ? "Configure field order and visibility for forms (create/edit screens)."
                : "Configure column order and visibility for data grids/lists."}
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            {/* Edit mode toggle */}
            <div className="flex items-center gap-2 border rounded-lg p-1">
              <Button
                variant={editMode === "form" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setEditMode("form")}
              >
                <FormInput className="h-4 w-4 mr-1" />
                Form
              </Button>
              <Button
                variant={editMode === "grid" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setEditMode("grid")}
              >
                <Columns className="h-4 w-4 mr-1" />
                Grid
              </Button>
            </div>

            {/* Action buttons */}
            <Button variant="outline" size="sm" onClick={handleReset} disabled={!hasChanges}>
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges || batchUpdateMutation.isPending}
            >
              <Save className="h-4 w-4 mr-1" />
              {batchUpdateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="fields">
            {(provided) => (
              <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                {editableFields.map((field, index) => (
                  <Draggable
                    key={field.sys_field_id}
                    draggableId={field.sys_field_id}
                    index={index}
                  >
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef as React.Ref<HTMLDivElement>}
                        {...(provided.draggableProps as React.HTMLAttributes<HTMLDivElement>)}
                        className={cn(
                          "flex items-center gap-4 p-4 border rounded-lg bg-card transition-opacity",
                          snapshot.isDragging && "shadow-lg ring-2 ring-primary",
                          field.hasChanges && "border-primary/50",
                          // Dim the field if it's hidden in the current mode
                          editMode === "form" && !field.is_displayed && "opacity-50 bg-muted/30",
                          editMode === "grid" &&
                            !field.is_displayed_grid &&
                            "opacity-50 bg-muted/30"
                        )}
                      >
                        {/* Drag handle */}
                        <div
                          {...provided.dragHandleProps}
                          className="cursor-grab active:cursor-grabbing"
                        >
                          <GripVertical className="h-5 w-5 text-muted-foreground" />
                        </div>

                        {/* Sequence number */}
                        <div className="w-12 text-center">
                          <span className="text-sm font-medium text-muted-foreground">
                            #{index + 1}
                          </span>
                        </div>

                        {/* Field info */}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{field.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {field.column_name}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {REFERENCE_TYPE_LABELS[field.sys_reference_id] || "Unknown"}
                            </Badge>
                            {field.is_mandatory && (
                              <Badge variant="destructive" className="text-xs">
                                Required
                              </Badge>
                            )}
                            {/* Show group badge if field is in a group */}
                            {field.group_name && (
                              <Badge variant="outline" className="text-xs flex items-center gap-1">
                                <Layers className="h-3 w-3" />
                                {field.group_name}
                              </Badge>
                            )}
                            {/* Show "Hidden" badge for fields not displayed in current mode */}
                            {editMode === "form" && !field.is_displayed && (
                              <Badge variant="outline" className="text-xs border-dashed">
                                Hidden in Form
                              </Badge>
                            )}
                            {editMode === "grid" && !field.is_displayed_grid && (
                              <Badge variant="outline" className="text-xs border-dashed">
                                Hidden in Grid
                              </Badge>
                            )}
                          </div>

                          {/* Expanded styling controls */}
                          {expandedFieldIds.has(field.sys_field_id) && (
                            <div className="mt-4 pt-4 border-t space-y-4">
                              {/* Column span control */}
                              <div className="flex items-center gap-4">
                                <Label className="text-sm w-24">Column Span:</Label>
                                <div className="flex-1 flex items-center gap-3">
                                  <Slider
                                    value={[field.col_span || 1]}
                                    min={1}
                                    max={12}
                                    step={1}
                                    onValueChange={([value]) =>
                                      updateColSpan(field.sys_field_id, value)
                                    }
                                    className="flex-1"
                                  />
                                  <span className="text-sm font-medium w-8 text-center">
                                    {field.col_span || 1}
                                  </span>
                                </div>
                              </div>

                              {/* Color picker */}
                              <div className="flex items-center gap-4">
                                <Label className="text-sm w-24 flex items-center gap-2">
                                  <Palette className="h-4 w-4" />
                                  Color:
                                </Label>
                                <div className="flex-1 flex items-center gap-2 flex-wrap">
                                  {COLOR_OPTIONS.map((colorOption) => (
                                    <button
                                      key={colorOption.value}
                                      onClick={() =>
                                        updateFieldColor(field.sys_field_id, colorOption.value)
                                      }
                                      className={cn(
                                        "w-8 h-8 rounded-full border-2 transition-all hover:scale-110",
                                        colorOption.color,
                                        field.color === colorOption.value
                                          ? "ring-2 ring-offset-2 ring-primary"
                                          : "ring-0"
                                      )}
                                      title={colorOption.label}
                                    />
                                  ))}
                                </div>
                                {field.color && field.color !== "contrast" && (
                                  <div
                                    className="w-8 h-8 rounded-full border-2"
                                    style={{ backgroundColor: field.color }}
                                  />
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Visibility toggles and expand button */}
                        <div className="flex items-center gap-4">
                          {/* Expand/collapse button for styling options */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleFieldExpansion(field.sys_field_id)}
                            className="h-8 w-8 p-0"
                            title={
                              expandedFieldIds.has(field.sys_field_id)
                                ? "Hide styling options"
                                : "Show styling options"
                            }
                          >
                            {expandedFieldIds.has(field.sys_field_id) ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>

                          <div className="flex items-center gap-2">
                            <Switch
                              id={`form-${field.sys_field_id}`}
                              checked={field.is_displayed}
                              onCheckedChange={() => toggleVisibility(field.sys_field_id, "form")}
                            />
                            <Label
                              htmlFor={`form-${field.sys_field_id}`}
                              className="text-sm cursor-pointer"
                              title={field.is_displayed ? "Visible in forms" : "Hidden in forms"}
                            >
                              {field.is_displayed ? (
                                <Eye className="h-4 w-4" />
                              ) : (
                                <EyeOff className="h-4 w-4 text-muted-foreground" />
                              )}
                            </Label>
                          </div>

                          <div className="flex items-center gap-2">
                            <Switch
                              id={`grid-${field.sys_field_id}`}
                              checked={field.is_displayed_grid}
                              onCheckedChange={() => toggleVisibility(field.sys_field_id, "grid")}
                            />
                            <Label
                              htmlFor={`grid-${field.sys_field_id}`}
                              className="text-sm cursor-pointer flex items-center gap-1"
                              title={
                                field.is_displayed_grid ? "Visible in grids" : "Hidden in grids"
                              }
                            >
                              <Columns className="h-4 w-4" />
                            </Label>
                          </div>
                        </div>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>

        {editableFields.length === 0 && (
          <div className="rounded-md bg-muted p-8 text-center text-muted-foreground">
            No fields configured for this entity.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
