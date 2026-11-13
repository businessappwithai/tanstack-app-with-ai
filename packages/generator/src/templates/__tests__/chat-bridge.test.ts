/**
 * The chat assistant's switches, and chat-only mode, in a generated application.
 *
 * An orchestrator can put a chat assistant in front of a generated application.
 * `backend/src/common/chat-bridge.ts` is what lets the application tell a
 * request that came through the assistant from one that did not, so that the
 * administrator's "chat only" switch can be enforced on the server rather than
 * hoped for in the browser. These hold the decision, and that each piece
 * reaches a generated application.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRIDGE_HEADER,
  cameThroughChat,
  chatOnlyRefuses,
  forgetChatSwitches,
  readChatSwitches,
  verifyStatement,
} from "../../../templates/tanstack-start-nestjs/backend/src/common/chat-bridge";

const TEMPLATES = resolve(__dirname, "../../../templates");
const read = (path: string): string => readFileSync(resolve(TEMPLATES, path), "utf8");

const SECRET = "a-secret-that-is-long-enough-to-be-accepted";
const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array | string) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** What the assistant's `signStatement` writes. */
async function sign(secret: string, claims: Record<string, unknown>): Promise<string> {
  const body = b64url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60, jti: "1", ...claims }));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return `${body}.${b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body))))}`;
}

/** A stand-in for the one query the module makes. */
const kyselyWith = (rows: Array<{ config_key: string; config_value: string; is_active?: boolean }>) => ({
  selectFrom: () => ({
    select: () => ({
      where: () => ({ execute: async () => rows.map((row) => ({ is_active: true, ...row })) }),
    }),
  }),
});

const CHAT_ONLY = kyselyWith([
  { config_key: "CHAT_ENABLED", config_value: "true" },
  { config_key: "CHAT_ONLY_MODE", config_value: "true" },
]);
const env = { CHAT_BRIDGE_SECRET: SECRET };

describe("the administrator's switches", () => {
  it("default to enabled and not chat-only when the rows do not exist", async () => {
    expect(await readChatSwitches(kyselyWith([]))).toEqual({ enabled: true, chatOnly: false });
  });

  it("are read from sys_system, and an inactive row is as good as absent", async () => {
    expect(await readChatSwitches(CHAT_ONLY)).toEqual({ enabled: true, chatOnly: true });
    expect(
      await readChatSwitches(
        kyselyWith([{ config_key: "CHAT_ONLY_MODE", config_value: "true", is_active: false }])
      )
    ).toEqual({ enabled: true, chatOnly: false });
  });
});

describe("a request that came through the assistant", () => {
  it("is one carrying the embed cookie issued to that person", async () => {
    const cookie = `other=1; chat_embed=${await sign(SECRET, { aud: "embed", sub: "jane@example.com" })}`;
    expect(await cameThroughChat(SECRET, { cookie }, "Jane@Example.com")).toBe(true);
    expect(await cameThroughChat(SECRET, { cookie }, "john@example.com")).toBe(false);
  });

  it("or one carrying the assistant's own header", async () => {
    const header = await sign(SECRET, { aud: "bridge", sub: "assistant" });
    expect(await cameThroughChat(SECRET, { [BRIDGE_HEADER]: header }, "jane@example.com")).toBe(true);
  });

  it("and nothing forged, expired or meant for something else", async () => {
    const forged = await sign("another-secret-of-sufficient-length-xx", { aud: "embed", sub: "jane@example.com" });
    const stale = await sign(SECRET, { aud: "embed", sub: "jane@example.com", exp: 1 });
    const wrongUse = await sign(SECRET, { aud: "report-delegate", sub: "jane@example.com" });
    for (const value of [forged, stale, wrongUse, "garbage", ""]) {
      expect(await cameThroughChat(SECRET, { cookie: `chat_embed=${value}` }, "jane@example.com")).toBe(false);
      expect(await cameThroughChat(SECRET, { [BRIDGE_HEADER]: value }, "jane@example.com")).toBe(false);
    }
    expect(await verifyStatement(SECRET, null, "embed")).toBeNull();
  });
});

describe("chat-only mode", () => {
  const base = { kysely: CHAT_ONLY, headers: {}, email: "jane@example.com", isMaster: false, env };

  it("refuses a request that did not come through the assistant", async () => {
    forgetChatSwitches();
    expect(await chatOnlyRefuses(base)).toBe(true);
  });

  it("lets the same person through when it did", async () => {
    forgetChatSwitches();
    const cookie = `chat_embed=${await sign(SECRET, { aud: "embed", sub: "jane@example.com" })}`;
    expect(await chatOnlyRefuses({ ...base, headers: { cookie } })).toBe(false);
  });

  it("never refuses an administrator", async () => {
    forgetChatSwitches();
    expect(await chatOnlyRefuses({ ...base, isMaster: true })).toBe(false);
  });

  it("locks nothing when the switch is off, the secret is missing, or the switches cannot be read", async () => {
    forgetChatSwitches();
    expect(await chatOnlyRefuses({ ...base, kysely: kyselyWith([]) })).toBe(false);
    forgetChatSwitches();
    expect(await chatOnlyRefuses({ ...base, env: {} })).toBe(false);
    forgetChatSwitches();
    const broken = { selectFrom: () => { throw new Error("database is down"); } };
    expect(await chatOnlyRefuses({ ...base, kysely: broken })).toBe(false);
  });
});

describe("every piece reaches a generated application", () => {
  it("the module is copied into the backend — nothing scans that directory", () => {
    const generator = readFileSync(
      resolve(__dirname, "../../generators/tanstack-start-nestjs/nestjs-backend.generator.ts"),
      "utf8"
    );
    expect(generator).toContain('path.join(outputDir, "src/common/chat-bridge.ts")');
  });

  it("the session guard asks, and lets the refusal through as a 403", () => {
    const guard = read("tanstack-start-nestjs/backend/src/modules/auth/guards/session-auth.guard.ts.hbs");
    expect(guard).toContain("chatOnlyRefuses(");
    expect(guard).toContain("details: { code: CHAT_ONLY_CODE }");
    // An administrator whose access could not be read is not refused.
    expect(guard).toContain("isMaster: request.user.isMaster !== false");
    // Without this the catch below turns the refusal into a 503 "try again".
    expect(guard).toContain("error instanceof ForbiddenException");
  });

  it("both switches are seeded as booleans and served to the assistant", () => {
    const seed = read("common/seeds/system-config.ts.hbs");
    for (const key of ["CHAT_ENABLED", "CHAT_ONLY_MODE"]) {
      expect(seed).toMatch(new RegExp(`config_key: '${key}',\\s+config_value: '(true|false)',\\s+data_type: 'boolean'`));
    }
    const controller = read("tanstack-start-nestjs/backend/src/modules/sys/sys.controller.ts.hbs");
    expect(controller).toContain("chatEnabled: this.systemConfigService.getBoolean('CHAT_ENABLED', true)");
    expect(controller).toContain("chatOnlyMode: this.systemConfigService.getBoolean('CHAT_ONLY_MODE', false)");
  });

  it("the front end goes to the assistant on CHAT_ONLY, and draws no chrome or sign-in page inside a frame", () => {
    const client = read("tanstack-start-nestjs/frontend/src/lib/api-client.ts");
    expect(client).toContain('refusal?.details?.code === "CHAT_ONLY"');
    expect(client).toContain("window.location.replace(CHAT_PATH)");
    const layout = read("tanstack-start-nestjs/frontend/src/components/layout/app-layout.tsx");
    expect(layout).toContain('data-embedded="true"');
    const auth = read("tanstack-start-nestjs/frontend/src/contexts/auth-context.tsx");
    expect(auth).toContain('postMessage({ type: "app:signed-out" }, window.location.origin)');
  });
});
