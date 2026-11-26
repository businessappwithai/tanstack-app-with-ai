/**
 * TanStack Query Hooks for Entity CRUD Operations
 *
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { apiClient, type PaginatedResponse, type ApiError } from '@/lib/api-client';
import { toast } from 'sonner';
import { translate } from '@/lib/translations';
import { ifMatchHeader } from '@/lib/version-conflict';

// ============================================================================
// Types
// ============================================================================

export interface EntityRecord {
  [key: string]: unknown;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface EntityListParams {
  page?: number;
  limit?: number;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  search?: string;
  [key: string]: unknown;
}

export interface FieldMetadata {
  sys_field_id: string;
  name: string;
  column_name: string;
  sys_reference_id: number;
  is_mandatory: boolean;
  is_updateable?: boolean;
  field_length?: number;
  default_value?: string;
  seq_no: number;
  seq_no_grid: number;
  is_displayed: boolean;
  is_displayed_grid: boolean;
  is_read_only: boolean;
  /** Description (the field's, else its column's) — the short line the form shows beneath it. */
  description?: string | null;
  /**
   * The dictionary's display value (§3.7) — the columns that name a record,
   * and whether this one is the key. `use-bus-entity-level` picks the record
   * title from these; the API omitted them, so the title fell through to the
   * uuid on every entity whose identifier is not literally called `name`.
   */
  is_identifier?: boolean;
  is_key?: boolean;
  /**
   * The column the entity's state machine drives. System-managed: the record
   * header shows it read-only (StateBadge), the list grid always shows it, and
   * the form never offers it as an input.
   */
  is_state_field?: boolean;
  col_span?: number;
  row_span?: number;
  field_group_id?: string;
  group_name?: string;
  group_columns?: number;
  group_description?: string;
  group_layout_type?: string | null;
  color?: string;
  background_color?: string;
  font_weight?: string;
  font_style?: string;
  text_align?: string;
  reference_name?: string; // Human-readable type name returned by the API (e.g. "String", "Integer", "Date")
  ref_table_name?: string; // Referenced table name for TABLE reference types (sys_reference_id = 18)
  ref_label_fields?: string[]; // Identifier columns of the referenced table for display
  ref_endpoint?: string;        // Custom API endpoint for table references (e.g. '/sys/references')
  ref_id_field?: string;        // Field to use as option value (default: 'id')
  ref_label_field?: string;     // Field to use as option label (default: 'name')
  ref_filter_param?: string;    // Query param name to append to ref_endpoint for filtering (e.g. 'tableId')
  ref_filter_source?: string;   // Key in parentContext whose value is used as the filter (e.g. 'sys_table_id')
  options?: { value: string; label: string }[]; // Static options list for inline enums
  tab_name?: string; // Tab name for i18n field labels
  help?: string; // Contextual help text shown via ? icon
  /**
   * Compiere's field logic — `@column@=value` conditions over the record being
   * edited, joined by `&`/`|` (lib/field-logic.ts). The form re-evaluates them
   * on every change: display hides the field, read-only locks it, mandatory
   * requires it. The API enforces the last two on save.
   */
  display_logic?: string | null;
  read_only_logic?: string | null;
  mandatory_logic?: string | null;
  /** Set by the form when read-only logic, not the dictionary flag, locks the field. */
  logic_read_only?: boolean;
  /*
   * The rest of the Field window, as the API serves it (bus.service
   * getEntityMetadata). Reference Type Override and Active arrive already
   * applied — to sys_reference_id and is_displayed / is_displayed_grid.
   */
  /** Display Length — the input's width and the grid column's, in characters. */
  display_length?: number | null;
  /** Num Lines — a text field with more than one is drawn as a box that many rows tall. */
  num_lines?: number | null;
  /** Same Line — sits beside the field before it; otherwise the field starts a new row. */
  is_same_line?: boolean;
  /** Heading — drawn as a heading across the section, with no input. */
  is_heading?: boolean;
  /** Field Only — the input with no label. */
  is_field_only?: boolean;
  /** Encrypted — masked wherever it is shown, typed into a password input. */
  is_encrypted?: boolean;
  /** Obscure Type — 904 / 944 / A04 / A44 (lib/field-values.ts). */
  obscure_type?: string | null;
  /** Sort Number — the list's default order: smallest magnitude first, negative = descending. */
  sort_no?: number | null;
  /** Included Tab — another tab's rows for this record, drawn at this field's place. */
  included_tab?: {
    sys_tab_id: string;
    name: string;
    table_name: string;
    link_column: string;
  } | null;
}

export interface TableMetadata {
  sys_table_id: string;
  table_name: string;
  name: string;
  description?: string;
  icon?: string;
  is_active: boolean;
}

// ============================================================================
// Query Keys
// ============================================================================

export const entityKeys = {
  all: ['entities'] as const,
  lists: () => [...entityKeys.all, 'list'] as const,
  list: (entity: string, params?: EntityListParams) =>
    [...entityKeys.lists(), entity, params] as const,
  details: () => [...entityKeys.all, 'detail'] as const,
  detail: (entity: string, id: string) =>
    [...entityKeys.details(), entity, id] as const,
  metadata: (entity: string) =>
    [...entityKeys.all, 'metadata', entity] as const,
  table: (entity: string) =>
    [...entityKeys.all, 'table', entity] as const,
  fields: (entity: string, type: 'form' | 'grid') =>
    [...entityKeys.all, 'fields', entity, type] as const,
};

// ============================================================================
// List Hook
// ============================================================================

export function useEntities<T extends EntityRecord = EntityRecord>(
  entity: string,
  params?: EntityListParams,
  options?: Omit<
    UseQueryOptions<PaginatedResponse<T>, ApiError>,
    'queryKey' | 'queryFn'
  >
) {
  return useQuery<PaginatedResponse<T>, ApiError>({
    queryKey: entityKeys.list(entity, params),
    queryFn: () => apiClient.get<PaginatedResponse<T>>(`/bus/${entity}`, params),
    ...options,
  });
}

// ============================================================================
// Detail Hook
// ============================================================================

export function useEntity<T extends EntityRecord = EntityRecord>(
  entity: string,
  id: string,
  options?: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>
) {
  return useQuery<T, ApiError>({
    queryKey: entityKeys.detail(entity, id),
    queryFn: () => apiClient.get<T>(`/bus/${entity}/${id}`),
    enabled: !!id,
    ...options,
  });
}

// ============================================================================
// Metadata Hooks
// ============================================================================

export function useEntityMetadata(entity: string, enabled = true) {
  return useQuery({
    queryKey: entityKeys.metadata(entity),
    queryFn: async () => {
      return apiClient.get<{ table: any; columns: any[]; window: any }>(`/bus/${entity}/meta`);
    },
    staleTime: 30 * 60 * 1000, // 30 minutes - metadata rarely changes
    enabled,
  });
}

/**
 * Fetch table metadata (including icon) from sys_table
 */
export function useTableMetadata(entity: string) {
  return useQuery<TableMetadata>({
    queryKey: entityKeys.table(entity),
    queryFn: async () => {
      // Fetch all tables and find the matching one
      const response = await apiClient.get<{ data: TableMetadata[] }>(`/sys/tables`);
      const table = response.data.find((t: TableMetadata) => t.table_name === entity);
      return table as TableMetadata;
    },
    staleTime: 30 * 60 * 1000, // 30 minutes - table metadata rarely changes
    enabled: !!entity,
  });
}

export function useFormFields(entity: string, options?: { enabled?: boolean }) {
  return useQuery<FieldMetadata[]>({
    queryKey: entityKeys.fields(entity, 'form'),
    queryFn: async () => {
      return apiClient.get<FieldMetadata[]>(`/bus/${entity}/fields/form`);
    },
    staleTime: 30 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useGridFields(entity: string, options?: { enabled?: boolean }) {
  return useQuery<FieldMetadata[]>({
    queryKey: entityKeys.fields(entity, 'grid'),
    queryFn: async () => {
      return apiClient.get<FieldMetadata[]>(`/bus/${entity}/fields/grid`);
    },
    staleTime: 30 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

// ============================================================================
// Reference List Hooks
// ============================================================================

export interface RefListValue {
  sys_ref_list_id: string;
  sys_reference_id: number;
  value: string;
  name: string;
  description?: string;
  is_active: boolean;
}

export function useRefList(sysReferenceId: number) {
  return useQuery<RefListValue[]>({
    queryKey: ['ref-list', sysReferenceId],
    queryFn: async () => {
      const response = await apiClient.get<{ data: RefListValue[] }>(
        `/sys/ref-list?sys_reference_id=${sysReferenceId}`
      );
      return response.data;
    },
    staleTime: 60 * 60 * 1000, // 1 hour - reference data rarely changes
    enabled: !!sysReferenceId && sysReferenceId >= 1000, // Only for our custom references
  });
}

export interface WindowHelpData {
  window: { sys_window_id: string; name: string; description?: string; help?: string } | null | undefined;
  tabs: Array<{ sys_tab_id: string; name: string; description?: string; help?: string; seq_no: number; tab_level: number }>;
  fields: Array<{
    sys_field_id: string;
    sys_tab_id: string;
    name: string;
    help?: string;
    seq_no: number;
    column_name: string;
    is_mandatory: boolean;
  }>;
}

export function useWindowHelp(tableName: string) {
  return useQuery<WindowHelpData | null>({
    queryKey: ['window-help', tableName],
    queryFn: () => apiClient.get<WindowHelpData>(`/sys/window-help/${encodeURIComponent(tableName)}`),
    staleTime: 30 * 60 * 1000,
    enabled: !!tableName,
  });
}

/**
 * Get ALL form fields including hidden ones (for layout editor)
 */
export function useAllFormFields(entity: string) {
  return useQuery<FieldMetadata[]>({
    queryKey: ['fields-all', entity, 'form'],
    queryFn: async () => {
      const result = await apiClient.get<FieldMetadata[]>(`/sys/fields/form?entity=${entity}&includeHidden=true`);
      return result || [];
    },
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * Get ALL grid fields including hidden ones (for layout editor)
 */
export function useAllGridFields(entity: string) {
  return useQuery<FieldMetadata[]>({
    queryKey: ['fields-all', entity, 'grid'],
    queryFn: async () => {
      const result = await apiClient.get<FieldMetadata[]>(`/sys/fields/grid?entity=${entity}&includeHidden=true`);
      return result || [];
    },
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * Update field styling properties
 */
export function useUpdateFieldStyle(entity: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ fieldId, style }: { fieldId: string; style: Partial<FieldMetadata> }) => {
      return apiClient.patch(`/sys/fields/${fieldId}?entity=${entity}`, style);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fields-all', entity] });
      queryClient.invalidateQueries({ queryKey: [entityKeys.fields(entity, 'form')] });
      queryClient.invalidateQueries({ queryKey: [entityKeys.fields(entity, 'grid')] });
      toast.success(translate('entities.fieldStyleUpdated' as any));
    },
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

export function useCreateEntity<T extends EntityRecord = EntityRecord>(
  entity: string
) {
  const queryClient = useQueryClient();

  type MutationContext = {
    previousData?: unknown;
  };

  return useMutation<T, ApiError, Partial<T>, MutationContext>({
    mutationFn: (data) => apiClient.post<T>(`/bus/${entity}`, data),
    onMutate: async (newData) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: entityKeys.lists() });

      // Snapshot previous value
      const previousData = queryClient.getQueryData(entityKeys.lists());

      // Optimistically update to the new value
      queryClient.setQueryData(entityKeys.lists(), (old: any) => {
        return {
          ...old,
          data: [...(old?.data || []), { ...newData, version: 0 } as T],
        };
      });

      // Return context with previous data
      return { previousData };
    },
    onError: (err, newData, context) => {
      // Rollback to previous value on error
      queryClient.setQueryData(entityKeys.lists(), context?.previousData);
      const errorMessage = Array.isArray(err.message) ? err.message.join(', ') : err.message;
      toast.error(`${translate('entities.createFailed' as any)}: ${errorMessage}`);
    },
    onSettled: () => {
      // Refetch to ensure server state
      queryClient.invalidateQueries({ queryKey: entityKeys.lists() });
    },
  });
}

export function useUpdateEntity<T extends EntityRecord = EntityRecord>(
  entity: string
) {
  const queryClient = useQueryClient();

  type MutationVariables = { id: string; data: Partial<T>; version?: number };
  type MutationContext = {
    previousDetail?: unknown;
    previousList?: unknown;
  };

  return useMutation<T, ApiError, MutationVariables, MutationContext>({
    mutationFn: ({ id, data, version }) =>
      apiClient.patch<T>(`/bus/${entity}/${id}`, data, {
        headers: ifMatchHeader(version),
      }),
    onMutate: async ({ id, data, version }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: entityKeys.detail(entity, id) });
      await queryClient.cancelQueries({ queryKey: entityKeys.lists() });

      // Snapshot previous values
      const previousDetail = queryClient.getQueryData(entityKeys.detail(entity, id));
      const previousList = queryClient.getQueryData(entityKeys.lists());

      // Optimistically update detail
      queryClient.setQueryData(entityKeys.detail(entity, id), (old: any) => ({
        ...old,
        ...data,
        version: version ? version + 1 : (old?.version || 0) + 1,
      }));

      // Optimistically update list
      queryClient.setQueryData(entityKeys.lists(), (old: any) => ({
        ...old,
        data: old?.data?.map((item: any) =>
          item.id === id || item.sys_table_id === id
            ? { ...item, ...data, version: version ? version + 1 : (item.version || 0) + 1 }
            : item
        ),
      }));

      // Return context with previous data
      return { previousDetail, previousList };
    },
    onError: (err, variables, context) => {
      // Rollback to previous values on error
      queryClient.setQueryData(entityKeys.detail(entity, variables.id), context?.previousDetail);
      queryClient.setQueryData(entityKeys.lists(), context?.previousList);
      const errorMessage = Array.isArray(err.message) ? err.message.join(', ') : err.message;
      toast.error(`${translate('entities.updateFailed' as any)}: ${errorMessage}`);
    },
    onSettled: (_data, _error, variables) => {
      // Refetch to ensure server state
      if (variables) {
        queryClient.invalidateQueries({ queryKey: entityKeys.detail(entity, variables.id) });
      }
      queryClient.invalidateQueries({ queryKey: entityKeys.lists() });
    },
  });
}

export function useDeleteEntity(entity: string) {
  const queryClient = useQueryClient();

  type MutationContext = {
    previousDetail?: unknown;
    previousList?: unknown;
  };

  return useMutation<void, ApiError, string, MutationContext>({
    mutationFn: (id) => apiClient.delete(`/bus/${entity}/${id}`),
    onMutate: async (id) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: entityKeys.detail(entity, id) });
      await queryClient.cancelQueries({ queryKey: entityKeys.lists() });

      // Snapshot previous values
      const previousDetail = queryClient.getQueryData(entityKeys.detail(entity, id));
      const previousList = queryClient.getQueryData(entityKeys.lists());

      // Optimistically remove from detail cache
      queryClient.setQueryData(entityKeys.detail(entity, id), null);

      // Optimistically remove from list
      queryClient.setQueryData(entityKeys.lists(), (old: any) => ({
        ...old,
        data: old?.data?.filter((item: any) => item.id !== id && item.sys_table_id !== id),
      }));

      // Return context with previous data
      return { previousDetail, previousList };
    },
    onError: (err, id, context) => {
      // Rollback to previous values on error
      queryClient.setQueryData(entityKeys.detail(entity, id), context?.previousDetail);
      queryClient.setQueryData(entityKeys.lists(), context?.previousList);
      const errorMessage = Array.isArray(err.message) ? err.message.join(', ') : err.message;
      toast.error(`${translate('entities.deleteFailed' as any)}: ${errorMessage}`);
    },
    onSettled: () => {
      // Refetch to ensure server state
      queryClient.invalidateQueries({ queryKey: entityKeys.lists() });
    },
  });
}

// ============================================================================
// Prefetch Utilities
// ============================================================================

export function usePrefetchEntity(entity: string) {
  const queryClient = useQueryClient();

  return (id: string) => {
    queryClient.prefetchQuery({
      queryKey: entityKeys.detail(entity, id),
      queryFn: () => apiClient.get(`/bus/${entity}/${id}`),
    });
  };
}

export function usePrefetchEntityList(entity: string) {
  const queryClient = useQueryClient();

  return (params?: EntityListParams) => {
    queryClient.prefetchQuery({
      queryKey: entityKeys.list(entity, params),
      queryFn: () => apiClient.get(`/bus/${entity}`, params),
    });
  };
}

// ============================================================================
// Field Group Hooks (for Admin)
// ============================================================================

export interface FieldGroup {
  sys_field_group_id: string;
  name: string;
  description?: string;
  columns: number;
  layout_type: string;
  is_collapsed_by_default: boolean;
  seq_no: number;
  field_count?: number;
}

export const fieldGroupKeys = {
  all: ['field-groups'] as const,
  lists: () => [...fieldGroupKeys.all, 'list'] as const,
  list: (entity: string) => [...fieldGroupKeys.lists(), entity] as const,
};

export function useFieldGroups(entity: string) {
  return useQuery<FieldGroup[]>({
    queryKey: fieldGroupKeys.list(entity),
    queryFn: async () => {
      const response = await apiClient.get<{ data: FieldGroup[] }>(
        '/sys/field-groups?entity=' + entity
      );
      return response.data || [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateFieldGroup(entity: string) {
  const queryClient = useQueryClient();

  return useMutation<FieldGroup, ApiError, Partial<FieldGroup>>({
    mutationFn: (data) =>
      apiClient.post<FieldGroup>('/sys/field-groups?entity=' + entity, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fieldGroupKeys.list(entity) });
      queryClient.invalidateQueries({ queryKey: [...entityKeys.all, 'fields'] });
      toast.success(translate('entities.fieldGroupCreated' as any));
    },
  });
}

export function useUpdateFieldGroup(entity: string) {
  const queryClient = useQueryClient();

  return useMutation<
    FieldGroup,
    ApiError,
    { id: string; data: Partial<FieldGroup> }
  >({
    mutationFn: ({ id, data }) =>
      apiClient.put<FieldGroup>(
        '/sys/field-groups/' + id + '?entity=' + entity,
        data
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fieldGroupKeys.list(entity) });
      queryClient.invalidateQueries({ queryKey: [...entityKeys.all, 'fields'] });
      toast.success(translate('entities.fieldGroupUpdated' as any));
    },
  });
}

export function useDeleteFieldGroup(entity: string) {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, string>({
    mutationFn: (id) =>
      apiClient.delete('/sys/field-groups/' + id + '?entity=' + entity),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fieldGroupKeys.list(entity) });
      queryClient.invalidateQueries({ queryKey: [...entityKeys.all, 'fields'] });
      toast.success(translate('entities.fieldGroupDeleted' as any));
    },
  });
}
