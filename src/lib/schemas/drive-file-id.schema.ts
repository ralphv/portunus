import { z } from "zod";

// A Drive file reduced to its id (fields=id): a created or listed folder.
export const driveFileIdSchema = z.looseObject({
  id: z.string().min(1),
});

export type DriveFileId = z.infer<typeof driveFileIdSchema>;
