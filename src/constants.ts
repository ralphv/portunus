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
// localStorage slot for the last-synced ciphertext envelope (offline mode).
export const VAULT_CACHE_KEY = "portunus.vault.cache";
// localStorage mirror of the vault's "password fill & save" setting, so
// the unlock screen (rendered before the vault is loaded) applies the
// device's last-known preference. Key prefix — entries are per-vault,
// suffixed with the keyfile id (`portunus.password-fill-save.<kid>`).
export const PASSWORD_FILL_SAVE_KEY = "portunus.password-fill-save";

// --- Keyfile ---
export const KEYFILE_FILENAME = "portunus.key";
export const KEYFILE_STORAGE_KEY = "portunus.keyfile";

// --- UI ---
export const AUTO_LOCK_IDLE_S = 5 * 60;
