import { describe, expect, it } from "vitest";
import {
  type CompiledRbac,
  compileRbac,
  hasRbacRules,
  parseRoleExpression,
  type RbacStateMachine,
  rbacRoleNames,
} from "../index";

const ENTITIES = ["Order", "Deal", "Contact"];

/** Order's lifecycle, so transition-named directives have something to resolve against. */
const MACHINES: RbacStateMachine[] = [
  {
    entity: "Order",
    transitions: [
      { from: "[*]", to: "draft" },
      { from: "draft", to: "submitted", trigger: "submit" },
      { from: "submitted", to: "approved", trigger: "approve" },
      { from: "draft", to: "approved", trigger: "approve" },
      { from: "submitted", to: "rejected", trigger: "close won" },
      { from: "approved", to: "[*]" },
    ],
    terminal: ["approved", "rejected"],
  },
];

/** Operations only — most tests care about the CRUD half. */
const ops = (source: string, entities = ENTITIES) => compileRbac(source, entities).operations;

describe("parseRoleExpression", () => {
  it("reads a single role", () => {
    expect(parseRoleExpression("role:admin")).toEqual(["admin"]);
  });

  it("reads the spec's bare-alternation form", () => {
    expect(parseRoleExpression("role:sales|manager")).toEqual(["sales", "manager"]);
  });

  it("reads a repeated prefix, which is what people write", () => {
    expect(parseRoleExpression("role:sales|role:manager")).toEqual(["sales", "manager"]);
  });

  it("accepts a bare role name rather than failing an unambiguous directive", () => {
    expect(parseRoleExpression("admin")).toEqual(["admin"]);
  });

  it("drops empty alternatives", () => {
    expect(parseRoleExpression("role:admin||")).toEqual(["admin"]);
  });
});

describe("compileRbac", () => {
  it("compiles a directive to one rule against the physical table", () => {
    const rules = ops("%%rbac role:admin on Order.delete", ENTITIES);
    expect(rules).toEqual([
      { entity: "Order", tableName: "bus_order", operation: "delete", roles: ["admin"] },
    ]);
  });

  it("derives snake_case table names for multi-word entities", () => {
    const rules = ops("%%rbac role:admin on Order.delete", ["Order"]);
    expect(rules[0]?.tableName).toBe("bus_order");
    expect(ops("%%rbac role:a on SupportCase.read", ["SupportCase"])[0]?.tableName).toBe(
      "bus_support_case"
    );
  });

  it("expands * to every operation", () => {
    const rules = ops("%%rbac role:admin on Order.*", ENTITIES);
    expect(rules.map((r) => r.operation)).toEqual(["create", "delete", "read", "update"]);
    expect(rules.every((r) => r.roles.length === 1)).toBe(true);
  });

  it("accepts operation aliases", () => {
    expect(ops("%%rbac role:a on Order.remove")[0]?.operation).toBe("delete");
    expect(ops("%%rbac role:a on Order.edit")[0]?.operation).toBe("update");
    expect(ops("%%rbac role:a on Order.view")[0]?.operation).toBe("read");
  });

  it("merges two directives on the same pair instead of the last one winning", () => {
    // Two lines each naming a role must mean "either role", the same as `|`
    // inside one directive. Overriding would silently drop a permission the
    // author wrote down.
    const rules = ops(
      ["%%rbac role:admin on Order.delete", "%%rbac role:auditor on Order.delete"].join("\n"),
      ENTITIES
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.roles).toEqual(["admin", "auditor"]);
  });

  it("de-duplicates a role named twice", () => {
    const rules = ops(
      ["%%rbac role:admin on Order.delete", "%%rbac role:admin on Order.delete"].join("\n"),
      ENTITIES
    );
    expect(rules[0]?.roles).toEqual(["admin"]);
  });

  it("keeps entities separate", () => {
    const rules = ops(
      ["%%rbac role:admin on Order.delete", "%%rbac role:sales on Deal.update"].join("\n"),
      ENTITIES
    );
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.tableName)).toEqual(["bus_deal", "bus_order"]);
  });

  it("skips a directive naming an entity the model does not declare", () => {
    const warnings: string[] = [];
    const compiled = compileRbac("%%rbac role:admin on Ghost.delete", ENTITIES, [], (m) =>
      warnings.push(m)
    );
    expect(compiled.operations).toEqual([]);
    expect(warnings[0]).toContain("unknown entity");
  });

  it("skips a name that is neither an operation nor a move", () => {
    const warnings: string[] = [];
    const compiled = compileRbac("%%rbac role:admin on Order.teleport", ENTITIES, MACHINES, (m) =>
      warnings.push(m)
    );
    expect(compiled.operations).toEqual([]);
    expect(compiled.transitions).toEqual([]);
    // The message must name both possibilities: with state machines in play,
    // "unknown operation" alone would send the author looking in one place.
    expect(warnings[0]).toContain("neither a CRUD operation");
    expect(warnings[0]).toContain("a move in Order's state machine");
  });

  it("skips a directive that names no role, which would lock everyone out", () => {
    const warnings: string[] = [];
    const compiled = compileRbac("%%rbac role: on Order.delete", ENTITIES, [], (m) =>
      warnings.push(m)
    );
    expect(compiled.operations).toEqual([]);
    expect(warnings[0]).toContain("names no role");
  });

  it("warns on a malformed directive instead of ignoring it silently", () => {
    const warnings: string[] = [];
    compileRbac("%%rbac role:admin Order.delete", ENTITIES, [], (m) => warnings.push(m));
    expect(warnings[0]).toContain("malformed");
  });

  it("ignores plain comments and other directives", () => {
    const source = [
      "%% just a note about rbac",
      '%%guard status eq "open"',
      "%%hook afterCreate on Order",
      "%%rbac role:admin on Order.delete",
    ].join("\n");
    expect(ops(source)).toHaveLength(1);
  });

  it("returns nothing for a model that declares no rbac, leaving every op open", () => {
    expect(ops("erDiagram\n  Order {\n string id PK\n }")).toEqual([]);
  });

  it("collects the distinct role names for seeding", () => {
    const compiled = compileRbac(
      ["%%rbac role:admin|manager on Order.delete", "%%rbac role:sales on Deal.update"].join("\n"),
      ENTITIES
    );
    expect(rbacRoleNames(compiled)).toEqual(["admin", "manager", "sales"]);
  });
});

describe("compileRbac — moves along the status flow", () => {
  const compile = (source: string) => compileRbac(source, ENTITIES, MACHINES);

  // A record moves by an action button, along an edge the diagram draws. A move
  // an `%%rbac` line names is limited to those roles; seeded into sys_access_grant.
  it("grants a move by its event, on every edge the event labels", () => {
    const compiled = compile("%%rbac role:manager on Order.approve");
    expect(compiled.transitions).toEqual([
      {
        entity: "Order",
        tableName: "bus_order",
        transition: "approve",
        edges: [
          { from: "submitted", to: "approved" },
          { from: "draft", to: "approved" },
        ],
        roles: ["manager"],
      },
    ]);
  });

  it("reads an event written with spaces or dashes in the diagram as one token", () => {
    const compiled = compile("%%rbac role:manager on Order.close_won");
    expect(compiled.transitions[0]?.edges).toEqual([{ from: "submitted", to: "rejected" }]);
  });

  it("grants an edge the diagram did not label, named from->to", () => {
    const compiled = compile("%%rbac role:clerk on Order.draft->submitted");
    expect(compiled.transitions[0]).toMatchObject({
      transition: "draft->submitted",
      edges: [{ from: "draft", to: "submitted" }],
      roles: ["clerk"],
    });
  });

  it("grants reopen: one edge from each Final state back to Draft", () => {
    const compiled = compile("%%rbac role:sales_ops on Order.reopen");
    expect(compiled.transitions[0]).toMatchObject({
      transition: "reopen",
      edges: [
        { from: "approved", to: "draft" },
        { from: "rejected", to: "draft" },
      ],
    });
  });

  it("lets a model's own edge labelled reopen win over the lifecycle's", () => {
    const machines: RbacStateMachine[] = [
      {
        entity: "Order",
        transitions: [{ from: "resolved", to: "in_progress", trigger: "reopen" }],
        terminal: ["closed"],
      },
    ];
    const compiled = compileRbac("%%rbac role:agent on Order.reopen", ENTITIES, machines);
    expect(compiled.transitions[0]?.edges).toEqual([{ from: "resolved", to: "in_progress" }]);
    // …and Final → Draft is still grantable, named as the edge it is.
    const finalToDraft = compileRbac("%%rbac role:ops on Order.closed->draft", ENTITIES, machines);
    expect(finalToDraft.transitions[0]?.edges).toEqual([{ from: "closed", to: "draft" }]);
  });

  it("merges two lines naming one move, as | inside one line does", () => {
    const compiled = compile(
      ["%%rbac role:rep on Order.submit", "%%rbac role:manager|rep on Order.submit"].join("\n")
    );
    expect(compiled.transitions).toHaveLength(1);
    expect(compiled.transitions[0]?.roles).toEqual(["manager", "rep"]);
    expect(rbacRoleNames(compiled)).toEqual(["manager", "rep"]);
  });

  it("keeps a CRUD rule and a move side by side", () => {
    const compiled = compile(
      ["%%rbac role:admin on Order.delete", "%%rbac role:manager on Order.submit"].join("\n")
    );
    expect(compiled.operations).toHaveLength(1);
    expect(compiled.transitions).toHaveLength(1);
    expect(rbacRoleNames(compiled)).toEqual(["admin", "manager"]);
    expect(hasRbacRules(compiled)).toBe(true);
  });

  it("skips an edge the diagram does not draw", () => {
    const warnings: string[] = [];
    const compiled = compileRbac("%%rbac role:x on Order.submitted->draft", ENTITIES, MACHINES, (m) =>
      warnings.push(m)
    );
    expect(compiled.transitions).toEqual([]);
    expect(warnings[0]).toContain("a move in Order's state machine");
  });

  it("reports nothing declared when the model has no directives", () => {
    const compiled: CompiledRbac = compile("erDiagram");
    expect(hasRbacRules(compiled)).toBe(false);
  });

  it("cannot resolve a move when no machine is supplied", () => {
    const warnings: string[] = [];
    const compiled = compileRbac("%%rbac role:manager on Order.submit", ENTITIES, [], (m) =>
      warnings.push(m)
    );
    expect(compiled.transitions).toEqual([]);
    expect(warnings[0]).toContain("neither a CRUD operation");
  });
});
