import type { FileIndexEntry, VaultFileReferenceInput } from '@proma/shared'
import { pinCurrentFileEntry } from '@/components/file-browser/file-mention-pin'

interface PreviewCurrentFile {
  kind: 'preview'
  path: string
}

interface VaultCurrentFile extends VaultFileReferenceInput {
  kind: 'vault'
}

export type CurrentOpenFile = PreviewCurrentFile | VaultCurrentFile

interface CurrentFileMentionInput {
  currentFileRef: { readonly current: CurrentOpenFile | null }
  query: string
  searchFiles: () => Promise<FileIndexEntry[]>
  resolveVaultFile: (input: VaultFileReferenceInput) => Promise<string | null>
}

export async function loadCurrentFileMention(input: CurrentFileMentionInput): Promise<ReturnType<typeof pinCurrentFileEntry>> {
  const currentFile = input.currentFileRef.current
  const pathPromise = currentFile?.kind === 'vault'
    ? input.resolveVaultFile(currentFile).catch(() => null)
    : Promise.resolve(currentFile?.path ?? null)
  const [entries, path] = await Promise.all([input.searchFiles(), pathPromise])
  const latest = input.currentFileRef.current
  const unchanged = currentFile?.kind === 'vault'
    ? latest?.kind === 'vault' && currentFile.vaultId === latest.vaultId && currentFile.relativePath === latest.relativePath
    : currentFile?.kind === 'preview'
      ? latest?.kind === 'preview' && currentFile.path === latest.path
      : latest === null
  return pinCurrentFileEntry(entries, unchanged ? path : null, input.query)
}
