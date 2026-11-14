import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/require-user";

type ColumnInfo = {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
};

type FkRow = {
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
};

type FakerType = typeof import("@faker-js/faker").faker;

function makeGenerator(
  colName: string,
  dataType: string,
  udtName: string,
  faker: FakerType,
): () => unknown {
  const n = colName.toLowerCase();
  const t = dataType.toLowerCase();
  const u = udtName.toLowerCase();

  if (n === "id") return () => faker.string.uuid();
  if (n === "version") return () => 1;
  if (n === "doc_status") return () => "draft";
  if (n.includes("email")) return () => faker.internet.email();
  if (n.includes("phone") || n.includes("mobile") || n.includes("tel"))
    return () => faker.phone.number();
  if (n === "first_name" || (n.includes("first") && n.includes("name")))
    return () => faker.person.firstName();
  if (n === "last_name" || (n.includes("last") && n.includes("name")))
    return () => faker.person.lastName();
  if (n === "full_name" || n === "name")
    return () => faker.person.fullName();
  if (n.includes("company") || n.includes("carrier") || n.includes("shipper") || n.includes("consignee"))
    return () => faker.company.name();
  if (n.includes("street") || n === "address" || n === "address1")
    return () => faker.location.streetAddress();
  if (n.includes("address")) return () => faker.location.streetAddress();
  if (n.includes("city")) return () => faker.location.city();
  if (n.includes("state") || n.includes("province") || n.includes("region"))
    return () => faker.location.state({ abbreviated: true });
  if (n.includes("country")) return () => faker.location.countryCode("alpha-2");
  if (n.includes("zip") || n.includes("postal") || n.includes("postcode"))
    return () => faker.location.zipCode();
  if (n.includes("url") || n.includes("website") || n.includes("link"))
    return () => faker.internet.url();
  if (n.includes("ip_address") || n === "ip") return () => faker.internet.ip();
  if (n.includes("description") || n.includes("notes") || n.includes("comments") || n.includes("remarks"))
    return () => faker.lorem.sentence();
  if (n.includes("code") && !n.includes("zip") && !n.includes("postal"))
    return () => faker.string.alphanumeric(8).toUpperCase();
  if (n.includes("tracking") || n.includes("sku") || n.includes("barcode") || n.includes("serial"))
    return () => faker.string.alphanumeric(12).toUpperCase();
  if (n.includes("number") && !n.includes("phone"))
    return () => faker.string.numeric({ length: { min: 6, max: 10 } });
  if (n.includes("price") || n.includes("cost") || n.includes("fee") || n.includes("rate") ||
      n.includes("amount") || n.includes("total") || n.includes("subtotal") || n.includes("tax") ||
      n.includes("value") || n.includes("revenue") || n.includes("salary"))
    return () => Number(faker.number.float({ min: 1, max: 50000, fractionDigits: 2 }).toFixed(2));
  if (n.includes("weight") || n.includes("volume") || n.includes("length") || n.includes("width") ||
      n.includes("height") || n.includes("dimension"))
    return () => Number(faker.number.float({ min: 0.1, max: 10000, fractionDigits: 3 }).toFixed(3));
  if (n.includes("quantity") || n.includes("qty") || n.includes("pieces") || n.includes("units"))
    return () => faker.number.int({ min: 1, max: 1000 });
  if (n.includes("percent") || n.includes("ratio") || n.includes("discount") || n.includes("tax_rate"))
    return () => Number(faker.number.float({ min: 0, max: 100, fractionDigits: 2 }).toFixed(2));
  if (n.includes("latitude") || n === "lat")
    return () => Number(faker.location.latitude().toFixed(6));
  if (n.includes("longitude") || n === "lon" || n === "lng")
    return () => Number(faker.location.longitude().toFixed(6));
  if (n.includes("status")) return () => faker.helpers.arrayElement(["active", "inactive", "pending", "completed"]);
  if (n.includes("type") && !n.endsWith("_id"))
    return () => faker.helpers.arrayElement(["standard", "express", "economy"]);
  if (n.includes("title") || n.includes("subject"))
    return () => faker.lorem.words({ min: 2, max: 4 });
  if (n === "created_at" || n === "updated_at" || n.includes("_at"))
    return () => faker.date.past({ years: 2 }).toISOString();
  if (n.endsWith("_on") || n.includes("date"))
    return () => faker.date.past({ years: 2 }).toISOString().split("T")[0];
  if (n.startsWith("is_") || n.startsWith("has_") || n.startsWith("can_") || n === "active" || n === "enabled")
    return () => faker.datatype.boolean();

  // Type fallback
  if (t === "uuid" || u === "uuid") return () => faker.string.uuid();
  if (t === "boolean" || t === "bool") return () => faker.datatype.boolean();
  if (t.includes("int") || t === "smallint" || t === "bigint")
    return () => faker.number.int({ min: 1, max: 100000 });
  if (t.includes("numeric") || t.includes("decimal") || t.includes("float") || t.includes("real") || t.includes("double"))
    return () => Number(faker.number.float({ min: 1, max: 10000, fractionDigits: 2 }).toFixed(2));
  if (t === "date") return () => faker.date.past({ years: 2 }).toISOString().split("T")[0];
  if (t.includes("timestamp") || u === "timestamptz") return () => faker.date.past({ years: 2 }).toISOString();
  if (t === "jsonb" || t === "json") return () => JSON.stringify({ value: faker.lorem.word() });
  if (t === "text" || t.includes("varchar") || t.includes("char"))
    return () => faker.lorem.words({ min: 1, max: 4 });

  return () => faker.lorem.word();
}

/** Topological sort via Kahn's algorithm. Returns tables in insertion order. */
function topoSort(tables: string[], deps: Map<string, Set<string>>): string[] {
  const inDegree = new Map<string, number>(tables.map((t) => [t, 0]));
  const revDeps = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));

  for (const [t, ds] of deps) {
    for (const dep of ds) {
      if (inDegree.has(t)) inDegree.set(t, (inDegree.get(t) ?? 0) + 1);
      revDeps.get(dep)?.add(t);
    }
  }

  const queue = tables.filter((t) => (inDegree.get(t) ?? 0) === 0);
  const sorted: string[] = [];

  while (queue.length > 0) {
    const t = queue.shift()!;
    sorted.push(t);
    for (const child of revDeps.get(t) ?? []) {
      const d = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, d);
      if (d === 0) queue.push(child);
    }
  }

  // Add anything left (cycles) at the end
  for (const t of tables) {
    if (!sorted.includes(t)) sorted.push(t);
  }

  return sorted;
}

const SKIP_TABLE_PREFIXES = ["sys_", "bun_", "schema_", "ar_internal", "spatial_ref"];
const SKIP_TABLES = new Set(["migrations", "schema_migrations"]);

export const Route = createFileRoute("/api/db/seed-data")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const caller = await requireUser(request, "db:seed-data", "write");
        if (caller.response) return caller.response;

        let body: { databaseUrl?: string; recordsPerTable?: number };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid request body" }, { status: 400 });
        }

        const { databaseUrl, recordsPerTable = 100 } = body;
        if (!databaseUrl) {
          return Response.json({ error: "databaseUrl is required" }, { status: 400 });
        }
        if (![100, 1000, 10000, 100000].includes(recordsPerTable)) {
          return Response.json({ error: "recordsPerTable must be 100, 1000, 10000, or 100000" }, { status: 400 });
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            let closed = false;
            const send = (data: unknown) => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
              } catch {
                closed = true;
              }
            };
            const finish = () => {
              if (!closed) { closed = true; controller.close(); }
            };

            let client: import("pg").Client | null = null;
            try {
              const { Client } = await import("pg");
              const { faker } = await import("@faker-js/faker");

              client = new Client({ connectionString: databaseUrl });
              await client.connect();

              // Get all public base tables
              const tablesRes = await client.query<{ table_name: string }>(
                `SELECT table_name FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                 ORDER BY table_name`,
              );
              const allTables = tablesRes.rows
                .map((r) => r.table_name)
                .filter((t) =>
                  !SKIP_TABLES.has(t) &&
                  !SKIP_TABLE_PREFIXES.some((p) => t.startsWith(p)),
                );

              send({ type: "start", totalTables: allTables.length, recordsPerTable });

              if (allTables.length === 0) {
                send({ type: "done", totalRecords: 0, durationMs: 0 });
                return finish();
              }

              // Get FK constraints for all tables
              const fkRes = await client.query<FkRow>(
                `SELECT
                  kcu.table_name, kcu.column_name,
                  ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
                 FROM information_schema.table_constraints tc
                 JOIN information_schema.key_column_usage kcu
                   ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                 JOIN information_schema.constraint_column_usage ccu
                   ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
                 WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
              );
              const fks = fkRes.rows;

              // Build dependency graph (table → set of tables it depends on)
              const deps = new Map<string, Set<string>>(allTables.map((t) => [t, new Set<string>()]));
              const fkMap = new Map<string, { foreignTable: string; foreignColumn: string }>();
              for (const fk of fks) {
                if (fk.table_name !== fk.foreign_table_name && allTables.includes(fk.foreign_table_name)) {
                  deps.get(fk.table_name)?.add(fk.foreign_table_name);
                }
                fkMap.set(`${fk.table_name}.${fk.column_name}`, {
                  foreignTable: fk.foreign_table_name,
                  foreignColumn: fk.foreign_column_name,
                });
              }

              const sortedTables = topoSort(allTables, deps);

              // Get column info per table in one query
              const colsRes = await client.query<ColumnInfo & { table_name: string }>(
                `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
                 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = ANY($1)
                 ORDER BY table_name, ordinal_position`,
                [allTables],
              );
              const tableColumns = new Map<string, ColumnInfo[]>();
              for (const row of colsRes.rows) {
                if (!tableColumns.has(row.table_name)) tableColumns.set(row.table_name, []);
                tableColumns.get(row.table_name)!.push(row);
              }

              // Track inserted IDs per table for FK generation
              const insertedIds = new Map<string, unknown[]>();

              let totalInserted = 0;
              const startTime = Date.now();
              const BATCH = 500;

              for (let tableIdx = 0; tableIdx < sortedTables.length; tableIdx++) {
                const tableName = sortedTables[tableIdx]!;
                const columns = tableColumns.get(tableName) ?? [];

                // Skip columns that are auto-generated: serial sequences and auto-uuid primary keys
                const writableColumns = columns.filter((col) => {
                  const def = col.column_default ?? "";
                  if (def.includes("nextval(")) return false;
                  // Skip gen_random_uuid() default only for `id` column — others may need it
                  if (col.column_name === "id" && def.includes("gen_random_uuid()")) return false;
                  return true;
                });

                if (writableColumns.length === 0) {
                  send({ type: "table_skip", table: tableName, done: tableIdx + 1, total: sortedTables.length });
                  continue;
                }

                const colNames = writableColumns.map((c) => c.column_name);
                const colNamesQuoted = colNames.map((c) => `"${c}"`).join(", ");

                // Build generators
                const generators = writableColumns.map((col) => {
                  const fkKey = `${tableName}.${col.column_name}`;
                  const fkTarget = fkMap.get(fkKey);
                  if (fkTarget) {
                    return () => {
                      const ids = insertedIds.get(fkTarget.foreignTable);
                      if (ids && ids.length > 0) return faker.helpers.arrayElement(ids);
                      return col.is_nullable === "YES" ? null : faker.string.uuid();
                    };
                  }
                  const gen = makeGenerator(col.column_name, col.data_type, col.udt_name, faker);
                  return () => col.is_nullable === "YES" && faker.number.int({ min: 1, max: 10 }) === 1 ? null : gen();
                });

                send({ type: "table_start", table: tableName, records: recordsPerTable, done: tableIdx + 1, total: sortedTables.length });

                let inserted = 0;
                const tableIds: unknown[] = [];

                for (let i = 0; i < recordsPerTable; i += BATCH) {
                  const batchCount = Math.min(BATCH, recordsPerTable - i);
                  const values: unknown[] = [];
                  const rowPlaceholders: string[] = [];

                  for (let j = 0; j < batchCount; j++) {
                    const startIdx = j * colNames.length + 1;
                    rowPlaceholders.push(`(${colNames.map((_, k) => `$${startIdx + k}`).join(", ")})`);
                    for (const gen of generators) values.push(gen());
                  }

                  const sql = `INSERT INTO "${tableName}" (${colNamesQuoted}) VALUES ${rowPlaceholders.join(", ")} RETURNING id`;

                  try {
                    const res = await client.query(sql, values);
                    for (const row of res.rows) {
                      if (row.id !== undefined) tableIds.push(row.id);
                    }
                    inserted += batchCount;
                    totalInserted += batchCount;
                  } catch (batchErr) {
                    // Fall back to individual inserts for this batch
                    const singleSql = `INSERT INTO "${tableName}" (${colNamesQuoted}) VALUES (${colNames.map((_, k) => `$${k + 1}`).join(", ")}) RETURNING id`;
                    for (let j = 0; j < batchCount; j++) {
                      const rowVals = generators.map((gen) => gen());
                      try {
                        const r = await client.query(singleSql, rowVals);
                        if (r.rows[0]?.id !== undefined) tableIds.push(r.rows[0].id);
                        inserted++;
                        totalInserted++;
                      } catch {
                        // skip failed row
                      }
                    }
                    void batchErr; // batch error already handled
                  }
                }

                if (tableIds.length > 0) insertedIds.set(tableName, tableIds);

                send({ type: "table_done", table: tableName, records: inserted, done: tableIdx + 1, total: sortedTables.length });
              }

              await client.end();
              client = null;

              send({ type: "done", totalRecords: totalInserted, tables: sortedTables.length, durationMs: Date.now() - startTime });
            } catch (err) {
              send({ type: "error", message: err instanceof Error ? err.message : String(err) });
              try { await client?.end(); } catch { /* ignore */ }
            } finally {
              finish();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
