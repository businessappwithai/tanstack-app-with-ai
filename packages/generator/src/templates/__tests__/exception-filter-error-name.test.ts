/**
 * Regression: a 403 from the Electric shape proxy said `"error": "Internal Server Error"`.
 *
 * The exception filter started `error` at "Internal Server Error" and only
 * replaced it when the exception's response was an object. `new HttpException(
 * 'text', HttpStatus.FORBIDDEN)` carries a bare string, so every such refusal
 * kept the 500 label beside a 403 status. The classifier now owns the reason
 * phrase, so this holds the behaviour rather than the text of a template.
 *
 * Found by /qa on 2026-10-21 (Electric proxy probe, airport model).
 */

import { HttpException, HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { classify } from "../../../templates/tanstack-start-nestjs/backend/src/common/errors/classify";

describe("the exception classifier's reason phrase", () => {
  it("names the status when the HttpException response is a bare string", () => {
    const result = classify(new HttpException("no shape for you", HttpStatus.FORBIDDEN));
    expect(result.status).toBe(403);
    expect(result.error).toBe("Forbidden");
    expect(result.message).toBe("no shape for you");
  });
});
