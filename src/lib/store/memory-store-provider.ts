// In-memory stand-in for Google Drive (demo mode / tests). Mirrors Drive's
// observable behavior: stable file ids, a fresh modifiedTime on every write
// (so the route's optimistic-concurrency check works), 404 for unknown ids.

import { VAULT_FILENAME } from "@/constants";

import {
  type DriveFileMeta,
  StoreError,
  type StoreInterface,
} from "./store-interface";

export type MemoryFile = {
  id: string;
  name: string;
  modifiedTime: string;
  parents: string[];
  contents: string;
};

export const MEMORY_FOLDER_ID = "memory-vault-folder";

// Survives across requests (and Next dev HMR reloads) within one process.
const globalFiles = globalThis as typeof globalThis & {
  __portunusMemoryFiles?: Map<string, MemoryFile>;
};
function sharedFiles(): Map<string, MemoryFile> {
  globalFiles.__portunusMemoryFiles ??= new Map();
  return globalFiles.__portunusMemoryFiles;
}

let lastTime = 0;
// Strictly increasing so two writes in the same millisecond still differ.
function nextModifiedTime(): string {
  lastTime = Math.max(Date.now(), lastTime + 1);
  return new Date(lastTime).toISOString();
}

function toMeta(f: MemoryFile): DriveFileMeta {
  return { id: f.id, modifiedTime: f.modifiedTime, parents: [...f.parents] };
}

export class MemoryStoreProvider implements StoreInterface {
  constructor(private readonly files: Map<string, MemoryFile> = sharedFiles()) {}

  private get(fileId: string): MemoryFile {
    const f = this.files.get(fileId);
    if (!f) throw new StoreError(404, `File not found: ${fileId}`);
    return f;
  }

  async findVaultFile(): Promise<DriveFileMeta | null> {
    const newest = [...this.files.values()]
      .filter((f) => f.name === VAULT_FILENAME)
      .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))[0];
    return newest ? toMeta(newest) : null;
  }

  async downloadVault(fileId: string): Promise<string> {
    return this.get(fileId).contents;
  }

  async createVault(contents: string): Promise<DriveFileMeta> {
    const file: MemoryFile = {
      id: `memory-${crypto.randomUUID()}`,
      name: VAULT_FILENAME,
      modifiedTime: nextModifiedTime(),
      parents: [MEMORY_FOLDER_ID],
      contents,
    };
    this.files.set(file.id, file);
    return { id: file.id, modifiedTime: file.modifiedTime };
  }

  async updateVault(fileId: string, contents: string): Promise<DriveFileMeta> {
    const file = this.get(fileId);
    file.contents = contents;
    file.modifiedTime = nextModifiedTime();
    return { id: file.id, modifiedTime: file.modifiedTime };
  }

  async getFileMeta(fileId: string): Promise<DriveFileMeta> {
    const file = this.get(fileId);
    return { id: file.id, modifiedTime: file.modifiedTime };
  }

  async findOrCreateVaultFolder(): Promise<string> {
    return MEMORY_FOLDER_ID;
  }

  async moveToFolder(): Promise<void> {}
}
