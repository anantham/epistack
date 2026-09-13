import { z } from "zod";

export class StructuredOutputError extends Error {
  readonly raw: string;
  readonly issues: string;

  constructor(message: string, raw: string, issues: string) {
    super(message);
    this.name = "StructuredOutputError";
    this.raw = raw;
    this.issues = issues;
  }
}

export function extractJsonSlice(text: string): string | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) return null;
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < cleaned.length; index += 1) {
    const character = cleaned[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return cleaned.slice(start, index + 1);
    }
  }
  return null;
}

export function formatZodIssues(error: z.ZodError, limit = 20): string {
  return error.issues
    .slice(0, limit)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

export function parseStructured<T>(text: string, schema: z.ZodType<T>): T {
  const slice = extractJsonSlice(text);
  if (slice === null) {
    throw new StructuredOutputError("The model did not return a JSON object.", text, "No JSON object found.");
  }
  let value: unknown;
  try {
    value = JSON.parse(slice);
  } catch (error) {
    throw new StructuredOutputError(`The model returned invalid JSON: ${(error as Error).message}`, text, "Invalid JSON.");
  }
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = formatZodIssues(result.error);
  throw new StructuredOutputError(`The model output did not match the schema: ${issues}`, text, issues);
}

export type RepairContext = { raw: string; issues: string; attempt: number };
export type RepairRunner = (context: RepairContext) => Promise<string>;

export async function parseStructuredWithRepair<T>(input: {
  text: string;
  schema: z.ZodType<T>;
  repair?: RepairRunner;
  maxRepairs?: number;
}): Promise<T> {
  const maxRepairs = input.maxRepairs ?? 1;
  let text = input.text;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return parseStructured(text, input.schema);
    } catch (error) {
      if (!(error instanceof StructuredOutputError) || !input.repair || attempt >= maxRepairs) throw error;
      text = await input.repair({ raw: text, issues: error.issues, attempt: attempt + 1 });
    }
  }
}

export function schemaInstruction(schema: z.ZodType<unknown>): string {
  return "\nReturn only one JSON object matching this schema. No markdown fences.\n"
    + JSON.stringify(z.toJSONSchema(schema));
}

export function repairInstruction(schema: z.ZodType<unknown>, issues: string): string {
  return "\nYour previous reply did not satisfy the required schema. Return only one corrected JSON object, with every required field present. No markdown fences.\n"
    + JSON.stringify(z.toJSONSchema(schema))
    + `\nValidation errors to fix: ${issues}`;
}