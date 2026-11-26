/**
 * A constraint violation in the browser stack answers with the status it
 * deserves, not a 500.
 *
 * PGlite raises a constraint violation as a plain error carrying Postgres's
 * SQLSTATE, and `errorResponse` used to turn every such error into a 500 that
 * quoted the raw message — a duplicate account number read as the server
 * breaking, and a malformed id leaked `invalid input syntax for type uuid`.
 * The NestJS stack maps the same codes in its exception filter; these hold the
 * browser stack to the same answers, against a real PGlite so the test fails
 * if the driver ever stops reporting `code` and `detail` the way the mapping
 * reads them.
 */

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error — plain JavaScript shipped into generated applications
import { errorResponse, notFound } from "../../../../templates/wasm/server/lib/http.js";

let pg: PGlite;

/** The error a statement raises, or null when it succeeded. */
async function errorFrom(sql: string): Promise<unknown> {
  try {
    await pg.exec(sql);
    return null;
  } catch (error) {
    return error;
  }
}

async function answer(error: unknown, method = "POST") {
  const response: Response = errorResponse(error, method);
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(`
    CREATE TABLE parent (id uuid PRIMARY KEY, code text UNIQUE NOT NULL);
    CREATE TABLE child (id uuid PRIMARY KEY, parent_id uuid REFERENCES parent(id), label varchar(5));
    INSERT INTO parent VALUES ('00000000-0000-0000-0000-000000000001', 'ACC-1');
    INSERT INTO child VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'a');
  `);
});

afterAll(async () => {
  await pg.close();
});

describe("database errors in the browser stack", () => {
  it("answers a duplicate unique value with 409, naming the column and not the value", async () => {
    const error = await errorFrom(
      "INSERT INTO parent VALUES ('00000000-0000-0000-0000-000000000003', 'ACC-1')"
    );
    const { status, body } = await answer(error);
    expect(status).toBe(409);
    expect(body.message).toBe("A record with the same value (code) already exists.");
    expect(JSON.stringify(body)).not.toContain("ACC-1");
  });

  it("answers a malformed id with 400 instead of leaking the driver's message", async () => {
    const error = await errorFrom("SELECT * FROM parent WHERE id = 'undefined'");
    const { status, body } = await answer(error, "GET");
    expect(status).toBe(400);
    expect(body.message).toBe("A value was not valid for its column type.");
  });

  it("answers a missing required field with 400", async () => {
    const error = await errorFrom(
      "INSERT INTO parent (id) VALUES ('00000000-0000-0000-0000-000000000004')"
    );
    const { status, body } = await answer(error);
    expect(status).toBe(400);
    expect(body.message).toBe("A required field (code) was missing.");
  });

  it("tells a dangling reference from deleting a referenced parent", async () => {
    const dangling = await errorFrom(
      "INSERT INTO child VALUES ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000dead', 'b')"
    );
    expect((await answer(dangling, "POST")).status).toBe(400);

    const referenced = await errorFrom(
      "DELETE FROM parent WHERE id = '00000000-0000-0000-0000-000000000001'"
    );
    const { status, body } = await answer(referenced, "DELETE");
    expect(status).toBe(409);
    expect(body.message).toBe("This record is still referenced by other records.");
  });

  it("answers a value too long for its column with 400", async () => {
    const error = await errorFrom(
      "INSERT INTO child VALUES ('00000000-0000-0000-0000-000000000006', NULL, 'far too long')"
    );
    expect((await answer(error)).status).toBe(400);
  });

  it("still answers an unexpected error with 500, and an HTTP error with its own status", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      expect((await answer(new Error("something else"))).status).toBe(500);
    } finally {
      console.error = original;
    }
    expect((await answer(notFound("Nothing here"))).status).toBe(404);
  });
});
