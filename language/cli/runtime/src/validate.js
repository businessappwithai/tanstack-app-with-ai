// Request validation derived from the EML model: required fields, enum
// membership, and basic type coercion. Throws HttpError(400) on failure.

import { ENUMS, MODEL } from "./model.js";

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const SYSTEM_FIELDS = new Set(["id", "version", "created_at", "updated_at"]);

export function entityMeta(entityName) {
  return (MODEL.entities ?? []).find((e) => e.name === entityName) ?? null;
}

export function validate(entityName, data, op) {
  const meta = entityMeta(entityName);
  if (!meta) throw new HttpError(500, `Unknown entity ${entityName}`);
  const errors = [];
  const clean = { ...data };

  for (const attr of meta.attributes) {
    if (SYSTEM_FIELDS.has(attr.name) || attr.isPrimaryKey) continue;
    const present =
      clean[attr.name] !== undefined && clean[attr.name] !== null && clean[attr.name] !== "";

    if (op === "create" && attr.required && !attr.isForeignKey && !present) {
      errors.push(`"${attr.name}" is required`);
      continue;
    }
    if (!present) continue;

    // Enum membership
    if (attr.enumRef && ENUMS[attr.enumRef]) {
      if (!ENUMS[attr.enumRef].includes(clean[attr.name])) {
        errors.push(`"${attr.name}" must be one of: ${ENUMS[attr.enumRef].join(", ")}`);
      }
    }

    // Type coercion / checks
    if (attr.type === "integer" || attr.type === "decimal") {
      const num = Number(clean[attr.name]);
      if (Number.isNaN(num)) errors.push(`"${attr.name}" must be a number`);
      else clean[attr.name] = num;
    } else if (attr.type === "boolean") {
      clean[attr.name] = clean[attr.name] === true || clean[attr.name] === "true";
    }
  }

  if (errors.length) throw new HttpError(400, "Validation failed", errors);
  return clean;
}
