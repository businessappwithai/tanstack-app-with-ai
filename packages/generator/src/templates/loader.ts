import { execSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { ReferenceType } from "@appwithai/core/types";
import {
  addBusPrefix,
  addSysPrefix,
  camelCase,
  generateForeignKeyName,
  generatePrimaryKeyName,
  isBusinessTable,
  isSystemTable,
  kebabCase,
  pascalCase,
  plural,
  removeTablePrefix,
  singular,
  snakeCase,
  tableNameToControllerName,
  tableNameToDtoName,
  tableNameToEntityName,
  tableNameToEntitySetName,
  tableNameToModelName,
  tableNameToModuleName,
  tableNameToRoutePath,
  tableNameToServiceName,
} from "@appwithai/core/utils";
import Handlebars from "handlebars";

/** Column names that are signed by nature — see the isSignedColumn helper. */
export const SIGNED_COLUMN =
  /(^|_)(lat|latitude|lng|lon|long|longitude|variance|delta|adjustment|balance|offset|elevation|altitude|temperature)(_|$)/i;

function resolveOsUser(): string {
  if (process.env.PGUSER) return process.env.PGUSER;
  if (process.env.USER) return process.env.USER;
  if (process.env.LOGNAME) return process.env.LOGNAME;
  try {
    return execSync("whoami").toString().trim() || "postgres";
  } catch {
    return "postgres";
  }
}

// The Node "pg" driver, unlike libpq/psql, never auto-discovers a Unix socket
// for a bare "localhost" host — it always dials TCP, which many local
// Postgres installs (e.g. stock Debian/Ubuntu) require a password for. Find
// the socket directory the generating machine actually uses so the
// generated DATABASE_URL connects passwordlessly out of the box wherever
// possible, and degrade to a plain TCP URL (no `host=` param) when no local
// socket is found.
function resolvePgSocketDir(): string {
  const port = process.env.PGPORT || "5432";
  const candidates = [process.env.PGHOST, "/var/run/postgresql", "/tmp"].filter(
    (candidate): candidate is string => !!candidate && candidate.startsWith("/")
  );
  for (const dir of candidates) {
    if (existsSync(path.join(dir, `.s.PGSQL.${port}`))) {
      return dir;
    }
  }
  return "";
}

export class TemplateLoader {
  private cache: Map<string, HandlebarsTemplateDelegate> = new Map();

  constructor(private templateDir: string) {
    this.registerHelpers();
  }

  async load(templatePath: string): Promise<HandlebarsTemplateDelegate> {
    if (this.cache.has(templatePath)) {
      return this.cache.get(templatePath) as HandlebarsTemplateDelegate;
    }

    const fullPath = path.join(this.templateDir, templatePath);
    const source = await fs.readFile(fullPath, "utf-8");
    const template = Handlebars.compile(source, { noEscape: true });

    this.cache.set(templatePath, template);
    return template;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private registerHelpers(): void {
    // ========================================================================
    // String Case Helpers
    // ========================================================================
    Handlebars.registerHelper("pascalCase", pascalCase);
    Handlebars.registerHelper("camelCase", camelCase);
    Handlebars.registerHelper("snakeCase", snakeCase);
    Handlebars.registerHelper("kebabCase", kebabCase);
    Handlebars.registerHelper("plural", plural);
    Handlebars.registerHelper("singular", singular);
    Handlebars.registerHelper("upperCase", (str: string) => str?.toUpperCase() || "");
    Handlebars.registerHelper("lowerCase", (str: string) => str?.toLowerCase() || "");
    Handlebars.registerHelper("capitalize", (str: string) =>
      str ? str.charAt(0).toUpperCase() + str.slice(1) : ""
    );

    /*
     * A model's own words, safe to drop into generated TypeScript.
     *
     * Templates are compiled with `noEscape: true` — they render code, not
     * HTML, and Handlebars' HTML escaping would put `&#x27;` in a source file.
     * The consequence is that every `{{...}}` lands raw, so the moment a
     * model's `%%entity … help:` text contained an apostrophe the generated
     * `seeds/02_sys_dictionary.ts` had an unterminated string literal and the
     * whole application stopped compiling. It went unnoticed because no example
     * model had ever written the word "opportunity's".
     *
     * This emits the **complete** literal, quotes included — `{{tsString x}}`,
     * never `'{{tsString x}}'` — so there is no way to use it and still own the
     * quoting. JSON.stringify does the escaping, which also settles backslashes
     * and control characters; newlines are folded to spaces first because these
     * are one-line descriptions and a literal newline is a syntax error.
     */
    Handlebars.registerHelper("tsString", (value: unknown) =>
      JSON.stringify(value == null ? "" : String(value).replace(/\r?\n/g, " "))
    );

    // ========================================================================
    // Comparison Helpers
    // ========================================================================
    Handlebars.registerHelper("eq", (a, b) => a === b);
    Handlebars.registerHelper("ne", (a, b) => a !== b);
    Handlebars.registerHelper("lt", (a, b) => a < b);
    Handlebars.registerHelper("lte", (a, b) => a <= b);
    Handlebars.registerHelper("gt", (a, b) => a > b);
    Handlebars.registerHelper("gte", (a, b) => a >= b);
    Handlebars.registerHelper("and", (...args) => args.slice(0, -1).every(Boolean));
    Handlebars.registerHelper("or", (...args) => args.slice(0, -1).some(Boolean));
    Handlebars.registerHelper("not", (value) => !value);

    // A decimal column the generated validation rule must not call "negative" by
    // default: coordinates, differences and balances are signed by nature. Without
    // this a Project Site at latitude -33.9 (half the world) was refused with
    // "Latitude must not be negative" and its create answered 400.
    Handlebars.registerHelper("isSignedColumn", (name: unknown) =>
      typeof name === "string" && SIGNED_COLUMN.test(name)
    );

    // ========================================================================
    // Iteration Helpers
    // ========================================================================
    // Like {{#each}} but iterates only over the first N items of the array
    Handlebars.registerHelper(
      "eachFirst",
      function (this: unknown, items: unknown, count: number, options: Handlebars.HelperOptions) {
        if (!Array.isArray(items) || items.length === 0) {
          return options.inverse(this);
        }
        const slice = items.slice(0, count);
        return slice
          .map((item, index) =>
            options.fn(item, {
              data: { index, first: index === 0, last: index === slice.length - 1 },
            })
          )
          .join("");
      }
    );

    // ========================================================================
    // Table Naming Helpers (sys_ and bus_ prefixes)
    // ========================================================================
    Handlebars.registerHelper("addBusPrefix", addBusPrefix);
    Handlebars.registerHelper("addSysPrefix", addSysPrefix);
    Handlebars.registerHelper("removeTablePrefix", removeTablePrefix);
    Handlebars.registerHelper("isSystemTable", isSystemTable);
    Handlebars.registerHelper("isBusinessTable", isBusinessTable);
    Handlebars.registerHelper("tableToEntity", tableNameToEntityName);
    Handlebars.registerHelper("tableToModel", tableNameToModelName);
    Handlebars.registerHelper("tableToController", tableNameToControllerName);
    Handlebars.registerHelper("tableToService", tableNameToServiceName);
    Handlebars.registerHelper("tableToModule", tableNameToModuleName);
    Handlebars.registerHelper("tableToDto", tableNameToDtoName);
    Handlebars.registerHelper("tableToRoute", tableNameToRoutePath);
    Handlebars.registerHelper("tableToEntitySet", tableNameToEntitySetName);
    Handlebars.registerHelper("primaryKeyName", generatePrimaryKeyName);
    Handlebars.registerHelper("foreignKeyName", generateForeignKeyName);

    // ========================================================================
    // Random Sequence Generator (for initial field ordering)
    // ========================================================================
    Handlebars.registerHelper(
      "randomSeq",
      (index: number) => (index + 1) * 10 + Math.floor(Math.random() * 5)
    );

    // ========================================================================
    // TypeScript Type Mapping
    // ========================================================================
    Handlebars.registerHelper("tsType", (referenceId: number) => {
      const mapping: Record<number, string> = {
        [ReferenceType.STRING]: "string",
        [ReferenceType.INTEGER]: "number",
        [ReferenceType.AMOUNT]: "number",
        [ReferenceType.ID]: "string",
        [ReferenceType.TEXT]: "string",
        [ReferenceType.DATE]: "Date",
        [ReferenceType.DATETIME]: "Date",
        [ReferenceType.LIST]: "string",
        [ReferenceType.TABLE]: "string",
        [ReferenceType.TABLE_DIRECT]: "string",
        [ReferenceType.YES_NO]: "boolean",
        [ReferenceType.JSON]: "Record<string, unknown>",
        [ReferenceType.URL]: "string",
        [ReferenceType.IMAGE]: "string",
        [ReferenceType.FILE]: "string",
        [ReferenceType.EMAIL]: "string",
        [ReferenceType.PHONE]: "string",
        [ReferenceType.PASSWORD]: "string",
        [ReferenceType.COLOR]: "string",
      };
      return mapping[referenceId] || "string";
    });

    // TypeScript type mapping from string type names (for templates using string types)
    Handlebars.registerHelper("tsTypeFromString", (type: string) => {
      const mapping: Record<string, string> = {
        string: "string",
        varchar: "string",
        text: "string",
        integer: "number",
        int: "number",
        bigint: "number",
        decimal: "number",
        float: "number",
        number: "number",
        boolean: "boolean",
        bool: "boolean",
        date: "Date",
        datetime: "Date",
        timestamp: "Date",
        json: "Record<string, unknown>",
        jsonb: "Record<string, unknown>",
        uuid: "string",
        id: "string",
        email: "string",
        url: "string",
        password: "string",
        phone: "string",
        color: "string",
        file: "string",
        image: "string",
        amount: "number",
      };
      return mapping[type?.toLowerCase()] || "unknown";
    });

    // ========================================================================
    // Zod Schema Type Mapping
    // ========================================================================
    Handlebars.registerHelper("zodType", (referenceId: number, isMandatory: boolean = false) => {
      const mapping: Record<number, string> = {
        [ReferenceType.STRING]: "z.string()",
        [ReferenceType.INTEGER]: "z.number().int()",
        [ReferenceType.AMOUNT]: "z.number()",
        [ReferenceType.ID]: "z.string().uuid()",
        [ReferenceType.TEXT]: "z.string()",
        [ReferenceType.DATE]: "z.coerce.date()",
        [ReferenceType.DATETIME]: "z.coerce.date()",
        [ReferenceType.LIST]: "z.string()",
        [ReferenceType.TABLE]: "z.string().uuid()",
        [ReferenceType.TABLE_DIRECT]: "z.string().uuid()",
        [ReferenceType.YES_NO]: "z.boolean()",
        [ReferenceType.JSON]: "z.record(z.unknown())",
        [ReferenceType.URL]: "z.string().url()",
        [ReferenceType.IMAGE]: "z.string()",
        [ReferenceType.FILE]: "z.string()",
        [ReferenceType.EMAIL]: "z.string().email()",
        [ReferenceType.PHONE]: "z.string()",
        [ReferenceType.PASSWORD]: "z.string().min(8)",
        [ReferenceType.COLOR]: "z.string()",
      };
      const baseType = mapping[referenceId] || "z.string()";
      return isMandatory ? baseType : `${baseType}.optional()`;
    });

    // ========================================================================
    // SQL Type Mapping (for migrations)
    // ========================================================================
    Handlebars.registerHelper("sqlType", (referenceId: number, fieldLength?: number) => {
      // Handlebars passes options object as last arg, so check if fieldLength is actually a number
      const length = typeof fieldLength === "number" ? fieldLength : undefined;
      const mapping: Record<number, string> = {
        [ReferenceType.STRING]: length ? `varchar(${length})` : "varchar(255)",
        [ReferenceType.INTEGER]: "integer",
        [ReferenceType.AMOUNT]: "decimal(18,6)",
        [ReferenceType.ID]: "uuid",
        [ReferenceType.TEXT]: "text",
        [ReferenceType.DATE]: "date",
        [ReferenceType.DATETIME]: "timestamp",
        [ReferenceType.LIST]: "varchar(40)",
        [ReferenceType.TABLE]: "uuid",
        [ReferenceType.TABLE_DIRECT]: "uuid",
        [ReferenceType.YES_NO]: "boolean",
        [ReferenceType.JSON]: "jsonb",
        [ReferenceType.URL]: "varchar(500)",
        [ReferenceType.IMAGE]: "varchar(500)",
        [ReferenceType.FILE]: "varchar(500)",
        [ReferenceType.EMAIL]: "varchar(255)",
        [ReferenceType.PHONE]: "varchar(40)",
        [ReferenceType.PASSWORD]: "varchar(255)",
        [ReferenceType.COLOR]: "varchar(20)",
      };
      return mapping[referenceId] || "varchar(255)";
    });

    // ========================================================================
    // Kysely Type Mapping
    // ========================================================================
    Handlebars.registerHelper("kyselyType", (referenceId: number, fieldLength?: number) => {
      // Handlebars passes options object as last arg, so check if fieldLength is actually a number
      const length = typeof fieldLength === "number" ? fieldLength : undefined;
      const mapping: Record<number, string> = {
        [ReferenceType.STRING]: length ? `varchar(${length})` : "varchar(255)",
        [ReferenceType.INTEGER]: "integer",
        [ReferenceType.AMOUNT]: "decimal(18, 6)",
        [ReferenceType.ID]: "uuid",
        [ReferenceType.TEXT]: "text",
        [ReferenceType.DATE]: "date",
        [ReferenceType.DATETIME]: "timestamp",
        [ReferenceType.LIST]: "varchar(40)",
        [ReferenceType.TABLE]: "uuid",
        [ReferenceType.TABLE_DIRECT]: "uuid",
        [ReferenceType.YES_NO]: "boolean",
        [ReferenceType.JSON]: "jsonb",
        [ReferenceType.URL]: "varchar(500)",
        [ReferenceType.IMAGE]: "varchar(500)",
        [ReferenceType.FILE]: "varchar(500)",
        [ReferenceType.EMAIL]: "varchar(255)",
        [ReferenceType.PHONE]: "varchar(40)",
        [ReferenceType.PASSWORD]: "varchar(255)",
        [ReferenceType.COLOR]: "varchar(20)",
      };
      return mapping[referenceId] || "varchar(255)";
    });

    // ========================================================================
    // TanStack Helpers (tanstack-start-nestjs: TanStack Start)
    // ========================================================================
    Handlebars.registerHelper("tanstackQueryKey", (entity: string) => `['${entity}', 'list']`);
    Handlebars.registerHelper("tanstackDetailKey", (entity: string, id?: string) => {
      // Handlebars passes options object as last arg, check if id is actually a string
      const idVar = typeof id === "string" ? id : "id";
      return `['${entity}', 'detail', ${idVar}]`;
    });
    Handlebars.registerHelper(
      "tanstackMutationKey",
      (entity: string, action: string) => `['${entity}', '${action}']`
    );

    // TanStack Table column type helper
    Handlebars.registerHelper("tanstackColumnType", (referenceId: number) => {
      const mapping: Record<number, string> = {
        [ReferenceType.STRING]: "text",
        [ReferenceType.INTEGER]: "number",
        [ReferenceType.AMOUNT]: "number",
        [ReferenceType.DATE]: "date",
        [ReferenceType.DATETIME]: "datetime",
        [ReferenceType.YES_NO]: "boolean",
        [ReferenceType.EMAIL]: "text",
      };
      return mapping[referenceId] || "text";
    });

    // TanStack Form field type helper
    Handlebars.registerHelper("tanstackFieldType", (referenceId: number) => {
      const mapping: Record<number, string> = {
        [ReferenceType.STRING]: "input",
        [ReferenceType.INTEGER]: "number",
        [ReferenceType.AMOUNT]: "number",
        [ReferenceType.TEXT]: "textarea",
        [ReferenceType.DATE]: "date",
        [ReferenceType.DATETIME]: "datetime-local",
        [ReferenceType.YES_NO]: "checkbox",
        [ReferenceType.LIST]: "select",
        [ReferenceType.TABLE]: "select",
        [ReferenceType.EMAIL]: "email",
        [ReferenceType.URL]: "url",
        [ReferenceType.PASSWORD]: "password",
        [ReferenceType.COLOR]: "color",
      };
      return mapping[referenceId] || "input";
    });

    // ========================================================================
    // NestJS Helpers (tanstack-start-nestjs: Backend)
    // ========================================================================
    Handlebars.registerHelper(
      "nestControllerName",
      (entity: string) => `${pascalCase(entity)}Controller`
    );
    Handlebars.registerHelper(
      "nestServiceName",
      (entity: string) => `${pascalCase(entity)}Service`
    );
    Handlebars.registerHelper("nestModuleName", (entity: string) => `${pascalCase(entity)}Module`);
    Handlebars.registerHelper(
      "nestDtoName",
      (entity: string, prefix: string = "") => `${prefix}${pascalCase(entity)}Dto`
    );
    Handlebars.registerHelper("nestGuardName", (name: string) => `${pascalCase(name)}Guard`);
    Handlebars.registerHelper("nestDecoratorName", (name: string) => `${pascalCase(name)}`);

    // ========================================================================
    // Shadcn UI Helpers (tanstack-start-nestjs: Frontend)
    // ========================================================================
    Handlebars.registerHelper("shadcnInputType", (referenceId: number) => {
      const mapping: Record<number, string> = {
        [ReferenceType.STRING]: "text",
        [ReferenceType.INTEGER]: "number",
        [ReferenceType.AMOUNT]: "number",
        [ReferenceType.EMAIL]: "email",
        [ReferenceType.URL]: "url",
        [ReferenceType.PASSWORD]: "password",
        [ReferenceType.PHONE]: "tel",
        [ReferenceType.COLOR]: "color",
      };
      return mapping[referenceId] || "text";
    });

    Handlebars.registerHelper("shadcnComponent", (referenceId: number) => {
      const mapping: Record<number, string> = {
        [ReferenceType.STRING]: "Input",
        [ReferenceType.INTEGER]: "Input",
        [ReferenceType.AMOUNT]: "Input",
        [ReferenceType.TEXT]: "Textarea",
        [ReferenceType.DATE]: "DatePicker",
        [ReferenceType.DATETIME]: "DatePicker",
        [ReferenceType.YES_NO]: "Checkbox",
        [ReferenceType.LIST]: "Select",
        [ReferenceType.TABLE]: "Select",
      };
      return mapping[referenceId] || "Input";
    });

    // ========================================================================
    // JSON Helpers
    // ========================================================================
    Handlebars.registerHelper("json", (context) => JSON.stringify(context, null, 2));
    Handlebars.registerHelper("jsonInline", (context) => JSON.stringify(context));

    // ========================================================================
    // Array/Loop Helpers
    // ========================================================================
    Handlebars.registerHelper("first", (array, property?: string) => {
      const firstItem = array?.[0];
      // If property is specified and is a string (not Handlebars options object)
      if (typeof property === "string" && firstItem) {
        return firstItem[property];
      }
      return firstItem;
    });
    Handlebars.registerHelper("last", (array, property?: string) => {
      const lastItem = array?.[array?.length - 1];
      // If property is specified and is a string (not Handlebars options object)
      if (typeof property === "string" && lastItem) {
        return lastItem[property];
      }
      return lastItem;
    });
    Handlebars.registerHelper("length", (array) => array?.length || 0);
    Handlebars.registerHelper("includes", (array, value) => array?.includes(value));
    Handlebars.registerHelper("join", (array, separator = ", ") => array?.join(separator) || "");
    Handlebars.registerHelper("slice", (array, start, end) => array?.slice(start, end));
    Handlebars.registerHelper("range", (start: number, end: number) => {
      const result: number[] = [];
      for (let i = start; i <= end; i++) result.push(i);
      return result;
    });

    // Index helpers for loops
    Handlebars.registerHelper("indexPlusOne", (index: number) => index + 1);
    Handlebars.registerHelper("isFirst", (index: number) => index === 0);
    Handlebars.registerHelper(
      "isLast",
      (index: number, array: unknown[]) => index === array.length - 1
    );
    Handlebars.registerHelper("isEven", (index: number) => index % 2 === 0);
    Handlebars.registerHelper("isOdd", (index: number) => index % 2 !== 0);

    // ========================================================================
    // Date/Time Helpers
    // ========================================================================
    Handlebars.registerHelper("now", () => new Date().toISOString());
    Handlebars.registerHelper("timestamp", () => Date.now());
    Handlebars.registerHelper("osUser", () => resolveOsUser());
    Handlebars.registerHelper("pgSocketParam", () => {
      const dir = resolvePgSocketDir();
      return dir ? `?host=${encodeURIComponent(dir)}` : "";
    });
    Handlebars.registerHelper("formatDate", (date: Date | string, format?: string) => {
      const d = new Date(date);
      if (format === "iso") return d.toISOString();
      if (format === "date") return d.toISOString().split("T")[0];
      return d.toISOString();
    });

    // ========================================================================
    // String Manipulation Helpers
    // ========================================================================
    Handlebars.registerHelper("trim", (str: string) => str?.trim() || "");
    Handlebars.registerHelper(
      "replace",
      (str: string, search: string, replacement: string) =>
        str?.replace(new RegExp(search, "g"), replacement) || ""
    );
    Handlebars.registerHelper(
      "split",
      (str: string, separator: string) => str?.split(separator) || []
    );
    Handlebars.registerHelper(
      "endsWith",
      (str: string, suffix: string) => str?.endsWith(suffix) ?? false
    );
    Handlebars.registerHelper(
      "startsWith",
      (str: string, prefix: string) => str?.startsWith(prefix) ?? false
    );
    Handlebars.registerHelper("concat", (...args) => args.slice(0, -1).join(""));
    Handlebars.registerHelper("substring", (str: string, start: number, length?: number) =>
      length ? str?.substring(start, start + length) : str?.substring(start)
    );
    Handlebars.registerHelper("padStart", (str: string, length: number, char: string = " ") =>
      String(str).padStart(length, char)
    );
    Handlebars.registerHelper("padEnd", (str: string, length: number, char: string = " ") =>
      String(str).padEnd(length, char)
    );

    // ========================================================================
    // Math Helpers
    // ========================================================================
    Handlebars.registerHelper("add", (a: number, b: number) => a + b);
    Handlebars.registerHelper("subtract", (a: number, b: number) => a - b);
    Handlebars.registerHelper("multiply", (a: number, b: number) => a * b);
    Handlebars.registerHelper("divide", (a: number, b: number) => a / b);
    Handlebars.registerHelper("mod", (a: number, b: number) => a % b);
    Handlebars.registerHelper("abs", (a: number) => Math.abs(a));
    Handlebars.registerHelper("ceil", (a: number) => Math.ceil(a));
    Handlebars.registerHelper("floor", (a: number) => Math.floor(a));
    Handlebars.registerHelper("round", (a: number) => Math.round(a));
    Handlebars.registerHelper("min", (...args) => Math.min(...args.slice(0, -1)));
    Handlebars.registerHelper("max", (...args) => Math.max(...args.slice(0, -1)));

    // ========================================================================
    // Conditional Helpers
    // ========================================================================
    Handlebars.registerHelper(
      "ifCond",
      function (
        this: unknown,
        v1: unknown,
        operator: string,
        v2: unknown,
        options: Handlebars.HelperOptions
      ) {
        switch (operator) {
          case "==":
            return v1 === v2 ? options.fn(this) : options.inverse(this);
          case "===":
            return v1 === v2 ? options.fn(this) : options.inverse(this);
          case "!=":
            return v1 !== v2 ? options.fn(this) : options.inverse(this);
          case "!==":
            return v1 !== v2 ? options.fn(this) : options.inverse(this);
          case "<":
            return (v1 as number) < (v2 as number) ? options.fn(this) : options.inverse(this);
          case "<=":
            return (v1 as number) <= (v2 as number) ? options.fn(this) : options.inverse(this);
          case ">":
            return (v1 as number) > (v2 as number) ? options.fn(this) : options.inverse(this);
          case ">=":
            return (v1 as number) >= (v2 as number) ? options.fn(this) : options.inverse(this);
          case "&&":
            return v1 && v2 ? options.fn(this) : options.inverse(this);
          case "||":
            return v1 || v2 ? options.fn(this) : options.inverse(this);
          default:
            return options.inverse(this);
        }
      }
    );

    Handlebars.registerHelper(
      "unless",
      function (this: unknown, condition: boolean, options: Handlebars.HelperOptions) {
        return !condition ? options.fn(this) : options.inverse(this);
      }
    );

    Handlebars.registerHelper(
      "switch",
      function (this: unknown, value: unknown, options: Handlebars.HelperOptions) {
        (this as Record<string, unknown>)._switch_value_ = value;
        (this as Record<string, unknown>)._switch_matched_ = false; // Reset match flag
        // Handle case where options might not have fn
        if (options && typeof options.fn === "function") {
          return options.fn(this);
        }
        return "";
      }
    );

    Handlebars.registerHelper(
      "case",
      function (this: Record<string, unknown>, value: unknown, options: Handlebars.HelperOptions) {
        // Only execute if this case matches AND no previous case has matched
        if (value === this._switch_value_ && !this._switch_matched_) {
          (this as Record<string, unknown>)._switch_matched_ = true; // Mark as matched
          // Handle case where options might not have fn
          if (options && typeof options.fn === "function") {
            return options.fn(this);
          }
        }
        return "";
      }
    );

    Handlebars.registerHelper(
      "default",
      function (this: Record<string, unknown>, options: Handlebars.HelperOptions) {
        // Only execute if no previous case has matched
        if (!this._switch_matched_) {
          (this as Record<string, unknown>)._switch_matched_ = true; // Mark as matched
          // Handle case where options might not have fn (non-block usage)
          if (options && typeof options.fn === "function") {
            return options.fn(this);
          }
        }
        return "";
      }
    );

    // ========================================================================
    // UUID Generation Helper
    // ========================================================================
    Handlebars.registerHelper("uuid", () => {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    });

    // ========================================================================
    // Comment/Documentation Helpers
    // ========================================================================
    Handlebars.registerHelper("comment", (text: string, style: string = "line") => {
      if (style === "block") {
        return `/* ${text} */`;
      }
      return `// ${text}`;
    });

    Handlebars.registerHelper("jsdoc", (description: string, params?: Record<string, string>) => {
      let doc = `/**\n * ${description}`;
      if (params) {
        doc += "\n *";
        for (const [name, type] of Object.entries(params)) {
          doc += `\n * @param {${type}} ${name}`;
        }
      }
      doc += "\n */";
      return doc;
    });

    // ========================================================================
    // Import Path Helpers
    // ========================================================================
    Handlebars.registerHelper("relativeImport", (from: string, to: string) => {
      const fromParts = from.split("/");
      const toParts = to.split("/");

      // Find common base
      let commonLength = 0;
      for (let i = 0; i < Math.min(fromParts.length, toParts.length); i++) {
        if (fromParts[i] === toParts[i]) {
          commonLength++;
        } else {
          break;
        }
      }

      const upCount = fromParts.length - commonLength - 1;
      const relativeParts = toParts.slice(commonLength);

      if (upCount === 0) {
        return `./${relativeParts.join("/")}`;
      }

      return "../".repeat(upCount) + relativeParts.join("/");
    });

    // ========================================================================
    // Test Helpers
    // ========================================================================
    Handlebars.registerHelper("typeToReferenceId", (type: string) => {
      const mapping: Record<string, number> = {
        string: 10,
        varchar: 10,
        char: 10,
        integer: 11,
        int: 11,
        bigint: 11,
        smallint: 11,
        decimal: 12,
        numeric: 12,
        float: 12,
        double: 12,
        number: 12,
        real: 12,
        boolean: 20,
        bool: 20,
        date: 15,
        datetime: 16,
        timestamp: 16,
        timestamptz: 16,
        text: 14,
        json: 28,
        jsonb: 28,
        uuid: 13,
        id: 13,
        email: 29,
        url: 24,
        image: 25,
        file: 26,
        phone: 31,
        password: 30,
        color: 27,
      };
      return mapping[type?.toLowerCase()] ?? 10;
    });

    Handlebars.registerHelper("isExcludedField", (fieldName: string) => {
      const excludedFields = ["id", "created_at", "updated_at", "deleted_at"];
      const lowerFieldName = fieldName?.toLowerCase() || "";

      // Exclude if it's an excluded field name
      if (excludedFields.includes(lowerFieldName)) {
        return true;
      }

      // Exclude if it contains '_id' (foreign keys)
      if (lowerFieldName.includes("_id")) {
        return true;
      }

      return false;
    });

    Handlebars.registerHelper("mockValue", (type: string, fieldName: string) => {
      const typeLower = type?.toLowerCase() || "";
      const nameLower = fieldName?.toLowerCase() || "";

      if (
        typeLower.includes("string") ||
        typeLower.includes("text") ||
        typeLower.includes("varchar")
      ) {
        if (nameLower.includes("email")) {
          return "'test@example.com'";
        }
        if (nameLower.includes("name")) {
          return "'Test Name'";
        }
        if (nameLower.includes("phone")) {
          return "'+1234567890'";
        }
        return "'test_value'";
      }

      if (
        typeLower.includes("int") ||
        typeLower.includes("number") ||
        typeLower.includes("integer")
      ) {
        return "123";
      }

      if (
        typeLower.includes("decimal") ||
        typeLower.includes("float") ||
        typeLower.includes("double")
      ) {
        return "123.45";
      }

      if (typeLower.includes("bool") || typeLower.includes("boolean")) {
        return "true";
      }

      if (typeLower.includes("date") || typeLower.includes("time")) {
        return "new Date().toISOString()";
      }

      return "'test_value'";
    });

    Handlebars.registerHelper(
      "mockUniqueValue",
      (type: string, fieldName: string, index: number) => {
        const typeLower = type?.toLowerCase() || "";
        const nameLower = fieldName?.toLowerCase() || "";

        if (
          typeLower.includes("string") ||
          typeLower.includes("text") ||
          typeLower.includes("varchar")
        ) {
          if (nameLower.includes("email")) {
            return `\`test${index}@example.com\``;
          }
          if (nameLower.includes("name")) {
            return `\`Test Name ${index}\``;
          }
          return `\`test_value_${index}\``;
        }

        if (
          typeLower.includes("int") ||
          typeLower.includes("number") ||
          typeLower.includes("integer")
        ) {
          return `${100 + index}`;
        }

        if (
          typeLower.includes("decimal") ||
          typeLower.includes("float") ||
          typeLower.includes("double")
        ) {
          return `${(100.5 + index).toFixed(2)}`;
        }

        return `\`test_${index}\``;
      }
    );

    // Realistic seed value helper for business data seeds
    Handlebars.registerHelper(
      "seedValue",
      (
        fieldName: string,
        index: number,
        entityDisplayName?: string | Handlebars.HelperOptions,
        enumValues?: string[] | Handlebars.HelperOptions
      ) => {
        const n = (fieldName ?? "").toLowerCase();
        const i = typeof index === "number" ? index : 0;
        const FIRST_NAMES = [
          "James",
          "Mary",
          "Robert",
          "Patricia",
          "John",
          "Jennifer",
          "Michael",
          "Linda",
          "David",
          "Barbara",
        ];
        const LAST_NAMES = [
          "Smith",
          "Johnson",
          "Williams",
          "Brown",
          "Jones",
          "Garcia",
          "Miller",
          "Davis",
          "Wilson",
          "Taylor",
        ];
        // Every call site passes a non-empty literal, and the modulo keeps the
        // index in range, so the lookup cannot miss.
        const pick = <T>(arr: T[]): T => arr[i % arr.length] as T;

        // The entity's display name, hoisted above its first use: a bare "name"
        // field reads as "Grade 1", and an identifier column prefixes with it.
        const entityName = typeof entityDisplayName === "string" ? entityDisplayName.trim() : "";

        // A column bound to a %%enum has a declared vocabulary, and it beats
        // every guess below. Without this the seeder wrote its own generic
        // words — "Active", "Pending", "In Progress" — into every `status`
        // column, none of which any of the model's enums declare. Three things
        // followed: the seeded rows contradicted the application's own
        // dictionary; every state machine was dead on them, because the guard
        // looks for an edge out of the state the row is in and there is none
        // out of "Pending"; and every rule keyed on a real status value never
        // fired. A generated application could not demonstrate the workflows it
        // had just been generated from.
        const declared = Array.isArray(enumValues)
          ? enumValues.map((value) => String(value).trim()).filter(Boolean)
          : [];
        if (declared.length > 0) return pick(declared);

        if (n === "first_name") return pick(FIRST_NAMES);
        if (n === "last_name") return pick(LAST_NAMES);
        // A bare "name" (or "*_name") field is usually an entity's own name —
        // Instrument.name, Team.name, Vendor.name, CompoundAlias.alias_name —
        // not a person. Assuming person here seeded a lab instrument literally
        // named "James Smith". Fields that really do hold a person's full name
        // are named specifically enough to say so.
        if (
          n === "full_name" ||
          n === "contact_name" ||
          n === "customer_name" ||
          n === "manager_name" ||
          n === "employee_name" ||
          n === "student_name" ||
          n === "teacher_name" ||
          n === "guardian_name" ||
          n === "parent_name"
        )
          return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
        if (n === "gender") return i % 2 === 0 ? "Male" : "Female";
        if (n === "relationship" || n === "relationship_type")
          return pick(["Mother", "Father", "Guardian", "Grandmother", "Grandfather"]);
        if (n === "grade" || n === "letter_grade") return pick(["A", "B+", "A-", "B", "A"]);
        if (n === "status")
          return pick(["Active", "Pending", "Completed", "In Progress", "Scheduled"]);
        if (n === "subject" || n === "subject_name")
          return pick(["Mathematics", "Science", "English", "History", "Geography"]);
        if (n === "department")
          return pick(["Engineering", "Marketing", "Finance", "Operations", "HR"]);
        if (n === "address" || n === "street_address")
          return `${(i + 1) * 100} ${pick(["Main St", "Oak Ave", "Elm Dr", "Park Blvd", "Cedar Ln"])}, ${pick(["New York", "Los Angeles", "Chicago", "Houston", "Phoenix"])}`;
        if (n === "city") return pick(["New York", "Los Angeles", "Chicago", "Houston", "Phoenix"]);
        if (n === "phone" || n === "phone_number" || n === "mobile")
          return `555-${String(1000 + i * 101).padStart(4, "0")}`;
        if (n === "description" || n === "notes" || n === "bio") return `Description ${i + 1}`;
        if (n === "title") return `Title ${i + 1}`;
        if (n === "code" || n === "reference_code") return `CODE-${String(i + 1).padStart(3, "0")}`;
        // Identifier/number fields: generate a structured code rather than a humanized label
        if (
          n.endsWith("_number") ||
          n.endsWith("_no") ||
          n.endsWith("_id") ||
          n === "reference" ||
          n === "sku" ||
          n === "barcode"
        ) {
          const prefix = entityName
            ? entityName.substring(0, 3).toUpperCase()
            : (fieldName ?? "")
                .replace(/_number$|_no$|_id$/, "")
                .substring(0, 3)
                .toUpperCase() || "REF";
          return `${prefix}-${String(i + 1).padStart(4, "0")}`;
        }
        if (n === "score" || n === "grade_value") return String(70 + i * 5);
        if (n === "capacity" || n === "max_students") return String(20 + i * 5);
        if (n === "room_number") return `10${i + 1}`;
        if (n === "year" || n === "academic_year") return String(2024 + i);
        if (n === "section") return String.fromCharCode(65 + i); // A, B, C, D
        // Fields outside the vocabulary above all fell back to the identical
        // literal "Sample N" regardless of field name, so every unmatched
        // string column on a row showed the exact same text (e.g. a chemistry
        // model's smiles/inchi_key/formula/compound_class/registration_status
        // all read "Sample 1"). Fold the field name in so columns stay
        // distinguishable for any domain vocabulary doesn't cover.
        if ((n === "name" || n === "title") && entityName) return `${entityName} ${i + 1}`;
        const humanized = (fieldName ?? "")
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase())
          .trim();
        return humanized ? `${humanized} ${i + 1}` : `Sample ${i + 1}`;
      }
    );

    // A seed value for a numeric column.
    //
    // Integers were seeded with the row index — 0, 1, 2, 3 — so the sample data
    // contradicted the model it came from: a Room whose help text calls its
    // capacity "the ceiling a session's bookable places are set from" was
    // seeded with a capacity of 0, and sessions with four bookings against
    // them held nobody. Counts and capacities start at a plausible figure and
    // step; anything unrecognised keeps the old index, which is at least
    // distinct per row.
    Handlebars.registerHelper("seedNumber", (fieldName: string, index: number) => {
      const n = (fieldName ?? "").toLowerCase();
      const i = typeof index === "number" ? index : 0;
      if (n === "capacity" || n === "max_students" || n === "seats") return 20 + i * 5;
      if (n.startsWith("credits") || n.endsWith("_credits")) return 10 + i * 5;
      if (n.endsWith("_count") || n === "quantity" || n === "qty") return 1 + i;
      if (n === "duration_minutes" || n.endsWith("_minutes")) return 45 + i * 15;
      if (n === "position" || n === "queue_position" || n === "seq_no" || n === "sequence")
        return i + 1;
      if (n === "year" || n === "academic_year") return 2024 + i;
      return i;
    });
  }
}
