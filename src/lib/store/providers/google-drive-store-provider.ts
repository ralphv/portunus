// Server-side Google Drive client for the vault file.
// The server is a dumb pipe: it only ever sees the encrypted envelope,
// never plaintext and never the master password.

import type { z } from "zod";

import {
  DRIVE_API_BASE,
  DRIVE_BAD_RESPONSE_MESSAGE,
  DRIVE_BAD_RESPONSE_STATUS,
  DRIVE_FOLDER_MIME,
  DRIVE_UPLOAD_BASE,
  LOG_DRIVE_BAD_RESPONSE,
  VAULT_FILENAME,
  VAULT_FOLDER_NAME,
} from "@/constants";
import { createSchemaValidatorFactory } from "@/factory";
import { driveFileIdSchema } from "@/lib/schemas/drive-file-id.schema";
import { driveFileListSchema } from "@/lib/schemas/drive-file-list.schema";
import { driveFileMetaSchema } from "@/lib/schemas/drive-file-meta.schema";
import { driveFolderListSchema } from "@/lib/schemas/drive-folder-list.schema";

import {
  type DriveFileMeta,
  StoreError,
  type StoreInterface,
} from "../store-interface";

// Fail fast on missing config — without these, auth silently breaks at
// request time while the container still looks "healthy".
const REQUIRED_ENV = [
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_SECRET",
  "AUTH_URL",
] as const;

export class GoogleDriveStoreProvider implements StoreInterface {
  // Per instance, not per module: @/factory re-exports the store factory
  // that imports this file, so a module-level call could run mid-cycle.
  private readonly validator = createSchemaValidatorFactory();

  constructor(private readonly accessToken: string) {}

  assertRequirements(): void {
    const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}. ` +
          "See .env.example.",
      );
    }
  }

  private async driveFetch(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${this.accessToken}`, ...init.headers },
    });
    if (!res.ok) throw new StoreError(res.status, await res.text());
    return res;
  }

  // A successful response's JSON, checked against its schema. A wrong shape
  // is a bad gateway, not a crash further down; only paths and codes are
  // logged, never the response itself.
  private async driveJson<S extends z.ZodType>(res: Response, schema: S): Promise<z.output<S>> {
    const checked = this.validator.checkJson(schema, await res.text());
    if (checked.ok) return checked.value;
    console.warn(LOG_DRIVE_BAD_RESPONSE, checked.issues);
    throw new StoreError(DRIVE_BAD_RESPONSE_STATUS, DRIVE_BAD_RESPONSE_MESSAGE);
  }

  // drive.file scope means we only ever see files this app created.
  async findVaultFile(): Promise<DriveFileMeta | null> {
    const q = encodeURIComponent(
      `name='${VAULT_FILENAME}' and trashed=false`,
    );
    const res = await this.driveFetch(
      `${DRIVE_API_BASE}/files?q=${q}&spaces=drive&fields=files(id,modifiedTime,parents)` +
        `&orderBy=${encodeURIComponent("modifiedTime desc")}&pageSize=10`,
    );
    const data = await this.driveJson(res, driveFileListSchema);
    return data.files?.[0] ?? null;
  }

  async downloadVault(fileId: string): Promise<string> {
    const res = await this.driveFetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
    );
    return res.text();
  }

  async findOrCreateVaultFolder(): Promise<string> {
    const q = encodeURIComponent(
      `mimeType='${DRIVE_FOLDER_MIME}' and name='${VAULT_FOLDER_NAME}' and trashed=false`,
    );
    const res = await this.driveFetch(
      `${DRIVE_API_BASE}/files?q=${q}&spaces=drive&fields=files(id)&pageSize=10`,
    );
    const data = await this.driveJson(res, driveFolderListSchema);
    const existing = data.files?.[0];
    if (existing) return existing.id;
    const created = await this.driveFetch(`${DRIVE_API_BASE}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: VAULT_FOLDER_NAME,
        mimeType: DRIVE_FOLDER_MIME,
      }),
    });
    return (await this.driveJson(created, driveFileIdSchema)).id;
  }

  async createVault(contents: string): Promise<DriveFileMeta> {
    const folderId = await this.findOrCreateVaultFolder();
    const boundary = `portunus_${crypto.randomUUID()}`;
    const metadata = JSON.stringify({
      name: VAULT_FILENAME,
      parents: [folderId],
    });
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n${contents}\r\n` +
      `--${boundary}--`;
    const res = await this.driveFetch(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,modifiedTime`,
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    return this.driveJson(res, driveFileMetaSchema);
  }

  // Used to migrate vaults created before the folder existed.
  async moveToFolder(
    fileId: string,
    removeParents: string[],
    folderId: string,
  ): Promise<void> {
    const params = new URLSearchParams({
      addParents: folderId,
      fields: "id",
    });
    if (removeParents.length > 0) {
      params.set("removeParents", removeParents.join(","));
    }
    await this.driveFetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?${params}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
  }

  async getFileMeta(fileId: string): Promise<DriveFileMeta> {
    const res = await this.driveFetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,modifiedTime`,
    );
    return this.driveJson(res, driveFileMetaSchema);
  }

  async updateVault(fileId: string, contents: string): Promise<DriveFileMeta> {
    const res = await this.driveFetch(
      `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,modifiedTime`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: contents,
      },
    );
    return this.driveJson(res, driveFileMetaSchema);
  }
}
