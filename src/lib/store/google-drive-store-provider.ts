// Server-side Google Drive client for the vault file.
// The server is a dumb pipe: it only ever sees the encrypted envelope,
// never plaintext and never the master password.

import {
  DRIVE_API_BASE,
  DRIVE_FOLDER_MIME,
  DRIVE_UPLOAD_BASE,
  VAULT_FILENAME,
  VAULT_FOLDER_NAME,
} from "@/constants";

import {
  type DriveFileMeta,
  StoreError,
  type StoreInterface,
} from "./store-interface";

export class GoogleDriveStoreProvider implements StoreInterface {
  constructor(private readonly accessToken: string) {}

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

  // drive.file scope means we only ever see files this app created.
  async findVaultFile(): Promise<DriveFileMeta | null> {
    const q = encodeURIComponent(
      `name='${VAULT_FILENAME}' and trashed=false`,
    );
    const res = await this.driveFetch(
      `${DRIVE_API_BASE}/files?q=${q}&spaces=drive&fields=files(id,modifiedTime,parents)` +
        `&orderBy=${encodeURIComponent("modifiedTime desc")}&pageSize=10`,
    );
    const data = (await res.json()) as { files?: DriveFileMeta[] };
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
    const data = (await res.json()) as { files?: { id: string }[] };
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
    return ((await created.json()) as { id: string }).id;
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
    return (await res.json()) as DriveFileMeta;
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
    return (await res.json()) as DriveFileMeta;
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
    return (await res.json()) as DriveFileMeta;
  }
}
