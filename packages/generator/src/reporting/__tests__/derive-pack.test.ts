/**
 * The reporting pack, held to the model it claims to be derived from.
 *
 * Three kinds of assertion here, and the second is the one worth having:
 *
 *   - **Shape**: an entity earns a register, an `%%enum` a breakdown, a state
 *     machine a lifecycle, a `oneToMany` a children-per-parent.
 *   - **Agreement with the application.** The pack names tables the generated
 *     application actually creates, and scopes each reporting role to exactly
 *     what `deriveAccess` says the same role may read. The two products came to
 *     disagree about both before this file existed: a table named by a second
 *     snake-casing (`bus_k_y_c_record` against `bus_kyc_record`) and a role
 *     whose count was computed twice.
 *   - **The empty-scope inversion.** `tables: []` means "everything" for an
 *     administrator and "nothing" for every other role, and reading the second
 *     as the first hands the least-privileged account on the system permission
 *     to read the whole schema.
 */

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { tableNameFor } from "../../naming/tables";
import { parseModel } from "../../pipeline/parse-model";
import { deriveAccess } from "../../rbac/roles";
import { buildReportingPack } from "../pack";

const MODEL = `%%meta name: Field Service
%%meta kind: erd
%%meta version: 1.0.0
%%enum TicketStatus: new, assigned, resolved
%%enum SiteTier: gold, silver
erDiagram
    Site {
        string id PK
        string name UK
        string tier
        integer bays
    }
    KYCRecord {
        string id PK
        string reference UK
        string site_id FK
    }
    Ticket {
        string id PK
        string title
        string status
        decimal cost
        string site_id FK
    }
    Site ||--o{ Ticket : raises
    Site ||--o{ KYCRecord : holds
%%entity Site help: A place engineers are sent to.
%%entity Ticket help: One job at a site, from reported to resolved.
%%entity KYCRecord help: The compliance record a site has to hold.
%%field Site.tier enum: SiteTier
%%field Ticket.status enum: TicketStatus
%%report open-by-site title: Open tickets by site entity: Ticket chart: bar x: site y: open sql: SELECT s.name AS site, COUNT(*) AS open FROM bus_ticket t JOIN bus_site s ON s.id = t.site_id WHERE t.status <> 'resolved' GROUP BY 1
%%rbac role:dispatcher on Ticket.read
%%rbac role:dispatcher on Site.read
%%rbac role:auditor on KYCRecord.read
stateDiagram-v2
    %%workflow TicketLifecycle entity: Ticket kind: state
    [*] --> new
    new --> assigned
    assigned --> resolved
    resolved --> [*]
`;

const parse = () =>
  parseModel(MODEL, { projectName: "field-service", outputDir: "/tmp/unused" } as never);

const build = async () =>
  buildReportingPack(await parse(), {
    projectName: "field-service",
    databaseName: "field_service",
  });

describe("buildReportingPack", () => {
  it("derives a register, a breakdown, a lifecycle and a children-per-parent", async () => {
    const pack = await build();
    const keys = new Set(pack.reports.map((report) => report.key));

    expect(keys).toContain("site__register");
    expect(keys).toContain("ticket__register");
    // `%%enum`-bound columns earn a breakdown; unbound ones do not.
    expect(keys).toContain("ticket__by_status");
    expect(keys).toContain("site__by_tier");
    // A `kind: state` workflow earns a lifecycle over the declared states.
    expect(keys).toContain("ticket__lifecycle");
    // `oneToMany` earns children per parent, named for both ends.
    expect(keys).toContain("ticket__per_site");
    // A numeric column earns a measures report.
    expect(keys).toContain("ticket__measures");
    // The authored question is listed first and keeps its own name.
    expect(pack.reports[0]?.key).toBe("authored__open-by-site");
    expect(pack.reports[0]?.name).toBe("Open tickets by site");
  });

  it("puts every declared state in the lifecycle, in the diagram's order", async () => {
    const pack = await build();
    const query = pack.queries.find((q) => q.key === "ticket__lifecycle");
    expect(query).toBeDefined();
    // Run it, rather than reading it: positions, not an alphabetical sort — a
    // lifecycle sorted by name says nothing about where work is piling up —
    // and LEFT JOINed, so a state nothing has reached is a zero, not absent.
    const pg = await PGlite.create();
    try {
      await pg.exec(`
        CREATE TABLE bus_ticket (status text, deleted_at timestamptz);
        INSERT INTO bus_ticket VALUES ('resolved', NULL), ('resolved', NULL), ('new', NULL),
          ('new', now());
      `);
      const result = await pg.query<{ state: string; records: number | string }>(query?.sql ?? "");
      expect(result.rows.map((row) => [row.state, Number(row.records)])).toEqual([
        ["new", 1],
        ["assigned", 0],
        ["resolved", 2],
      ]);
    } finally {
      await pg.close();
    }
  });

  // The Enterprise Reporting platform parses every query to decide which tables
  // a role may read, and refuses — to everyone but its administrator — a query
  // it cannot parse. Its parser has no CTE column list, so the form this used to
  // emit, `WITH declared(state, position) AS (VALUES …)`, left every lifecycle
  // report unreadable to every role.
  it("writes no CTE column list, which the reporting platform cannot parse", async () => {
    const pack = await build();
    for (const query of pack.queries) {
      expect(query.sql, query.key).not.toMatch(/\bWITH\s+\w+\s*\(/i);
    }
  });

  it("names the tables the generated application actually creates", async () => {
    const model = await parse();
    const pack = await buildReportingPack(model, {
      projectName: "field-service",
      databaseName: "field_service",
    });

    const real = new Set(model.entities.map((entity) => tableNameFor(entity)));
    // `KYCRecord` is the case that matters: a second snake-casing writes
    // `bus_k_y_c_record`, which is a table nothing creates.
    expect(real).toContain("bus_kyc_record");

    for (const query of pack.queries) {
      for (const table of query.tables) {
        expect(real, `${query.key} reads ${table}, which no entity creates`).toContain(table);
      }
    }
  });

  it("records the tables each query reads, so a role can be scoped", async () => {
    const pack = await build();
    for (const query of pack.queries) {
      expect(query.tables.length, `${query.key} names no table`).toBeGreaterThan(0);
    }
    // The authored query joins two tables and both are recorded.
    const authored = pack.queries.find((q) => q.key === "authored__open-by-site");
    expect(authored?.tables).toEqual(["bus_site", "bus_ticket"]);
  });

  it("scopes each reporting role to exactly what the application says it reads", async () => {
    const model = await parse();
    const pack = await buildReportingPack(model, {
      projectName: "field-service",
      databaseName: "field_service",
    });
    const access = deriveAccess(model.rbac, {
      projectId: "field-service",
      entities: model.entities.map((entity) => entity.name),
    });

    for (const role of pack.access.roles) {
      if (role.isAdmin) continue;
      const expected = access.entityCounts[role.name];
      if (expected === undefined) continue;
      expect(role.tables.length, `${role.name} disagrees with the application`).toBe(expected);
    }

    const dispatcher = pack.access.roles.find((r) => r.declaredAs === "dispatcher");
    expect(dispatcher?.tables.sort()).toEqual(["bus_site", "bus_ticket"]);
    const auditor = pack.access.roles.find((r) => r.declaredAs === "auditor");
    expect(auditor?.tables).toEqual(["bus_kyc_record"]);
  });

  it("never gives a functional role the name the platform reads as its administrator", async () => {
    // The platform treats a role *called* admin or administrator as a system administrator,
    // whatever it was seeded with, so a model's functional `admin` role must not take that name.
    const model = await parseModel(
      MODEL.replace(
        "%%rbac role:auditor on KYCRecord.read",
        "%%rbac role:auditor on KYCRecord.read\n%%rbac role:admin on Site.read"
      ),
      { projectName: "field-service", outputDir: "/tmp/unused" } as never
    );
    const pack = buildReportingPack(model, {
      projectName: "field-service",
      databaseName: "field_service",
    });
    const functional = pack.access.roles.find((role) => role.declaredAs === "admin");
    expect(functional).toBeDefined();
    expect(functional?.isAdmin).toBe(false);
    expect(functional?.name.toLowerCase()).not.toBe("admin");
    expect(functional?.name.toLowerCase()).not.toBe("administrator");
    // Only the real administrator keeps the reserved name.
    const reserved = pack.access.roles.filter((role) =>
      ["admin", "administrator"].includes(role.name.toLowerCase())
    );
    expect(reserved.every((role) => role.isAdmin)).toBe(true);
  });

  it("gives the administrator an empty scope and the User role an empty one too", async () => {
    const pack = await build();
    const admin = pack.access.roles.find((role) => role.isAdmin);
    const user = pack.access.roles.find((role) => role.declaredAs === "user");

    // Both are `[]`, and they mean opposite things — `isAdmin` is what tells
    // them apart, which is why every reader has to check it rather than the
    // length. Reading an empty list as "unrestricted" gave the account holding
    // no functional role permission to read the whole schema.
    expect(admin?.tables).toEqual([]);
    expect(user?.tables).toEqual([]);
    expect(admin?.isAdmin).toBe(true);
    expect(user?.isAdmin).toBe(false);
  });

  it("keeps the two sides' addresses and passwords apart", async () => {
    const pack = await build();
    const dispatcher = pack.access.roles.find((r) => r.declaredAs === "dispatcher");

    // Identical addresses would invite a reader to try one password on both.
    expect(dispatcher?.email).toBe("dispatcher@field-service.reports.example.com");
    expect(dispatcher?.appEmail).toBe("dispatcher@field-service.example.com");
    expect(pack.access.appPassword).not.toBe(pack.access.reportPassword);

    // The administrator is the exception: the platform bootstraps that address
    // for itself, so it is the same address and still two different accounts.
    const admin = pack.access.roles.find((role) => role.isAdmin);
    expect(admin?.email).toBe(admin?.appEmail);
  });

  it("refuses a pack whose items would collapse into one row", async () => {
    // The platform upserts by name, so two items sharing a name are one row
    // written twice — and which query survives depends on insertion order.
    const clashing = MODEL.replace("title: Open tickets by site", "title: Tickets per site");
    const model = await parseModel(clashing, {
      projectName: "field-service",
      outputDir: "/tmp/unused",
    } as never);
    // The authored one wins and the derived duplicate is dropped rather than
    // throwing — the throw is reserved for a collision nothing can resolve.
    const pack = buildReportingPack(model, {
      projectName: "field-service",
      databaseName: "field_service",
    });
    const named = pack.reports.filter((report) => report.name === "Tickets per site");
    expect(named).toHaveLength(1);
    expect(named[0]?.key).toBe("authored__open-by-site");
  });

  it("records no timestamp unless the caller supplies one", async () => {
    // Generation is compared byte for byte — CI generates the browser stack
    // twice and diffs the trees — so a clock reading invented here fails a
    // comparison on a file nothing is wrong with.
    const pack = await build();
    expect(pack.application.generatedAt).toBeUndefined();

    const stamped = buildReportingPack(await parse(), {
      projectName: "field-service",
      databaseName: "field_service",
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(stamped.application.generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("reserved words as column labels", () => {
  it("quotes AS case so the platform can read which tables a query touches", async () => {
    const { quoteReservedAliases } = await import("../pack");
    expect(quoteReservedAliases("SELECT p.subject AS case, 1 AS n FROM bus_case p")).toBe(
      'SELECT p.subject AS "case", 1 AS n FROM bus_case p'
    );
    expect(quoteReservedAliases('SELECT x AS "case", y AS cases, z AS Order')).toBe(
      'SELECT x AS "case", y AS cases, z AS "Order"'
    );
  });
});
