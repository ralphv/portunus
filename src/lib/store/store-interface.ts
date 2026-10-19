// Backend-agnostic storage for the encrypted vault file. Implementations only
// ever handle opaque ciphertext — never plaintext or the master password.

// Drive v3 dropped the files etag field — optimistic concurrency uses
// modifiedTime read-compare-write instead (see api/vault/route.ts).
export type DriveFileMeta = {
  id: string;
  modifiedTime: string;
  parents?: string[];
};

export class StoreError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

export interface StoreInterface {
  /**
   * Verify everything this store needs is configured. Throws at server boot
   * when required environment variables are missing.
   */
  assertRequirements(): void;
  /** Newest vault file, or null when none exists. */
  findVaultFile(): Promise<DriveFileMeta | null>;
  downloadVault(fileId: string): Promise<string>;
  createVault(contents: string): Promise<DriveFileMeta>;
  updateVault(fileId: string, contents: string): Promise<DriveFileMeta>;
  getFileMeta(fileId: string): Promise<DriveFileMeta>;
  /** Find-or-create the folder the vault lives in; returns its id. */
  findOrCreateVaultFolder(): Promise<string>;
  /** Move a file into `folderId`, detaching it from `removeParents`. */
  moveToFolder(
    fileId: string,
    removeParents: string[],
    folderId: string,
  ): Promise<void>;
}
