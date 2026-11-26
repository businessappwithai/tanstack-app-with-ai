/**
 * An authored `%%dashboard` reaches the reporting pack.
 *
 * The overview is inferred from structure and is the same for everyone; these
 * are written for the role that opens them. The pack carries both, and the
 * authored one carries its role and exactly the tiles the author listed.
 */

import { describe, expect, it } from "vitest";
import { parseModel } from "../../pipeline/parse-model";
import { buildReportingPack } from "../pack";

const MODEL = `%%meta name: Field Service
%%meta kind: erd
%%meta version: 1.0.0
erDiagram
    Site {
        string id PK
        string name UK
    }
    Ticket {
        string id PK
        string title
        string site_id FK
    }
    Site ||--o{ Ticket : raises
%%report open-by-site title: Open tickets by site chart: bar x: site y: open sql: SELECT s.name AS site, COUNT(*) AS open FROM bus_ticket t JOIN bus_site s ON s.id = t.site_id WHERE t.deleted_at IS NULL GROUP BY 1
%%report ticket-list title: Every ticket sql: SELECT title FROM bus_ticket WHERE deleted_at IS NULL
%%report sites title: Sites chart: pie x: name y: n sql: SELECT name, 1 AS n FROM bus_site WHERE deleted_at IS NULL
%%dashboard dispatcher-morning title: Dispatcher morning role: dispatcher reports: open-by-site, ticket-list, sites help: What the dispatcher checks first.
%%rbac role:dispatcher on Ticket.read
`;

const build = async () =>
  buildReportingPack(
    await parseModel(MODEL, { projectName: "field-service", outputDir: "/tmp/unused" } as never),
    { projectName: "field-service", databaseName: "field_service" }
  );

describe("authored dashboards in the reporting pack", () => {
  it("carries the overview first and then one dashboard per %%dashboard", async () => {
    const pack = await build();
    expect(pack.dashboards.map((d) => d.key)).toEqual(["overview", "authored__dispatcher-morning"]);
  });

  it("records the role and the author's description", async () => {
    const authored = (await build()).dashboards[1];
    expect(authored?.role).toBe("dispatcher");
    expect(authored?.name).toBe("Dispatcher morning");
    expect(authored?.description).toBe("What the dispatcher checks first.");
  });

  it("shows the listed reports in order: a chart half a row wide, a table a full row", async () => {
    const widgets = (await build()).dashboards[1]?.widgets ?? [];
    expect(widgets.map((w) => w.chartKey ?? w.reportKey)).toEqual([
      "authored__open-by-site",
      "authored__ticket-list",
      "authored__sites",
    ]);
    expect(widgets[0]).toMatchObject({ chartKey: "authored__open-by-site", x: 0, y: 0, w: 6 });
    // The table does not share a row with a chart: it takes the next one, whole.
    expect(widgets[1]).toMatchObject({ reportKey: "authored__ticket-list", x: 0, y: 4, w: 12 });
    expect(widgets[2]).toMatchObject({ chartKey: "authored__sites", x: 0, y: 8, w: 6 });
  });

  it("gives the overview no role", async () => {
    expect((await build()).dashboards[0]?.role).toBeUndefined();
  });
});
