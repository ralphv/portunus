import { z } from "zod";

// files.generateIds response: ids reserved for files this app will create.
// Google's API: unknown fields are allowed.
export const driveGeneratedIdsSchema = z.looseObject({
  ids: z.array(z.string().min(1)).min(1),
});

export type DriveGeneratedIds = z.infer<typeof driveGeneratedIdsSchema>;
