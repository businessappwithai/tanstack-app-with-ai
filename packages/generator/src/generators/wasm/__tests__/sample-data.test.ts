/**
 * Tests for the browser stack's sample data.
 *
 * The properties worth holding are the ones that make the rows usable rather
 * than merely present: a foreign key that resolves to a row that exists, a
 * value shaped by the column's reference type, and a second run that produces
 * the same records as the first.
 */

import { describe, expect, it } from "vitest";
import { parseModel } from "../../../pipeline/parse-model";
import { buildSampleData } from "../sample-data";

const MODEL = `%%meta name: Sample Data Probe
%%meta kind: erd

%%enum OrderStatus: draft, placed, shipped, cancelled

erDiagram
    User {
        string id PK
        string full_name
        email  email UK
        boolean is_active
    }
    Vendor {
        string  id PK
        string  vendor_code UK
        string  name
        email   email OPTIONAL
        phone   phone OPTIONAL
        url     website OPTIONAL
        color   brand_colour OPTIONAL
    }
    Order {
        string   id PK
        string   vendor_id FK
        string   created_by_id FK
        string   status
        integer  quantity
        money    total_amount
        date     order_date
        datetime submitted_at OPTIONAL
        text     notes OPTIONAL
        json     payload OPTIONAL
        boolean  is_rush
    }
    Vendor ||--o{ Order : "supplies"
    User   ||--o{ Order : "raises"

%%field Order.status enum: OrderStatus
`;

const parsed = parseModel([MODEL]);
const data = buildSampleData(parsed, { records: 10, seed: "test" });

const rows = (table: string) => data[table] as Array<Record<string, unknown>>;

describe("sample data", () => {
  it("generates the requested number of rows for every entity", () => {
    expect(Object.keys(data)).toHaveLength(3);
    for (const table of Object.keys(data)) expect(rows(table)).toHaveLength(10);
  });

  it("generates nothing when no records are asked for", () => {
    expect(buildSampleData(parsed, { records: 0 })).toEqual({});
  });

  it("emits parents before the children that reference them", () => {
    const order = Object.keys(data);
    expect(order.indexOf("bus_vendor")).toBeLessThan(order.indexOf("bus_order"));
    expect(order.indexOf("bus_user")).toBeLessThan(order.indexOf("bus_order"));
  });

  it("points every foreign key at a row that exists", () => {
    const vendors = new Set(rows("bus_vendor").map((row) => row.id));
    const users = new Set(rows("bus_user").map((row) => row.id));
    for (const order of rows("bus_order")) {
      expect(vendors.has(order.vendor_id)).toBe(true);
      /* `created_by_id` resolves to the user entity by name, not to a
         `CreatedBy` table — the rule the dictionary uses for Table Direct. */
      expect(users.has(order.created_by_id)).toBe(true);
    }
  });

  it("takes enumerated columns from the declared vocabulary", () => {
    const allowed = new Set(["draft", "placed", "shipped", "cancelled"]);
    for (const order of rows("bus_order")) expect(allowed.has(order.status as string)).toBe(true);
  });

  it("shapes each value by its reference type", () => {
    for (const order of rows("bus_order")) {
      expect(typeof order.quantity).toBe("number");
      expect(Number.isInteger(order.quantity)).toBe(true);
      expect(typeof order.total_amount).toBe("number");
      expect(typeof order.is_rush).toBe("boolean");
      expect(order.order_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (order.submitted_at !== null) {
        expect(order.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
      if (order.payload !== null) expect(typeof order.payload).toBe("object");
    }

    for (const vendor of rows("bus_vendor")) {
      if (vendor.email !== null) expect(vendor.email).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/);
      if (vendor.phone !== null) expect(vendor.phone).toMatch(/^\+\d/);
      if (vendor.website !== null) expect(vendor.website).toMatch(/^https:\/\//);
      /* The `color` alias normalises to `string` for SQL, and the parser keeps
         the word on the attribute so the dictionary can still record COLOR —
         which is what makes this a hex rather than a sentence. */
      if (vendor.brand_colour !== null) expect(vendor.brand_colour).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("keeps unique columns unique", () => {
    const codes = rows("bus_vendor").map((row) => row.vendor_code);
    expect(new Set(codes).size).toBe(codes.length);
    const emails = rows("bus_user").map((row) => row.email);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it("draws a unique foreign key without replacement", () => {
    /* A `FK UK` column is a one-to-one. Drawn with replacement, two children
       take the same parent and the second insert dies on the unique index —
       silently, one row at a time. The hospital model seeded ten doctors over
       ten staff and got nine rows back, and ten nurses over the same staff got
       six; the dashboard simply showed the smaller number. */
    const oneToOne = parseModel([
      `%%meta name: Unique FK Probe
%%meta kind: erd
erDiagram
    Staff {
        string id PK
        string full_name
    }
    Doctor {
        string id PK
        string staff_id FK UK
        string specialty
    }
    Staff ||--o{ Doctor : "is"
`,
    ]);
    const generated = buildSampleData(oneToOne, { records: 8, seed: "test" });
    const doctors = generated.bus_doctor as Array<Record<string, unknown>>;
    const staffIds = doctors.map((row) => row.staff_id);

    expect(doctors).toHaveLength(8);
    /* Distinct, non-null, and every one a staff row that exists. */
    expect(new Set(staffIds).size).toBe(staffIds.length);
    const staff = new Set(
      (generated.bus_staff as Array<Record<string, unknown>>).map((row) => row.id)
    );
    for (const id of staffIds) expect(staff.has(id)).toBe(true);
  });

  it("leaves a unique foreign key null rather than duplicating a parent", () => {
    /* Four children over two parents: two of them cannot have a value, and a
       duplicate would be refused on insert anyway. Null is the honest answer,
       and it must not be a repeat of one already taken. */
    const tooFew = parseModel([
      `%%meta name: Scarce Parent Probe
%%meta kind: erd
erDiagram
    Locker {
        string id PK
        string code UK
    }
    Tenant {
        string id PK
        string name
        string locker_id FK UK OPTIONAL
    }
    Locker ||--o{ Tenant : "assigned_to"
`,
    ]);
    const generated = buildSampleData(tooFew, { records: 4, seed: "test" });
    const assigned = (generated.bus_tenant as Array<Record<string, unknown>>)
      .map((row) => row.locker_id)
      .filter((id) => id !== null);

    expect(assigned.length).toBeLessThanOrEqual(
      (generated.bus_locker as Array<Record<string, unknown>>).length
    );
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("never leaves a required column empty", () => {
    for (const order of rows("bus_order")) {
      for (const column of [
        "id",
        "vendor_id",
        "status",
        "quantity",
        "total_amount",
        "order_date",
      ]) {
        expect(order[column]).not.toBeNull();
      }
    }
  });

  it("leaves some optional columns empty, so a screen looks real", () => {
    const optional = rows("bus_order").filter((row) => row.notes === null || row.payload === null);
    expect(optional.length).toBeGreaterThan(0);
  });

  it("produces the same rows for the same seed, and different rows for another", () => {
    expect(buildSampleData(parsed, { records: 10, seed: "test" })).toEqual(data);
    expect(buildSampleData(parsed, { records: 10, seed: "other" })).not.toEqual(data);
  });

  it("keeps parents first for an entity downstream of a cycle", () => {
    /* `User` and `Team` point at each other, and `Compound` merely wants a
       user to have registered it. The sort used to stall on the cycle and dump
       everything left in declaration order, so `Compound` came before `User`,
       its mandatory `registered_by_id` was null, and PostgreSQL refused every
       row — leaving the entity silently empty. */
    const cyclic = parseModel([
      `%%meta name: Cycle Probe
%%meta kind: erd
erDiagram
    Compound {
        string id PK
        string name
        string registered_by_id FK
    }
    User {
        string id PK
        string full_name
        string team_id FK OPTIONAL
    }
    Team {
        string id PK
        string name
        string manager_id FK OPTIONAL
    }
    User ||--o{ Compound : "registers"
    Team ||--o{ User : "employs"
    User ||--o{ Team : "manages"
`,
    ]);
    const generated = buildSampleData(cyclic, { records: 4, seed: "test" });
    const order = Object.keys(generated);
    expect(order.indexOf("bus_user")).toBeLessThan(order.indexOf("bus_compound"));

    const users = new Set(
      (generated.bus_user as Array<Record<string, unknown>>).map((row) => row.id)
    );
    for (const compound of generated.bus_compound as Array<Record<string, unknown>>) {
      /* The point of the ordering: a mandatory reference that a NOT NULL column
         would have rejected. */
      expect(compound.registered_by_id).not.toBeNull();
      expect(users.has(compound.registered_by_id)).toBe(true);
    }
  });

  it("fills the columns whose name, not type, decides what they hold", () => {
    /* Every one of these resolves to a faker generator chosen by the column's
       name. `country_code` is here because it did not merely read badly when it
       was wrong — `location.countryCode` lives in faker's `base` locale, and an
       instance built from `en` alone *threw*, so a model with a column of that
       name generated no application at all. */
    const named = parseModel([
      `%%meta name: Named Columns
%%meta kind: erd
erDiagram
    Office {
        string id PK
        string name
        string region
        string country_code
        string currency_code
        string job_title
        string city
    }
`,
    ]);
    const offices = buildSampleData(named, { records: 6, seed: "test" }).bus_office as Array<
      Record<string, unknown>
    >;

    for (const office of offices) {
      /* Two letters, not `OFF-1004` — the generic `*_code` rule used to win. */
      expect(office.country_code).toMatch(/^[A-Z]{2}$/);
      expect(office.currency_code).toMatch(/^[A-Z]{3}$/);
      for (const column of ["name", "region", "job_title", "city"]) {
        expect(typeof office[column]).toBe("string");
        expect((office[column] as string).length).toBeGreaterThan(0);
      }
    }
  });

  it("survives a model whose only reference is to itself", () => {
    const selfReferential = parseModel([
      `%%meta name: Self Reference
%%meta kind: erd
erDiagram
    Category {
        string id PK
        string name
        string category_id FK OPTIONAL
    }
    Category ||--o{ Category : "contains"
`,
    ]);
    const generated = buildSampleData(selfReferential, { records: 5, seed: "test" });
    const categories = generated.bus_category as Array<Record<string, unknown>>;
    expect(categories).toHaveLength(5);
    /* The first row has no earlier row to point at; later ones may. */
    expect(categories[0]?.category_id).toBeNull();
    const ids = new Set(categories.map((row) => row.id));
    for (const row of categories) {
      if (row.category_id !== null) expect(ids.has(row.category_id)).toBe(true);
    }
  });
});

describe("a required reference whose parent the model never declares", () => {
  /* `Document.document_type_id` with no `DocumentType` — the checker's EML502.
     Left null it fails NOT NULL, every row of the table is refused, and the
     entity gets no sample data. */
  const dangling = parseModel([
    `%%meta name: Dangling Reference Probe
%%meta kind: erd
erDiagram
    Party {
        string id PK
        string name
    }
    Document {
        string id PK
        string party_id FK
        string document_type_id FK
        string review_note_id FK OPTIONAL
        string file_name
    }
    Party ||--o{ Document : "holds"
`,
  ]);

  it("takes a uuid rather than null when the column is required", () => {
    const generated = buildSampleData(dangling, { records: 4, seed: "test" });
    const documents = generated.bus_document as Array<Record<string, unknown>>;
    expect(documents).toHaveLength(4);
    for (const row of documents) {
      expect(row.document_type_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.party_id).not.toBeNull();
    }
  });

  it("leaves an optional dangling reference null", () => {
    const generated = buildSampleData(dangling, { records: 4, seed: "test" });
    for (const row of generated.bus_document as Array<Record<string, unknown>>) {
      expect(row.review_note_id).toBeNull();
    }
  });
});
