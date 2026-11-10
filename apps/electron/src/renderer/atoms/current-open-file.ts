import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import { previewFileMapAtom } from './preview-atoms'
import { agentDiffPanelTabAtom, agentSidePanelSplitMapAtom } from './agent-atoms'
import { getVaultSessionScope, selectedVaultFileAtomFamily, vaultReadResultAtomFamily } from './vault-atoms'
import type { CurrentOpenFile } from '@/lib/current-open-file'
import { getFocusedRightWorkspaceTab } from '@/lib/right-workspace-split'

export const currentOpenFileAtomFamily = atomFamily((sessionId: string) => atom((get): CurrentOpenFile | null => {
  const split = get(agentSidePanelSplitMapAtom).get(sessionId)
  const tab = split ? getFocusedRightWorkspaceTab(split) : get(agentDiffPanelTabAtom).get(sessionId)
  if (tab === 'vault') {
    const scope = getVaultSessionScope(sessionId)
    const selected = get(selectedVaultFileAtomFamily(scope))
    const read = get(vaultReadResultAtomFamily(scope))
    return selected && read?.relativePath === selected
      ? { kind: 'vault', vaultId: read.vaultId, relativePath: read.relativePath }
      : null
  }
  const preview = get(previewFileMapAtom).get(sessionId)
  return preview ? { kind: 'preview', path: preview.filePath } : null
}))
