/**
 * The database — PostgreSQL, compiled to WebAssembly.
 *
 * PGlite is a real Postgres server (18.x) built for wasm32, so the schema this
 * application runs is the schema it was generated with: `gen_random_uuid()`,
 * `JSONB`, `TIMESTAMPTZ`, foreign keys and transactions all behave as they do
 * on a server. That is why this stack does not fall back to SQLite in the
 * browser — a generated app whose column types quietly changed underneath it
 * would be a different application from the one the model described.
 *
 * The PGlite class is injected rather than imported: the Node host resolves it
 * from node_modules and the browser host from a vendored ES module (never a CDN),
 * and this file has to be the same file in both.
 */

/**
 * Thin wrapper: parameterised queries and the handful of builders the modules
 * actually need. Not an ORM — the queries a generated backend runs are known at
 * generation time, so a query builder would only be indirection between the
 * dictionary and the SQL.
 */
export class Database {
  constructor(pg) {
    this.pg = pg;
  }

  static async open(options = {}) {
    const { PGlite, dataDir, extensions } = options;
    if (!PGlite) throw new Error("Database.open needs a PGlite implementation");
    const pg = dataDir
      ? await PGlite.create(dataDir, { extensions })
      : await PGlite.create({ extensions });
    return new Database(pg);
  }

  /** Run one statement. `params` are bound, never interpolated. */
  async query(sql, params = []) {
    const result = await this.pg.query(sql, params);
    return result.rows || [];
  }

  /**
   * Run one statement and name its NUMERIC columns.
   *
   * Postgres returns NUMERIC (and DECIMAL, which money compiles to) as a string
   * so no digit is lost, and a string is indistinguishable from a text column
   * holding digits — so a screen that wants to format a number has to be told
   * which columns are numbers. OID 1700 is NUMERIC.
   */
  async queryWithNumeric(sql, params = []) {
    const result = await this.pg.query(sql, params);
    const numeric = (result.fields || [])
      .filter((field) => field.dataTypeID === 1700)
      .map((field) => field.name);
    return { rows: result.rows || [], numeric };
  }

  async one(sql, params = []) {
    const rows = await this.query(sql, params);
    return rows[0] || null;
  }

  async value(sql, params = []) {
    const row = await this.one(sql, params);
    if (!row) return null;
    const values = Object.values(row);
    return values.length ? values[0] : null;
  }

  /** Multi-statement script (schema files, seeds). No parameters. */
  async exec(sql) {
    if (!sql || !sql.trim()) return;
    await this.pg.exec(sql);
  }

  /**
   * Run `work` in one transaction, handing it a Database bound to it.
   *
   * Not for atomicity alone. On the browser's `idb://` store PGlite writes its
   * files back to IndexedDB after every statement made outside a transaction,
   * so a seed of a thousand statements is a thousand flushes — measured at over
   * three minutes against about two seconds in memory. Inside a transaction the
   * flush happens once, at the end.
   */
  async transaction(work) {
    if (this.inTransaction || typeof this.pg.transaction !== "function") return work(this);
    return this.pg.transaction(async (tx) => {
      const bound = new Database(tx);
      bound.inTransaction = true;
      return work(bound);
    });
  }

  /**
   * Run `work`, and if it throws undo only what it did.
   *
   * A statement that fails inside a transaction aborts the whole transaction, so
   * a caller that tolerates a failure — a sample row that breaks a constraint —
   * needs a savepoint around it. Outside a transaction there is nothing to
   * abort and `work` runs as it is.
   */
  async attempt(work) {
    if (!this.inTransaction) return work();
    await this.pg.exec("SAVEPOINT attempt");
    try {
      const result = await work();
      await this.pg.exec("RELEASE SAVEPOINT attempt");
      return result;
    } catch (error) {
      await this.pg.exec("ROLLBACK TO SAVEPOINT attempt");
      throw error;
    }
  }

  async close() {
    if (this.pg.close) await this.pg.close();
  }

  /** `SELECT` with an equality filter map, ordering and paging. */
  async select(table, options = {}) {
    const where = options.where || {};
    const columns = options.columns || "*";
    const built = whereClause(where);
    let sql = `SELECT ${columns} FROM ${ident(table)}${built.clause}`;
    if (options.orderBy) {
      const dir = String(options.direction || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
      sql += ` ORDER BY ${ident(options.orderBy)} ${dir}`;
    }
    if (options.limit != null) sql += ` LIMIT ${Number(options.limit)}`;
    if (options.offset != null) sql += ` OFFSET ${Number(options.offset)}`;
    return this.query(sql, built.params);
  }

  async count(table, where = {}) {
    const built = whereClause(where);
    const row = await this.one(
      `SELECT COUNT(*)::int AS total FROM ${ident(table)}${built.clause}`,
      built.params
    );
    return row ? row.total : 0;
  }

  async insert(table, values, options = {}) {
    const returning = options.returning || "*";
    const keys = Object.keys(values).filter((key) => values[key] !== undefined);
    if (!keys.length) throw new Error(`insert into ${table} with no columns`);
    const placeholders = keys.map((_, index) => `$${index + 1}`).join(", ");
    const sql =
      `INSERT INTO ${ident(table)} (${keys.map(ident).join(", ")}) ` +
      `VALUES (${placeholders}) RETURNING ${returning}`;
    return this.one(sql, keys.map((key) => values[key]));
  }

  async update(table, values, where, options = {}) {
    const returning = options.returning || "*";
    const keys = Object.keys(values).filter((key) => values[key] !== undefined);
    if (!keys.length) return null;
    const sets = keys.map((key, index) => `${ident(key)} = $${index + 1}`).join(", ");
    const built = whereClause(where, keys.length);
    const sql = `UPDATE ${ident(table)} SET ${sets}${built.clause} RETURNING ${returning}`;
    return this.one(sql, keys.map((key) => values[key]).concat(built.params));
  }

  async remove(table, where) {
    const built = whereClause(where);
    return this.query(`DELETE FROM ${ident(table)}${built.clause} RETURNING *`, built.params);
  }

  async tableExists(table) {
    const row = await this.one("SELECT to_regclass($1) AS oid", [table]);
    return !!(row && row.oid);
  }
}

/**
 * Quote an identifier.
 *
 * Table and column names reach the SQL string rather than the parameter list —
 * Postgres has no placeholder for an identifier — and in a dictionary-driven
 * app they arrive as a URL segment. Quoting, and rejecting anything that is not
 * a plain identifier, is what keeps `/bus/x";DROP TABLE` a 400 rather than a
 * catastrophe; callers additionally resolve the name against the dictionary
 * before getting here, so an unknown table never reaches SQL at all.
 */
export function ident(name) {
  const value = String(name);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function whereClause(where, offset = 0) {
  const entries = Object.entries(where || {}).filter(([, value]) => value !== undefined);
  if (!entries.length) return { clause: "", params: [] };
  const parts = [];
  const params = [];
  for (const [key, value] of entries) {
    if (value === null) {
      parts.push(`${ident(key)} IS NULL`);
    } else {
      params.push(value);
      parts.push(`${ident(key)} = $${offset + params.length}`);
    }
  }
  return { clause: ` WHERE ${parts.join(" AND ")}`, params };
}
