import { z } from "zod";

import { driveFileIdSchema } from "./drive-file-id.schema";

// Drive files.list for the app folder (fields=files(id)). `files` is omitted
// when nothing matches.
export const driveFolderListSchema = z.looseObject({
  files: z.array(driveFileIdSchema).optional(),
});

export type DriveFolderList = z.infer<typeof driveFolderListSchema>;
