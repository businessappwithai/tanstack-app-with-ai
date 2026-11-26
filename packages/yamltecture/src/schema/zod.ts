import { z } from "zod";

export const AttributeValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.string(),
    z.number(),
    z.boolean(),
    z.array(AttributeValueSchema),
    z.record(z.string(), AttributeValueSchema),
  ])
);

export const ArchitectureNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  parent: z.string().min(1).optional(),
  attributes: z.record(z.string(), AttributeValueSchema).optional(),
});

export const ArchitectureLinkSchema = z.object({
  id: z.string().min(1).optional(),
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.string().min(1),
  attributes: z.record(z.string(), AttributeValueSchema).optional(),
});

export const ArchitectureSchema = z.object({
  nodes: z.array(ArchitectureNodeSchema).default([]),
  links: z.array(ArchitectureLinkSchema).default([]),
});
