// Server-side Google Drive client for the vault file.
// The server is a dumb pipe: it only ever sees the encrypted envelope,
// never plaintext and never the master password.

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const VAULT_FILENAME = "portunus.vault.json";

export type DriveFileMeta = {
  id: string;
  etag: string;
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
    `${API}/files?q=${q}&spaces=drive&fields=files(id,etag,modifiedTime)` +
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
    `${API}/files/${encodeURIComponent(fileId)}?alt=media`,
  );
  return res.text();
}

export async function createVault(
  token: string,
  contents: string,
): Promise<DriveFileMeta> {
  const boundary = `portunus_${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: VAULT_FILENAME });
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n${contents}\r\n` +
    `--${boundary}--`;
  const res = await driveFetch(
    token,
    `${UPLOAD}/files?uploadType=multipart&fields=id,etag,modifiedTime`,
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

// baseEtag → If-Match precondition: Drive replies 412 if another writer
// changed the file since we read it.
export async function updateVault(
  token: string,
  fileId: string,
  contents: string,
  baseEtag?: string,
): Promise<DriveFileMeta> {
  const res = await driveFetch(
    token,
    `${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,etag,modifiedTime`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(baseEtag ? { "If-Match": baseEtag } : {}),
      },
      body: contents,
    },
  );
  return (await res.json()) as DriveFileMeta;
}
