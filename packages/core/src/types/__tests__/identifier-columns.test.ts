/**
 * Tests for what the Application Dictionary calls a record.
 *
 * `identifierColumnNames` is the one rule both stacks read: it fills
 * `sys_column.is_identifier`, and every screen that shows a foreign key —
 * the lookup dropdown, the grid cell, the record title — turns a uuid back
 * into words with it. Getting it wrong does not fail anywhere; it just prints
 * uuids at people, which is why it is worth pinning down.
 */

import { describe, expect, it } from "vitest";
import { identifierColumnNames } from "../bus-entity.types";

type Column = {
  name: string;
  type?: string;
  unique?: boolean;
  isForeignKey?: boolean;
};

const columns = (...names: Array<string | Column>): Column[] =>
  names.map((entry) =>
    typeof entry === "string" ? { name: entry, type: "string" } : { type: "string", ...entry }
  );

const fk = (name: string): Column => ({ name, type: "string", isForeignKey: true });

describe("identifierColumnNames", () => {
  it("prefers a column that names the record outright", () => {
    expect(identifierColumnNames(columns("id", "name", "status"), "id")).toEqual(["name"]);
    expect(identifierColumnNames(columns("id", "subject", "body"), "id")).toEqual(["subject"]);
  });

  it("joins a first and last name, which only mean anything together", () => {
    expect(identifierColumnNames(columns("id", "first_name", "last_name", "email"), "id")).toEqual([
      "first_name",
      "last_name",
    ]);
  });

  it("takes a code when there is no name, because people quote codes", () => {
    expect(identifierColumnNames(columns("id", "code", "notes"), "id")).toEqual(["code"]);
  });

  it("never marks the key, which would put a uuid at the front of every label", () => {
    for (const declared of [
      columns("id", "name"),
      columns("id", "first_name", "last_name"),
      columns("id", "code"),
      columns("id", "notes"),
    ]) {
      expect(identifierColumnNames(declared, "id")).not.toContain("id");
    }
  });

  describe("a join entity, whose identity is the records it joins", () => {
    /* `CampaignMember` is a campaign and a contact. Nothing about it names it,
       and `member_status` — the first readable column — says what the record is
       doing rather than which record it is. */
    const campaignMember = [
      { name: "id", type: "string" },
      fk("campaign_id"),
      fk("contact_id"),
      { name: "member_status", type: "string" },
      { name: "joined_at", type: "datetime" },
    ];

    it("labels itself by its two parents, not by its status", () => {
      expect(identifierColumnNames(campaignMember, "id")).toEqual(["campaign_id", "contact_id"]);
    });

    it("takes only the first two, because a label from four parents is not a name", () => {
      const wide = [
        { name: "id", type: "string" },
        fk("order_id"),
        fk("product_id"),
        fk("warehouse_id"),
        fk("carrier_id"),
      ];
      expect(identifierColumnNames(wide, "id")).toEqual(["order_id", "product_id"]);
    });

    it("does not fire when the entity names itself", () => {
      const named = [
        { name: "id", type: "string" },
        { name: "name", type: "string" },
        fk("account_id"),
        fk("owner_id"),
      ];
      expect(identifierColumnNames(named, "id")).toEqual(["name"]);
    });

    it("does not fire for a person who merely has two references", () => {
      const contact = [
        { name: "id", type: "string" },
        fk("account_id"),
        fk("owner_id"),
        { name: "first_name", type: "string" },
        { name: "last_name", type: "string" },
      ];
      expect(identifierColumnNames(contact, "id")).toEqual(["first_name", "last_name"]);
    });

    it("leaves a single reference to the readable column beside it", () => {
      /* One parent is not a join: `street` says more about an address than the
         contact it hangs off does. */
      const address = [
        { name: "id", type: "string" },
        fk("contact_id"),
        { name: "street", type: "string" },
      ];
      expect(identifierColumnNames(address, "id")).toEqual(["street"]);
    });

    it("ignores a reference the generator cannot resolve to a table", () => {
      /* Without the `_id`/`_by` ending there is no parent to resolve, so these
         are not the pair that names the record. */
      const loose = [
        { name: "id", type: "string" },
        { name: "vendor", type: "string", isForeignKey: true },
        { name: "buyer", type: "string", isForeignKey: true },
        { name: "memo", type: "string" },
      ];
      expect(identifierColumnNames(loose, "id")).toEqual(["memo"]);
    });
  });

  it("falls back to the first readable column, and to nothing at all", () => {
    expect(identifierColumnNames(columns("id", "notes"), "id")).toEqual(["notes"]);
    expect(
      identifierColumnNames(
        [
          { name: "id", type: "string" },
          { name: "quantity", type: "integer" },
        ],
        "id"
      )
    ).toEqual([]);
  });

  describe("a record with no free text of its own", () => {
    const pack = [
      { name: "id", type: "string" },
      { name: "member_id", type: "string", isForeignKey: true },
      { name: "credits", type: "integer" },
      { name: "purchased_on", type: "date" },
      { name: "status", type: "string", enumReferenceId: 1042 },
    ];

    it("is not named by its status, a closed vocabulary", () => {
      expect(identifierColumnNames(pack, "id")).not.toContain("status");
    });

    it("is named by whose it is and when", () => {
      // Found in a generated app: a booking's Class Pack read "active".
      expect(identifierColumnNames(pack, "id")).toEqual(["member_id", "purchased_on"]);
    });

    it("still prefers a free-text column beside the status", () => {
      expect(identifierColumnNames([...pack, { name: "notes", type: "string" }], "id")).toEqual([
        "notes",
      ]);
    });

    it("has none with no parent or no date to say", () => {
      expect(identifierColumnNames(pack.filter((a) => a.name !== "purchased_on"), "id")).toEqual(
        []
      );
    });
  });
});
