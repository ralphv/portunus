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

export { VAULT_FILENAME };

// Drive v3 dropped the files etag field — optimistic concurrency uses
// modifiedTime read-compare-write instead (see route.ts).
export type DriveFileMeta = {
  id: string;
  modifiedTime: string;
};

export class DriveApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DriveApiError";
  }
}

async function driveFetch(
  token: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
  if (!res.ok) throw new DriveApiError(res.status, await res.text());
  return res;
}

// drive.file scope means we only ever see files this app created.
export async function findVaultFile(
  token: string,
): Promise<DriveFileMeta | null> {
  const q = encodeURIComponent(
    `name='${VAULT_FILENAME}' and trashed=false`,
  );
  const res = await driveFetch(
    token,
    `${DRIVE_API_BASE}/files?q=${q}&spaces=drive&fields=files(id,modifiedTime)` +
      `&orderBy=${encodeURIComponent("modifiedTime desc")}&pageSize=10`,
  );
  const data = (await res.json()) as { files?: DriveFileMeta[] };
  return data.files?.[0] ?? null;
}

export async function downloadVault(
  token: string,
  fileId: string,
): Promise<string> {
  const res = await driveFetch(
    token,
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
  );
  return res.text();
}

// Find-or-create the Drive folder the vault lives in.
export async function findOrCreateVaultFolder(token: string): Promise<string> {
  const q = encodeURIComponent(
    `mimeType='${DRIVE_FOLDER_MIME}' and name='${VAULT_FOLDER_NAME}' and trashed=false`,
  );
  const res = await driveFetch(
    token,
    `${DRIVE_API_BASE}/files?q=${q}&spaces=drive&fields=files(id)&pageSize=10`,
  );
  const data = (await res.json()) as { files?: { id: string }[] };
  const existing = data.files?.[0];
  if (existing) return existing.id;
  const created = await driveFetch(
    token,
    `${DRIVE_API_BASE}/files?fields=id`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: VAULT_FOLDER_NAME,
        mimeType: DRIVE_FOLDER_MIME,
      }),
    },
  );
  return ((await created.json()) as { id: string }).id;
}

export async function createVault(
  token: string,
  contents: string,
): Promise<DriveFileMeta> {
  const folderId = await findOrCreateVaultFolder(token);
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
  const res = await driveFetch(
    token,
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

export async function getFileMeta(
  token: string,
  fileId: string,
): Promise<DriveFileMeta> {
  const res = await driveFetch(
    token,
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,modifiedTime`,
  );
  return (await res.json()) as DriveFileMeta;
}

export async function updateVault(
  token: string,
  fileId: string,
  contents: string,
): Promise<DriveFileMeta> {
  const res = await driveFetch(
    token,
    `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,modifiedTime`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: contents,
    },
  );
  return (await res.json()) as DriveFileMeta;
}
