import { z } from "zod";

// A Google Drive file's metadata, as requested with fields=id,modifiedTime
// (and parents when listing). Google's API: unknown fields are allowed.
// Drive v3 has no etags — optimistic concurrency compares modifiedTime
// (see src/app/api/vault/route.ts).
export const driveFileMetaSchema = z.looseObject({
  id: z.string().min(1),
  modifiedTime: z.string().min(1),
  parents: z.array(z.string()).optional(),
});

export type DriveFileMeta = z.infer<typeof driveFileMetaSchema>;
