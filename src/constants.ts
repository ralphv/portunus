// App-level constants — names, endpoints, limits.
//
// NOTE: VAULT_FOLDER_NAME, VAULT_FILENAME and the KEYFILE_* values are format
// constants, not user preferences — renaming them orphans existing Drive
// vaults / installed keyfiles. Treat as immutable once deployed.

// --- Google Drive ---
export const VAULT_FOLDER_NAME = "Portunus Application";
export const VAULT_FILENAME = "portunus.vault.json";
export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

// --- OAuth ---
export const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

// --- Vault ---
export const MAX_VAULT_BYTES = 10 * 1024 * 1024;

// --- Keyfile ---
export const KEYFILE_FILENAME = "portunus.key";
export const KEYFILE_STORAGE_KEY = "portunus.keyfile";

// --- UI ---
export const AUTO_LOCK_IDLE_S = 5 * 60;
