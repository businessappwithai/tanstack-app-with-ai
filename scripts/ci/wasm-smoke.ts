#!/usr/bin/env bun
/**
 * Exercise a generated browser application through its API.
 *
 * The application is meant to run in a tab, which is a poor place to assert
 * things from. So CI starts the identical `server/` code under the Node host
 * and drives it over HTTP — same routes, same PGlite build, same seed. What
 * this cannot see is the browser half (Service Worker, worker host, the UI);
 * what it can see is every decision the model turned into behaviour, which is
 * the half that changes when someone edits the generator.
 *
 *   bun scripts/ci/wasm-smoke.ts --base http://localhost:4700/api
 */

const baseIndex = process.argv.indexOf("--base");
const BASE = baseIndex >= 0 ? process.argv[baseIndex + 1]! : "http://localhost:4700/api";

/**
 * Which application is on the other end.
 *
 * `nestjs` is the real stack with the WASM overlay: better-auth signs in at
 * `/auth/sign-in/email` and there is no `/health`. `standalone` is the
 * self-contained browser runtime, whose sign-in is `/auth/login`. Everything
 * else — the dictionary, `/bus`, the audit trail — is the same shape in both,
 * which is the point.
 */
const stackIndex = process.argv.indexOf("--stack");
const STACK = stackIndex >= 0 ? process.argv[stackIndex + 1] : "standalone";
const IS_NEST = STACK === "nestjs";

let cookie = "";
/** The standalone runtime's session is a bearer token, not a cookie. */
let bearer = "";
let failures = 0;

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0]!;
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* a non-JSON body is a finding in itself, reported by the caller */
  }
  return {
    status: response.status,
    body: parsed as Record<string, unknown>,
    etag: response.headers.get("etag"),
  };
}

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${name}\n        ${(error as Error).message}`);
  }
}

function expect(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

console.log(`\nExercising ${BASE} (${STACK})\n`);

if (!IS_NEST) {
  await check("health reports a WebAssembly Postgres", async () => {
    const { status, body } = await call("GET", "/health");
    expect(status === 200, `status ${status}`);
    expect(String(body.database).includes("PGlite"), `database was ${body.database}`);
    expect(String(body.database).includes("wasm32"), "not a wasm build");
  });
}

await check("business routes refuse an anonymous caller", async () => {
  const { status } = await call("GET", "/bus/account");
  expect(status === 401, `expected 401, got ${status}`);
});

/** Filled in by the sign-in check; the reference columns below need a real id. */
let adminId = "";

const SIGN_IN = IS_NEST ? "/auth/sign-in/email" : "/auth/login";
const PASSWORD = IS_NEST ? "admin123" : "admin";

await check("a wrong password is refused", async () => {
  const { status } = await call("POST", SIGN_IN, {
    email: "admin@admin.com",
    password: "not-the-password",
  });
  expect(status >= 400, `expected a refusal, got ${status}`);
});

await check("the seeded administrator can sign in", async () => {
  const { status, body } = await call("POST", SIGN_IN, {
    email: "admin@admin.com",
    password: PASSWORD,
  });
  expect(status === 200, `status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
  const user = body.user as Record<string, unknown>;
  expect(!!user, "no user in the sign-in response");
  if (typeof body.token === "string") bearer = body.token;
  // Kept for the reference columns below: `owner_id` and friends are validated
  // as UUIDs, and inventing one would fail a foreign key on a stricter model.
  adminId = String(user.sysUserId ?? user.id ?? "");
  // better-auth reports the role as a string; the browser runtime as a flag.
  expect(
    IS_NEST ? user.role === "admin" : user.isAdmin === true,
    `the seeded administrator is not an admin: ${JSON.stringify(user).slice(0, 160)}`
  );
});

/** Both stacks answer with either a bare array or `{ data: [...] }`. */
const rowsOf = (body: unknown): unknown[] => {
  if (Array.isArray(body)) return body;
  const wrapped = (body as { data?: unknown }).data;
  return Array.isArray(wrapped) ? wrapped : [];
};

await check("the dictionary was seeded from the model", async () => {
  const { status, body } = await call("GET", "/sys/tables");
  expect(status === 200, `status ${status}`);
  expect(rowsOf(body).length >= 17, `only ${rowsOf(body).length} tables`);
});

await check("%%rbac created a role for every name it uses", async () => {
  const { body } = await call("GET", "/sys/roles");
  const rows = (Array.isArray(body) ? body : ((body as { data?: unknown[] }).data ?? [])) as Array<{
    name: string;
  }>;
  const names = rows.map((role) => role.name);
  expect(names.includes("Administrator"), `no Administrator role, got ${names.join(", ")}`);
  // The two stacks spell a model's role differently — the NestJS seeds keep
  // `%%rbac role:sales_manager` verbatim, the browser runtime titles it — and
  // both satisfy the directive, because the guards match case- and
  // separator-insensitively.
  const normalized = names.map((name) => name.toLowerCase().replace(/[\s_-]+/g, ""));
  expect(
    normalized.includes("salesmanager"),
    `no role for %%rbac's sales_manager, got ${names.join(", ")}`
  );
});

if (!IS_NEST) {
  await check("%%rbac restrictions were seeded", async () => {
    const { body } = await call("GET", "/auth/me/permissions");
    const operations = (body as { operations: unknown[] }).operations;
    const transitions = (body as { transitions: unknown[] }).transitions;
    expect(operations.length > 0, "no operation restrictions");
    // A state is moved by background workflows only, so %%rbac grants no
    // transition to anybody and none is seeded.
    expect(transitions.length === 0, `transition restrictions were seeded: ${transitions.length}`);
  });
}

await check("form fields come from the dictionary", async () => {
  const { status, body } = await call("GET", "/bus/account/fields/form");
  expect(status === 200, `status ${status}`);
  expect(rowsOf(body).length > 0, "no form fields");
});

let accountId = "";

await check("validation refuses an incomplete record", async () => {
  const { status } = await call("POST", "/bus/account", { name: "" });
  expect(status === 400, `expected 400, got ${status}`);
});

await check("a record can be created", async () => {
  const fields = rowsOf((await call("GET", "/bus/account/fields/form")).body) as Array<{
    column_name: string;
    is_mandatory: boolean;
    sys_reference_id: number;
  }>;

  const record: Record<string, unknown> = { name: "CI Account" };
  for (const field of fields) {
    if (!field.is_mandatory || field.column_name === "name" || field.column_name === "id") continue;
    // Mandatory list columns need one of their own values, which is what makes
    // this a check of the enum seed as well as of the write path.
    if (field.sys_reference_id >= 1000) {
      /*
       * Both spellings, because the two stacks read different ones: the WASM
       * runtime accepts `referenceId` or `sys_reference_id`, and NestJS only
       * the second. Sending `referenceId` alone asked NestJS for reference 0,
       * got an empty list, and fell through to the literal "x" below — which
       * the API accepted until it began validating enums, so this check had
       * been passing on a value no enum declares.
       */
      const values = rowsOf(
        (
          await call(
            "GET",
            `/sys/ref-list?sys_reference_id=${field.sys_reference_id}&referenceId=${field.sys_reference_id}`
          )
        ).body
      ) as Array<{ value: string }>;
      // No fallback. A mandatory list column with no values is a broken enum
      // seed, which is one of the things this script exists to catch — and
      // inventing a value here is what hid it.
      expect(
        Boolean(values[0]?.value),
        `no ref-list values for ${field.column_name} (reference ${field.sys_reference_id})`
      );
      record[field.column_name] = values[0]!.value;
    } else {
      // A reference column is validated as a UUID. Pointing it at the signed-in
      // administrator is the one id this script is certain exists.
      record[field.column_name] = /_id$/.test(field.column_name) ? adminId : "CI";
    }
  }

  const { status, body } = await call("POST", "/bus/account", record);
  expect(
    status === 200 || status === 201,
    `status ${status}: ${JSON.stringify(body).slice(0, 300)}`
  );
  accountId = String((body as { id?: string; data?: { id?: string } }).id ?? body.data?.id ?? "");
  expect(accountId && accountId !== "undefined", "the create returned no id");
});

/*
 * The record lifecycle. A lead's status starts at the machine's initial state
 * whatever the create sent, a write may not change it (administrator
 * included), and a move is made by pressing it — POST …/transition, along an
 * edge the diagram draws, against the version the record was read at.
 */
let leadId = "";

await check("a new record starts in its initial state, whatever the create sent", async () => {
  const fields = rowsOf((await call("GET", "/bus/lead/fields/form")).body) as Array<{
    column_name: string;
    is_mandatory: boolean;
    sys_reference_id: number;
  }>;
  expect(
    !fields.some((field) => field.column_name === "status"),
    "the state field is offered as a form input"
  );
  const record: Record<string, unknown> = { status: "qualified" };
  for (const field of fields) {
    if (!field.is_mandatory || field.column_name === "id") continue;
    if (field.sys_reference_id >= 1000) {
      const values = rowsOf(
        (
          await call(
            "GET",
            `/sys/ref-list?sys_reference_id=${field.sys_reference_id}&referenceId=${field.sys_reference_id}`
          )
        ).body
      ) as Array<{ value: string }>;
      expect(Boolean(values[0]?.value), `no ref-list values for ${field.column_name}`);
      record[field.column_name] = values[0]!.value;
    } else if (/_id$/.test(field.column_name)) {
      record[field.column_name] = adminId;
    } else if (/email/.test(field.column_name)) {
      record[field.column_name] = `ci-${Date.now()}@example.com`;
    } else {
      record[field.column_name] = "CI";
    }
  }
  const { status, body } = await call("POST", "/bus/lead", record);
  expect(status === 200 || status === 201, `status ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  const created = ((body as { data?: Record<string, unknown> }).data ?? body) as Record<string, unknown>;
  leadId = String(created.id ?? "");
  expect(created.status === "new", `expected status "new", got ${JSON.stringify(created.status)}`);
});

await check("a person's change to the state is refused", async () => {
  const { status, body } = await call("PATCH", `/bus/lead/${leadId}`, { status: "qualified" });
  expect(status === 403, `expected 403, got ${status}`);
  expect(
    JSON.stringify(body).includes("STATE_FIELD_SYSTEM_MANAGED"),
    `the refusal does not name STATE_FIELD_SYSTEM_MANAGED: ${JSON.stringify(body).slice(0, 300)}`
  );
});

await check("a move is pressed, along a drawn edge, against the version read", async () => {
  const read = await call("GET", `/bus/lead/${leadId}`);
  const etag = read.etag ?? "";
  expect(Boolean(etag), "the read carried no ETag");

  const bare = await call("POST", `/bus/lead/${leadId}/transition`, { event: "engage" });
  expect(bare.status === 428, `a press without If-Match should be 428, got ${bare.status}`);

  const undrawn = await call("POST", `/bus/lead/${leadId}/transition`, { to: "qualified" }, { "If-Match": etag });
  expect(undrawn.status === 409, `an undrawn move should be 409, got ${undrawn.status}`);
  expect(
    JSON.stringify(undrawn.body).includes("INVALID_TRANSITION"),
    `the refusal does not name INVALID_TRANSITION: ${JSON.stringify(undrawn.body).slice(0, 300)}`
  );

  const actions = rowsOf((await call("GET", `/bus/lead/${leadId}/actions`)).body) as Array<{ event: string }>;
  expect(
    actions.some((action) => action.event === "engage"),
    `the administrator is not offered "engage": ${JSON.stringify(actions)}`
  );

  const moved = await call("POST", `/bus/lead/${leadId}/transition`, { event: "engage" }, { "If-Match": etag });
  expect(moved.status === 200, `the press was refused: ${moved.status} ${JSON.stringify(moved.body).slice(0, 300)}`);
  const after = ((moved.body as { data?: Record<string, unknown> }).data ?? moved.body) as Record<string, unknown>;
  expect(after.status === "working", `expected "working", got ${JSON.stringify(after.status)}`);
  expect(Boolean(after.working_at), "the move did not stamp working_at");

  const stale = await call("POST", `/bus/lead/${leadId}/transition`, { event: "nurture" }, { "If-Match": etag });
  expect(stale.status === 409, `a press against an old version should be 409, got ${stale.status}`);
});

await check("the record comes back in a listing", async () => {
  const { body } = await call("GET", "/bus/account?limit=5");
  const rows = rowsOf(body) as Array<{ id: string }>;
  expect(
    rows.some((row) => row.id === accountId),
    "the created record is not in the list"
  );
});

await check("search matches it", async () => {
  const { body } = await call("GET", "/bus/account?search=CI%20Account");
  const total = (body as { total?: number }).total ?? rowsOf(body).length;
  expect(total >= 1, "search found nothing");
});

if (!IS_NEST) {
  await check("a rule's decisions are readable, not guessed", async () => {
    const rules = (await call("GET", "/rules")).body as Array<{
      name: string;
      reading: { decisions: Array<{ assumed?: boolean }> };
    }>;
    expect(rules.length > 0, "no rules were seeded");
    const total = rules.reduce((sum, rule) => sum + rule.reading.decisions.length, 0);
    const assumed = rules.reduce(
      (sum, rule) => sum + rule.reading.decisions.filter((decision) => decision.assumed).length,
      0
    );
    console.log(`        ${total - assumed}/${total} flowchart decisions were read as expressions`);
    expect(total === 0 || assumed < total, "not one decision could be read");
  });
}

await check("the audit trail recorded the write", async () => {
  const actions = (
    rowsOf((await call("GET", "/audit?limit=50")).body) as Array<{ action: string }>
  ).map((entry) => entry.action);
  // Named differently by the two stacks — ENTITY_CREATE on the NestJS trail,
  // CREATE on the browser runtime's — and meaning the same thing.
  expect(
    actions.some((action) => /CREATE/.test(action)),
    `no create on the trail: ${[...new Set(actions)].join(", ")}`
  );
});

await check("a refused sign-in is on the trail too", async () => {
  const entries = rowsOf((await call("GET", "/audit?limit=50")).body) as Array<{
    action: string;
    success: boolean;
  }>;
  // A run of failed logins is what an attack looks like from the trail, so a
  // trail that only holds successes cannot show one.
  expect(
    entries.some((entry) => /LOGIN|SIGN_IN/.test(entry.action) && entry.success === false),
    "the refused sign-in was not recorded"
  );
});

if (IS_NEST) {
  await check("the ledger verifies the record it just wrote", async () => {
    const entries = rowsOf((await call("GET", "/audit?limit=20")).body) as Array<{
      id: string;
      action: string;
    }>;
    const written = entries.find((entry) => /CREATE/.test(entry.action));
    expect(!!written, "no create entry to verify");
    const { body } = await call("GET", `/audit/${written!.id}/verify`);
    expect(
      (body as { verified?: boolean }).verified === true,
      `the hash chain did not verify a record it just wrote: ${JSON.stringify(body).slice(0, 200)}`
    );
  });
}

/*
 * Optimistic locking. The record form sends the version it opened the record at
 * as If-Match; a save against a version someone has moved past is a 409 the
 * form offers "reload or overwrite" on. Both stacks answer the same way, which
 * is what lets one description of the behaviour hold for both.
 */
const versionOf = async () => {
  const { body } = await call("GET", `/bus/account/${accountId}`);
  return Number(
    (body as { version?: number; data?: { version?: number } }).version ?? body.data?.version
  );
};
const conflictCode = (body: unknown) => (body as { details?: { code?: string } }).details?.code;

await check("a read answers with the record's version as its ETag", async () => {
  const read = await call("GET", `/bus/account/${accountId}`);
  const version =
    (read.body as { version?: number; data?: { version?: number } }).version ??
    read.body.data?.version;
  expect(read.etag === `"${version}"`, `expected ETag "${version}", got ${read.etag}`);
});

await check("a save against a version someone moved past is a 409", async () => {
  const opened = await versionOf();
  const first = await call(
    "PATCH",
    `/bus/account/${accountId}`,
    { name: "CI Account first" },
    { "If-Match": `"${opened}"` }
  );
  expect(
    first.status === 200,
    `the first save failed: ${first.status} ${JSON.stringify(first.body).slice(0, 200)}`
  );
  const stale = await call(
    "PATCH",
    `/bus/account/${accountId}`,
    { name: "CI Account stale" },
    { "If-Match": `"${opened}"` }
  );
  expect(stale.status === 409, `expected 409, got ${stale.status}`);
  expect(
    conflictCode(stale.body) === "VERSION_CONFLICT",
    `no VERSION_CONFLICT: ${JSON.stringify(stale.body).slice(0, 200)}`
  );
});

await check("two parallel saves from one version produce exactly one winner", async () => {
  const opened = await versionOf();
  const results = await Promise.all(
    ["CI Account a", "CI Account b"].map((name) =>
      call("PATCH", `/bus/account/${accountId}`, { name }, { "If-Match": `"${opened}"` })
    )
  );
  const statuses = results.map((r) => r.status).sort();
  expect(
    JSON.stringify(statuses) === "[200,409]",
    `expected [200,409], got ${JSON.stringify(statuses)}`
  );
  expect((await versionOf()) === opened + 1, "the version moved more than once");
});

await check(
  "overwrite — saving against the version the conflict reported — goes through",
  async () => {
    const opened = await versionOf();
    await call(
      "PATCH",
      `/bus/account/${accountId}`,
      { name: "CI Account theirs" },
      { "If-Match": `"${opened}"` }
    );
    const stale = await call(
      "PATCH",
      `/bus/account/${accountId}`,
      { name: "CI Account mine" },
      { "If-Match": `"${opened}"` }
    );
    const reported = (stale.body as { details?: { currentVersion?: number } }).details
      ?.currentVersion;
    const overwrite = await call(
      "PATCH",
      `/bus/account/${accountId}`,
      { name: "CI Account mine" },
      { "If-Match": `"${reported}"` }
    );
    expect(overwrite.status === 200, `overwrite failed: ${overwrite.status}`);
  }
);

await check("a malformed If-Match is a 400", async () => {
  const { status } = await call(
    "PATCH",
    `/bus/account/${accountId}`,
    { name: "CI Account" },
    { "If-Match": "nonsense" }
  );
  expect(status === 400, `expected 400, got ${status}`);
});

await check("the record can be deleted", async () => {
  const { status } = await call("DELETE", `/bus/account/${accountId}`);
  expect(status === 200 || status === 204, `status ${status}`);
  const { status: after } = await call("GET", `/bus/account/${accountId}`);
  expect(after === 404, `expected 404 after delete, got ${after}`);
});

if (!IS_NEST) {
  await check("the model is served back with the application", async () => {
    const { status, body } = await call("GET", "/model");
    expect(status === 200, `status ${status}`);
    expect((body as { entities: unknown[] }).entities.length >= 17, "the model is incomplete");
  });
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\nAll checks passed\n");
process.exit(failures ? 1 : 0);
