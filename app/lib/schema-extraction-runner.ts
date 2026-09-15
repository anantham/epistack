import { z } from "zod";
import { parseStructuredWithRepair, repairInstruction, schemaInstruction } from "./structured-output.ts";

type StageCall = (task: string, instructions: string) => Promise<string>;

/**
 * Run one schema-bound model call and, only for a classified backend outage,
 * continue on the alternate provider. The same provider is reused for the
 * single repair attempt so a repair cannot silently switch provenance.
 */
export async function runSchemaExtractionWithFallback<T>(input: {
  schema: z.ZodType<T>;
  instructions: string;
  task: string;
  primary: StageCall;
  fallback?: StageCall;
  isBackendUnreachable: (error: unknown) => boolean;
}) {
  const instructions = input.instructions + schemaInstruction(input.schema);
  let stage: StageCall = input.primary;

  const runStage = async (task: string, stageInstructions: string) => {
    if (stage === input.primary) {
      try {
        return await stage(task, stageInstructions);
      } catch (error) {
        if (!input.fallback || !input.isBackendUnreachable(error)) throw error;
        stage = input.fallback;
      }
    }
    return stage(task, stageInstructions);
  };

  const first = await runStage(input.task, instructions);
  return parseStructuredWithRepair({
    text: first,
    schema: input.schema,
    repair: async ({ raw, issues }) => runStage(
      `${input.task}\n\nPREVIOUS ATTEMPT (failed schema validation):\n${raw}`,
      input.instructions + repairInstruction(input.schema, issues),
    ),
  });
}
