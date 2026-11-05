/**
 * Two dashboards, or two reports, with one title are an error.
 *
 * The reporting platform upserts a dashboard by its title, so `buildReportingPack` refuses a pack where two
 * share one. The checker held a dashboard's *name* to be unique and not its title, so the dance-studio model
 * had two called "Rooms and capacity", checked clean, and failed only when the whole stack was generated.
 */

import { describe, expect, it } from "vitest";
import { checkSource } from "../../../../../language/checker";

const MODEL = (secondTitle: string) => `%%meta name: Field Service
%%meta kind: erd
%%meta version: 1.0.0
erDiagram
    Ticket {
        string id PK
        string title
    }
%%rbac role:dispatcher|engineer on Ticket.read
%%report open-tickets title: Open tickets chart: bar x: title y: n help: The open work. sql: SELECT title, 1 AS n FROM bus_ticket WHERE deleted_at IS NULL
%%report all-tickets title: All tickets chart: bar x: title y: n help: Everything. sql: SELECT title, 1 AS n FROM bus_ticket WHERE deleted_at IS NULL
%%report ticket-list title: Ticket list chart: bar x: title y: n help: The list. sql: SELECT title, 1 AS n FROM bus_ticket WHERE deleted_at IS NULL
%%dashboard dispatcher-board title: Work board role: dispatcher reports: open-tickets, all-tickets, ticket-list help: The dispatcher's board.
%%dashboard engineer-board title: ${secondTitle} role: engineer reports: open-tickets, all-tickets, ticket-list help: The engineer's board.
`;

const titleErrors = (source: string) =>
  checkSource(source).issues.filter((i) => i.code === "EML297" && /same title/.test(i.message));
const reportTitleErrors = (source: string) =>
  checkSource(source).issues.filter((i) => i.code === "EML292" && /same title/.test(i.message));

describe("dashboard titles", () => {
  it("refuses two dashboards with one title, whatever their names", () => {
    const found = titleErrors(MODEL("Work board"));
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.message).toContain('"engineer-board"');
    expect(found[0]?.message).toContain('"dispatcher-board"');
  });

  it("reads titles without regard to case or surrounding space", () => {
    expect(titleErrors(MODEL("  work BOARD "))).toHaveLength(1);
  });

  it("accepts dashboards whose titles differ", () => {
    expect(titleErrors(MODEL("Engineer work board"))).toHaveLength(0);
  });
});

describe("report titles", () => {
  const withReportTitle = (title: string) =>
    MODEL("Engineer work board").replace("title: All tickets chart", `title: ${title} chart`);

  it("refuses two reports with one title, whatever their names", () => {
    const found = reportTitleErrors(withReportTitle("Open tickets"));
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.message).toContain('"all-tickets"');
    expect(found[0]?.message).toContain('"open-tickets"');
  });

  it("reads titles without regard to case or surrounding space", () => {
    expect(reportTitleErrors(withReportTitle(" OPEN tickets"))).toHaveLength(1);
  });

  it("accepts reports whose titles differ", () => {
    expect(reportTitleErrors(MODEL("Engineer work board"))).toHaveLength(0);
  });
});

