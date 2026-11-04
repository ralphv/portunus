import { z } from "zod";

import { driveFileMetaSchema } from "./drive-file-meta.schema";

// Drive files.list for the vault file (fields=files(id,modifiedTime,parents)).
// `files` is omitted when nothing matches.
export const driveFileListSchema = z.looseObject({
  files: z.array(driveFileMetaSchema).optional(),
});

export type DriveFileList = z.infer<typeof driveFileListSchema>;
