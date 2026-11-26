export type SimpleOperator = "equals" | "notEquals" | "exists";
export type HierarchyOperator = "ancestorOf" | "descendantOf" | "parentOf" | "childOf";

export type Condition =
  | { field: string; operator: "equals" | "notEquals"; value: unknown }
  | { field: string; operator: "exists" }
  | { operator: "and" | "or"; conditions: Condition[] }
  | { operator: HierarchyOperator; value: string };

export interface Filter {
  condition: Condition;
}
export interface QueryPart {
  filters: Filter[];
}
export interface ArchitectureQuery {
  nodes?: QueryPart;
  links?: QueryPart;
}
