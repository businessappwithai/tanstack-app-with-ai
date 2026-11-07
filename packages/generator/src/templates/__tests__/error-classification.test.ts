/**
 * What the generated application does with an exception.
 *
 * The classifier is plain TypeScript with no Fastify in it, copied verbatim
 * into every generated backend, so it is imported here from the template tree
 * and driven with the values a real request would raise: a Nest exception, an
 * `AppError`, a `pg` driver error, a socket error, a string.
 *
 * The committed `catalogue.ts` beside it is derived from the log spec; the
 * last block fails when the two disagree, which is the only way a generated
 * file kept in the template tree can be trusted.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BadRequestException, ConflictException, HttpException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { generatedErrorCatalogue } from "../../logging/generated-spec";
import { appError } from "../../../templates/tanstack-start-nestjs/backend/src/common/errors/app-error";
import { classify } from "../../../templates/tanstack-start-nestjs/backend/src/common/errors/classify";

const ERRORS_DIR = join(
  import.meta.dirname,
  "../../../templates/tanstack-start-nestjs/backend/src/common/errors"
);

describe("an error the application throws on purpose", () => {
  it("answers with the status, category and code the catalogue declares", () => {
    const result = classify(appError("VERSION_CONFLICT", { details: { entity: "Order" } }));
    expect(result.status).toBe(409);
    expect(result.category).toBe("conflict");
    expect(result.code).toBe("VERSION_CONFLICT");
    expect(result.details).toMatchObject({ code: "VERSION_CONFLICT", category: "conflict", entity: "Order" });
    expect(result.level).toBe("info");
  });

  it("keeps its own message where the category exposes it", () => {
    const result = classify(appError("RULE_REFUSED", { message: "Discount may not exceed 40%." }));
    expect(result.message).toBe("Discount may not exceed 40%.");
  });

  it("replaces its message with the catalogue's where the category does not", () => {
    const result = classify(
      appError("TRANSITION_FORBIDDEN", { message: "Role clerk may not press Close on Order 17." })
    );
    expect(result.status).toBe(403);
    expect(result.message).not.toContain("clerk");
  });
});

describe("an exception that predates the catalogue", () => {
  it("is categorised by the code it already carries", () => {
    const legacy = new ConflictException({
      message: "This record was changed by someone else after you opened it.",
      error: "Conflict",
      details: { code: "VERSION_CONFLICT", entity: "Order", currentVersion: 4 },
    });
    const result = classify(legacy);
    expect(result.code).toBe("VERSION_CONFLICT");
    expect(result.category).toBe("conflict");
    expect(result.message).toContain("changed by someone else");
    expect(result.details).toMatchObject({ currentVersion: 4 });
  });

  it("is categorised by its status when it carries none", () => {
    expect(classify(new NotFoundException("Order not found")).category).toBe("not_found");
    expect(classify(new BadRequestException("bad")).category).toBe("validation");
    expect(classify(new HttpException("slow down", 429)).category).toBe("rate_limit");
  });

  it("keeps the message of a 4xx and drops the message of a 5xx", () => {
    expect(classify(new HttpException("you cannot", 403)).message).toBe("you cannot");
    const failed = classify(new HttpException("connect ECONNREFUSED 10.0.0.4:5432", 503));
    expect(failed.message).not.toContain("10.0.0.4");
    expect(failed.category).toBe("integration");
  });
});

describe("a database error", () => {
  const driver = (fields: Record<string, unknown>) => Object.assign(new Error("db"), fields);

  it("reads a unique violation as a conflict, naming columns and never values", () => {
    const result = classify(
      driver({ code: "23505", detail: "Key (smiles)=(CC(=O)O) already exists.", constraint: "u" })
    );
    expect(result.status).toBe(409);
    expect(result.code).toBe("UNIQUE_VIOLATION");
    expect(result.message).toContain("smiles");
    expect(result.message).not.toContain("CC(=O)O");
  });

  it("reads a foreign key as a conflict on delete and a bad request otherwise", () => {
    expect(classify(driver({ code: "23503" }), "DELETE").status).toBe(409);
    expect(classify(driver({ code: "23503" }), "POST").status).toBe(400);
  });

  it("reads a missing required field as validation", () => {
    const result = classify(driver({ code: "23502", column: "legal_name" }));
    expect(result.category).toBe("validation");
    expect(result.message).toContain("legal name");
  });

  it("reads a database that is down as unavailable, not as the caller's fault", () => {
    for (const code of ["ECONNREFUSED", "08006", "53300", "57P01"]) {
      const result = classify(driver({ code }));
      expect(result.code, code).toBe("DATABASE_UNAVAILABLE");
      expect(result.status).toBe(503);
      expect(result.level).toBe("error");
    }
  });

  it("reads any other SQLSTATE as a database error and hides the cause", () => {
    const result = classify(driver({ code: "42P01", message: 'relation "bus_secret" does not exist' }));
    expect(result.code).toBe("DATABASE_ERROR");
    expect(result.message).not.toContain("bus_secret");
  });
});

describe("anything else", () => {
  it("is internal, answers 500 and never says what it was", () => {
    for (const thrown of [new Error("password=hunter2 in config"), "a string", null, { a: 1 }]) {
      const result = classify(thrown);
      expect(result.status).toBe(500);
      expect(result.category).toBe("internal");
      expect(JSON.stringify(result)).not.toContain("hunter2");
    }
  });

  it("reads a framework error with a client status as a client error, message kept", () => {
    const result = classify(Object.assign(new Error("Body is too large"), { statusCode: 413 }));
    expect(result.status).toBe(413);
    expect(result.message).toBe("Body is too large");
    expect(result.level).not.toBe("error");
  });

  it("never logs a 4xx at error or a 5xx below it", () => {
    const thrown: unknown[] = [
      new NotFoundException(),
      new BadRequestException(),
      appError("FORBIDDEN"),
      new Error("x"),
      appError("DATABASE_UNAVAILABLE"),
    ];
    for (const exception of thrown) {
      const result = classify(exception);
      if (result.status < 500) expect(["warn", "info"]).toContain(result.level);
      else expect(["error", "fatal"]).toContain(result.level);
    }
  });
});

describe("the catalogue committed beside the classifier", () => {
  it("is exactly what the generator writes", () => {
    expect(readFileSync(join(ERRORS_DIR, "catalogue.ts"), "utf-8")).toBe(generatedErrorCatalogue());
  });
});
