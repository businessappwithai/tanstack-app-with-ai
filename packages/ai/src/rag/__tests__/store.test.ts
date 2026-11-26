import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashEmbedder } from "../embedder";
import { ingestProjectModel } from "../ingest";
import { clearProject, MODEL_CONTEXT_INDEX, retrieve } from "../store";

/**
 * The store is real here, not mocked. A mocked vector store proves that the
 * code calls the functions it calls, which is not the thing that breaks —
 * dimension mismatches, metadata that does not survive the round trip, and
 * re-ingest leaving stale rows behind all only show up against Postgres.
 *
 * Embeddings are deterministic rather than semantic (see `hashEmbedder`), so
 * these assert plumbing and never relevance: retrieval ordering under a hash
 * embedder is meaningless and asserting on it would be asserting on noise.
 */

const ROOT = join(import.meta.dirname, "../../../../..");
const EML = readFileSync(join(ROOT, "examples/drug-discovery.eml.mmd"), "utf-8");
const PROJECT = "vitest-model-context";
const embed = hashEmbedder();

/** Skip rather than fail where no database is configured or pgvector is not installed. */
async function databaseReachable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await pool.query("select 1");
    const ext = await pool.query("SELECT 1 FROM pg_type WHERE typname = 'vector'");
    await pool.end();
    return (ext.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

const reachable = await databaseReachable();

describe.skipIf(!reachable)("model context store", () => {
  beforeAll(async () => {
    await clearProject(PROJECT);
  });

  afterAll(async () => {
    await clearProject(PROJECT);
  });

  async function rowCount(): Promise<number> {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      const { rows } = await pool.query(
        `select count(*)::int as n from ${MODEL_CONTEXT_INDEX} where metadata->>'projectId' = $1`,
        [PROJECT]
      );
      return rows[0]?.n ?? 0;
    } finally {
      await pool.end();
    }
  }

  it("ingests a model as one chunk per unit", async () => {
    const result = await ingestProjectModel(PROJECT, EML, { name: "Drug Discovery", embed });

    expect(result.entities).toBe(17);
    // 1 overview + 17 entities + 22 enums + 3 rules + 3 sagas + 2 state workflows
    expect(result.ingested).toBe(48);
    expect(await rowCount()).toBe(48);
  });

  // Editing a model must not leave the previous version's chunks behind to be
  // retrieved as though they were still true.
  it("replaces a project's chunks on re-ingest rather than accumulating them", async () => {
    await ingestProjectModel(PROJECT, EML, { name: "Drug Discovery", embed });
    await ingestProjectModel(PROJECT, EML, { name: "Drug Discovery", embed });

    expect(await rowCount()).toBe(48);
  });

  it("returns the chunk text and its metadata, not just an id", async () => {
    await ingestProjectModel(PROJECT, EML, { name: "Drug Discovery", embed });

    const hits = await retrieve(PROJECT, "deviation escalation", { topK: 5, embed });

    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.text.length).toBeGreaterThan(0);
      expect(hit.kind).not.toBe("unknown");
      expect(typeof hit.score).toBe("number");
    }
  });

  it("filters by chunk kind", async () => {
    await ingestProjectModel(PROJECT, EML, { name: "Drug Discovery", embed });

    const hits = await retrieve(PROJECT, "CAPA", { topK: 5, kinds: ["entity"], embed });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.kind === "entity")).toBe(true);
  });

  it("keeps one project's chunks out of another's results", async () => {
    await ingestProjectModel(PROJECT, EML, { name: "Drug Discovery", embed });

    const hits = await retrieve("some-other-project", "CAPA", { topK: 5, embed });

    expect(hits.every((hit) => hit.metadata.projectId !== PROJECT)).toBe(true);
  });

  it("clears a project completely", async () => {
    await ingestProjectModel(PROJECT, EML, { name: "Drug Discovery", embed });
    await clearProject(PROJECT);

    expect(await rowCount()).toBe(0);
  });
});
