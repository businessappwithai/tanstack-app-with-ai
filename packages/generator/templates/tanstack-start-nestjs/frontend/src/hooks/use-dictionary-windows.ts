/**
 * The Application Dictionary as the user sees it: windows, their tabs, and
 * the fields on each tab.
 *
 * `sys_table` and `sys_column` are the storage layer, where a value is kept.
 * `sys_window`, `sys_tab` and `sys_field` are the view layer: which screens
 * exist, what they are called, which fields they show, in what order and
 * under what label. Every screen that names an entity or a field to a person
 * (the rule editor, Report Designs, the document designer) names it from here.
 *
 * Each field still carries the key the runtime reads (`table_name`,
 * `column_name`): rules and report bindings are stored against those, because
 * that is what the engine evaluates. The key travels as a value and is never
 * the label.
 */

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

interface SysWindowRow {
  sys_window_id: string;
  name: string;
  help?: string | null;
}

interface SysTabRow {
  sys_tab_id: string;
  sys_window_id: string;
  name: string;
  help?: string | null;
  tab_level: number;
  seq_no: number;
  is_active?: boolean;
}

interface SysFieldRow {
  sys_field_id: string;
  sys_tab_id: string;
  name: string;
  seq_no: number;
  is_active?: boolean;
  column_name: string;
  table_name: string;
}

export interface DictionaryField {
  /** The key the runtime reads. Stored, never shown. */
  value: string;
  /** The field's label, as the window shows it. */
  label: string;
}

export interface DictionaryTab {
  tabId: string;
  windowId: string;
  /** "Fee Invoice", or "Fee Invoice › Invoice Line" for a tab below the first level. */
  label: string;
  help: string;
  level: number;
  /** The storage key rules and report designs are filed under. Never shown. */
  tableName: string;
  fields: DictionaryField[];
}

async function loadDictionary(): Promise<DictionaryTab[]> {
  const [windows, tabs, fields] = await Promise.all([
    apiClient.get<{ data?: SysWindowRow[] }>("/sys/windows?limit=1000"),
    apiClient.get<{ data?: SysTabRow[] }>("/sys/tabs?limit=5000"),
    apiClient.get<{ data?: SysFieldRow[] }>("/sys/fields?limit=100000"),
  ]);
  const windowById = new Map((windows.data ?? []).map((w) => [w.sys_window_id, w]));

  const fieldsByTab = new Map<string, SysFieldRow[]>();
  for (const field of fields.data ?? []) {
    if (field.is_active === false) continue;
    const list = fieldsByTab.get(field.sys_tab_id) ?? [];
    list.push(field);
    fieldsByTab.set(field.sys_tab_id, list);
  }

  return (tabs.data ?? [])
    .filter((tab) => tab.is_active !== false && windowById.has(tab.sys_window_id))
    .map((tab): DictionaryTab | null => {
      const window = windowById.get(tab.sys_window_id);
      const own = [...(fieldsByTab.get(tab.sys_tab_id) ?? [])].sort((a, b) => a.seq_no - b.seq_no);
      const tableName = own[0]?.table_name;
      if (!window || !tableName) return null;
      return {
        tabId: tab.sys_tab_id,
        windowId: tab.sys_window_id,
        label: tab.tab_level > 0 ? `${window.name} › ${tab.name}` : window.name,
        help: (tab.tab_level > 0 ? tab.help : window.help) ?? "",
        level: tab.tab_level,
        tableName,
        fields: own.map((field) => ({ value: field.column_name, label: field.name })),
      };
    })
    .filter((tab): tab is DictionaryTab => tab !== null)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Every tab of every window, with its fields in window order. */
export function useDictionaryTabs() {
  return useQuery({
    queryKey: ["dictionary", "tabs"],
    queryFn: loadDictionary,
    staleTime: 5 * 60 * 1000,
  });
}

/** The tab a storage key is shown as — its first-level tab when there are several. */
export function tabForTable(
  tabs: DictionaryTab[] | undefined,
  tableName: string | undefined
): DictionaryTab | undefined {
  if (!tabs || !tableName) return undefined;
  const matches = tabs.filter((tab) => tab.tableName === tableName);
  return matches.find((tab) => tab.level === 0) ?? matches[0];
}
