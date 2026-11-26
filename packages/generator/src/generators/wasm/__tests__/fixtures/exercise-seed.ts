/**
 * Boots the browser stack's seed against a real PGlite and reports what
 * happened. Run by `seed-transaction.test.ts` in a child process: PGlite needs a
 * real runtime, and the test environment here is jsdom.
 *
 * Prints one JSON object on its last line.
 */

import { Database } from "../../../../../templates/wasm/server/lib/db.js";
import { migrate } from "../../../../../templates/wasm/server/migrate.js";
import { parseModel } from "../../../../pipeline/parse-model";
import { generateWasmApp } from "../../wasm-app.generator";

// PGlite is resolved at run time from the repository.
const { PGlite } = (await import("@electric-sql/pglite")) as { PGlite: any };

const MODEL = `
erDiagram
    Order {
        string id PK
        string reference
        decimal total
    }
    OrderLine {
        string id PK
        string order_id FK
        integer quantity
    }
    Order ||--o{ OrderLine : has
`;

const app = generateWasmApp(parseModel([MODEL]), {
  name: "Seed Probe",
  version: "1.0.0",
  description: "probe",
  adminEmail: "admin@admin.com",
  adminPassword: "admin",
  adminName: "admin",
  sampleRecords: 4,
});
const readAsset = async (name: string) => {
  const file = app.files.get(name);
  if (file === undefined) throw new Error(`no asset ${name}`);
  return file;
};
const freshModel = async () => JSON.parse(await readAsset("app/model.json"));

/** A PGlite whose top-level statements are counted once seeding has begun. */
async function countingDatabase() {
  const pg = await PGlite.create();
  const seen = { transactions: 0, topLevelAfterSeedStart: 0, seeding: false };
  const wrapped = new Proxy(pg, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (key === "transaction") seen.transactions += 1;
        if (seen.seeding && (key === "query" || key === "exec")) seen.topLevelAfterSeedStart += 1;
        return value.apply(target, args);
      };
    },
  });
  return { db: new Database(wrapped), seen };
}

const marker = (db: Database) =>
  db.value("SELECT value FROM sys_schema_state WHERE key = 'seeded'") as Promise<string | null>;

// 1. One transaction.
const one = await countingDatabase();
await migrate(one.db, await freshModel(), readAsset, (message: string) => {
  if (message === "Seeding the dictionary") one.seen.seeding = true;
});

// 2. A rejected sample row costs that row.
const two = await countingDatabase();
const withBadRow = await freshModel();
withBadRow.sampleData.bus_order_line.unshift({
  id: "00000000-0000-4000-8000-000000000001",
  order_id: "00000000-0000-4000-8000-0000000000ff",
  quantity: 1,
});
const goodLines = withBadRow.sampleData.bus_order_line.length - 1;
const log: string[] = [];
await migrate(two.db, withBadRow, readAsset, (message: string) => log.push(message));

// 3. A seed that fails leaves nothing behind.
const three = await countingDatabase();
const broken = await freshModel();
broken.roles = [...(broken.roles ?? []), { name: null }];
let threw = false;
try {
  await migrate(three.db, broken, readAsset, () => {});
} catch {
  threw = true;
}

console.log(
  JSON.stringify({
    one: {
      transactions: one.seen.transactions,
      topLevelAfterSeedStart: one.seen.topLevelAfterSeedStart,
      marker: await marker(one.db),
      orders: await one.db.count("bus_order"),
    },
    two: {
      skipped: log.some((line) => /bus_order_line row skipped/.test(line)),
      lines: await two.db.count("bus_order_line"),
      goodLines,
      orders: await two.db.count("bus_order"),
      marker: await marker(two.db),
    },
    three: {
      threw,
      marker: await marker(three.db),
      tables: await three.db.count("sys_table"),
    },
  })
);
process.exit(0);
