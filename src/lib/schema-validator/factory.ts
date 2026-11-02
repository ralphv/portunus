import { ZodSchemaValidatorProvider } from "./providers/zod-schema-validator-provider";
import type { SchemaValidatorInterface } from "./schema-validator-interface";

// ZodSchemaValidatorProvider is stateless (Zod schemas are module-level
// objects), so each call gets a fresh instance. There is deliberately no NOP
// provider: a validator that accepts everything would defeat its purpose.
export function createSchemaValidatorFactory(): SchemaValidatorInterface {
  return new ZodSchemaValidatorProvider();
}
