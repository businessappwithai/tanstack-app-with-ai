/**
 * A state machine, enforced by a generated application.
 *
 * `models/rule-kinds.eml.mmd` draws TicketLifecycle:
 *
 *   open -> in_progress, open -> closed, in_progress -> resolved,
 *   resolved -> in_progress, resolved -> closed
 *
 * No person changes the status: a write that changes it is refused with
 * STATE_FIELD_SYSTEM_MANAGED, administrator included. A ticket moves when the
 * fact behind a move is recorded (`in_progress_at`, `resolved_at`,
 * `closed_at`): the model's ticketStateProgress rule starts the saga that
 * writes the state, and only along an edge the diagram drew.
 * `GET /api/workflows/transitions` still lists the moves that exist. Each case
 * drives the API and asserts what the record did.
 *
 * Run with `bun run test:e2e:rules-workflows -- --generated --model
 * scripts/e2e-rules-workflows/models/rule-kinds.eml.mmd`; skipped otherwise.
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

const APP = process.env.GENERATED_APP_URL;

const EDGES: Record<string, string[]> = {
  open: ["in_progress", "closed"],
  in_progress: ["resolved"],
  resolved: ["in_progress", "closed"],
  closed: [],
};

test.describe("a generated application enforces a drawn state machine", () => {
  test.skip(!APP, "needs --generated with --model models/rule-kinds.eml.mmd");

  let api: APIRequestContext;
  let customerId: string;

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext({
      baseURL: APP,
      extraHTTPHeaders: { Origin: APP ?? "" },
    });
    const signIn = await api.post("/api/auth/sign-in/email", {
      data: {
        email: process.env.GENERATED_ADMIN_EMAIL,
        password: process.env.GENERATED_ADMIN_PASSWORD,
      },
    });
    expect(signIn.ok(), `signing in answered ${signIn.status()}`).toBe(true);
    const customers = await api.get("/api/bus/customer?limit=1");
    customerId = ((await customers.json()) as { data: Array<{ id: string }> }).data[0]?.id ?? "";
    expect(customerId).not.toBe("");
  });
  test.afterAll(async () => {
    await api.dispose();
  });

  const createTicket = async (): Promise<string> => {
    const response = await api.post("/api/bus/ticket", {
      data: { customer_id: customerId, subject: "State machine probe", impact_score: 10 },
      failOnStatusCode: false,
    });
    expect(response.status(), await response.text()).toBeLessThan(300);
    const body = (await response.json()) as { id?: string; data?: { id?: string } };
    const id = body.id ?? body.data?.id;
    expect(id).toBeTruthy();
    return id as string;
  };

  const setStatus = (id: string, status: string) =>
    api.patch(`/api/bus/ticket/${id}`, { data: { status }, failOnStatusCode: false });

  /**
   * Press the button for a move: `POST /bus/:e/:id/transition`. A record moves only
   * this way — recording the fact a move once rested on moves nothing — and the press
   * must carry the version it was read at (`If-Match`; 428 without).
   */
  const press = async (id: string, to: string) => {
    const read = await api.get(`/api/bus/ticket/${id}`);
    return api.post(`/api/bus/ticket/${id}/transition`, {
      data: { to },
      headers: { "If-Match": read.headers().etag ?? "" },
      failOnStatusCode: false,
    });
  };

  const statusOf = async (id: string): Promise<string | undefined> => {
    const body = (await (await api.get(`/api/bus/ticket/${id}`)).json()) as {
      status?: string;
      data?: { status?: string };
    };
    return body.status ?? body.data?.status;
  };

  const offered = async (from: string): Promise<string[]> => {
    const response = await api.get(`/api/workflows/transitions?table=bus_ticket&from=${from}`);
    expect(response.ok(), await response.text()).toBe(true);
    const body = (await response.json()) as unknown;
    const rows = (
      Array.isArray(body) ? body : ((body as { data?: unknown[] }).data ?? [])
    ) as Array<{
      to_state?: string;
      to?: string;
    }>;
    return rows.map((row) => row.to_state ?? row.to ?? "").sort();
  };

  test("the transitions endpoint offers exactly the drawn moves", async () => {
    for (const [from, to] of Object.entries(EDGES)) {
      expect(await offered(from), `moves out of ${from}`).toEqual([...to].sort());
    }
  });

  test("a person's change to the status is refused, administrator included", async () => {
    const id = await createTicket();
    expect(await statusOf(id), "a new ticket starts in the initial state").toBe("open");
    const response = await setStatus(id, "in_progress");
    expect(response.status(), await response.text()).toBe(403);
    expect(await response.text()).toContain("STATE_FIELD_SYSTEM_MANAGED");
    expect(await statusOf(id), "the refused write must leave the record alone").toBe("open");
  });

  test("pressing the button for a drawn move makes the move", async () => {
    const id = await createTicket();
    const response = await press(id, "in_progress");
    expect(response.status(), await response.text()).toBeLessThan(300);
    expect(await statusOf(id)).toBe("in_progress");
  });

  test("a move with no drawn edge from here is refused and moves nothing", async () => {
    const id = await createTicket();
    // open -> resolved is not an edge: it must go through in_progress.
    const response = await press(id, "resolved");
    expect(response.status(), await response.text()).toBe(409);
    expect(await response.text()).toContain("INVALID_TRANSITION");
    expect(await statusOf(id)).toBe("open");
  });

  test("a whole path is walkable, and a closed ticket goes nowhere", async () => {
    const id = await createTicket();
    for (const state of ["in_progress", "resolved", "in_progress", "resolved", "closed"]) {
      const response = await press(id, state);
      expect(response.status(), `to ${state}: ${await response.text()}`).toBeLessThan(300);
      expect(await statusOf(id), `after moving to ${state}`).toBe(state);
    }
    // An end state is Final and locked: no move leaves it, and a form cannot write it.
    const again = await press(id, "in_progress");
    expect(again.status(), await again.text()).toBe(409);
    expect(await statusOf(id)).toBe("closed");
    const back = await setStatus(id, "open");
    expect([403, 409]).toContain(back.status());
    expect(await statusOf(id)).toBe("closed");
  });
});
