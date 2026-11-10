export interface VaultConfig {
  rootPath: string
  displayName: string
  inboxPath: string
  allowAgentWrites: boolean
  configuredAt: number
}

/** Renderer-safe summary. The selected root path stays in the main process. */
export interface VaultSummary {
  /** Stable opaque identity for scoping renderer-local state to this Vault. */
  vaultId: string
  displayName: string
  inboxPath: string
  allowAgentWrites: boolean
  configuredAt: number
}

export interface VaultCandidate {
  path: string
  displayName: string
  isObsidianVault: boolean
  isPromaManaged?: boolean
}

export interface VaultFileEntry {
  kind: 'file'
  relativePath: string
  name: string
  size: number
  modifiedAt: number
}

/** A directory within the authorized Vault root; dot-prefixed folders are visible only for the allow-listed names (`.agents`, `.claude`). */
export interface VaultFolderEntry {
  kind: 'folder'
  relativePath: string
  name: string
}

/** Entries used to build the Vault sidebar tree. */
export type VaultTreeEntry = VaultFileEntry | VaultFolderEntry

/** A user-selected location in a Vault. Paths are always relative to its authorized root. */
export interface VaultFocus {
  kind: 'file' | 'folder'
  relativePath: string
  /** Monotonic per-renderer sequence; the main process ignores stale focus IPC. */
  sequence: number
}

/** Durable turn metadata used to render the post-response Obsidian context chip. */
export interface VaultFocusAttribution {
  displayName: string
  rootPath: string
  focus: VaultFocus
}

export interface VaultRenameInput {
  relativePath: string
  name: string
  expectedSha256?: string
}

export interface VaultDeleteInput {
  relativePath: string
  expectedSha256?: string
}

export interface VaultSavePastedImageInput {
  noteRelativePath: string
  mimeType: string
  base64: string
}

export interface VaultReadResult {
  vaultId: string
  relativePath: string
  content: string
  sha256: string
  modifiedAt: number
}

export type VaultFileReferenceInput = Pick<VaultReadResult, 'vaultId' | 'relativePath'>

export interface VaultWriteInput {
  relativePath: string
  content: string
  expectedSha256?: string
  createOnly?: boolean
}

export type VaultWriteResult =
  | { ok: true; relativePath: string; sha256: string; modifiedAt: number }
  | { ok: false; reason: 'conflict'; currentSha256: string; currentModifiedAt: number }

export const VAULT_SEARCH_MAX_QUERY_LENGTH = 256
export const VAULT_MAX_EDIT_BYTES = 2 * 1024 * 1024

export interface VaultSearchHit {
  relativePath: string
  title: string
  snippet: string
  matchStart: number
  matchLength: number
  editable: boolean
}

export interface VaultSearchStatus {
  vaultId: string | null
  displayName: string | null
  phase: 'unconfigured' | 'indexing' | 'ready' | 'error'
  revision: number
  indexedFiles: number
  skippedFiles: number
}

export interface VaultSearchResponse {
  status: VaultSearchStatus
  hits: VaultSearchHit[]
  totalMatches: number
}

export const VAULT_IPC_CHANNELS = {
  GET_CONFIG: 'vault:get-config',
  SELECT_DEFAULT: 'vault:select-default',
  LIST_CANDIDATES: 'vault:list-candidates',
  SELECT: 'vault:select',
  AUTHORIZE_CANDIDATE: 'vault:authorize-candidate',
  LIST_FILES: 'vault:list-files',
  SEARCH: 'vault:search',
  SEARCH_CHANGED: 'vault:search-changed',
  READ_FILE: 'vault:read-file',
  RESOLVE_FILE_REFERENCE: 'vault:resolve-file-reference',
  RESOLVE_MEDIA: 'vault:resolve-media',
  SAVE_PASTED_IMAGE: 'vault:save-pasted-image',
  WRITE_FILE: 'vault:write-file',
  CREATE_UNTITLED_FILE: 'vault:create-untitled-file',
  CREATE_UNTITLED_FILE_IN_FOLDER: 'vault:create-untitled-file-in-folder',
  CREATE_FOLDER: 'vault:create-folder',
  RENAME_FILE: 'vault:rename-file',
  DELETE_FILE: 'vault:delete-file',
  SET_USER_CONTEXT: 'vault:set-user-context',
} as const
