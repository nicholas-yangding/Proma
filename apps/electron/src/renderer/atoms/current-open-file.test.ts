import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import type { VaultReadResult } from '@proma/shared'
import { agentDiffPanelTabAtom, agentSidePanelSplitMapAtom } from './agent-atoms'
import { previewFileMapAtom } from './preview-atoms'
import { selectedVaultFileAtomFamily, vaultReadResultAtomFamily } from './vault-atoms'
import { currentOpenFileAtomFamily } from './current-open-file'

function openVault(store: ReturnType<typeof createStore>, scope: string, relativePath = 'Inbox/当前笔记.md'): void {
  const read: VaultReadResult = { vaultId: 'vault-a', relativePath, content: '正文', sha256: 'digest', modifiedAt: 1 }
  store.set(selectedVaultFileAtomFamily(scope), relativePath)
  store.set(vaultReadResultAtomFamily(scope), read)
}

describe('Agent 当前文件跟随工作区文档', () => {
  test('Given 普通预览已打开，When 查看文件标签，Then 保留原文件引用', () => {
    const store = createStore()
    store.set(previewFileMapAtom, new Map([['agent-a', { filePath: '/project/app.ts' }]]))
    store.set(agentDiffPanelTabAtom, new Map([['agent-a', 'preview:file-a']]))
    expect(store.get(currentOpenFileAtomFamily('agent-a'))).toEqual({ kind: 'preview', path: '/project/app.ts' })
  })

  test('Given 普通预览和 Obsidian 都有文档，When 切到 Obsidian，Then 引用当前笔记而非旧预览', () => {
    const store = createStore()
    store.set(previewFileMapAtom, new Map([['agent-a', { filePath: '/project/old.md' }]]))
    store.set(agentDiffPanelTabAtom, new Map([['agent-a', 'vault']]))
    openVault(store, 'agent-a')
    expect(store.get(currentOpenFileAtomFamily('agent-a'))).toEqual({ kind: 'vault', vaultId: 'vault-a', relativePath: 'Inbox/当前笔记.md' })
  })

  test('Given Obsidian 尚未读取新选择，When 读取当前文件，Then 不引用旧笔记或旧普通预览', () => {
    const store = createStore()
    store.set(previewFileMapAtom, new Map([['agent-a', { filePath: '/project/old.md' }]]))
    store.set(agentDiffPanelTabAtom, new Map([['agent-a', 'vault']]))
    openVault(store, 'agent-a')
    store.set(selectedVaultFileAtomFamily('agent-a'), 'Inbox/正在加载.md')
    expect(store.get(currentOpenFileAtomFamily('agent-a'))).toBeNull()
    store.set(selectedVaultFileAtomFamily('agent-a'), null)
    expect(store.get(currentOpenFileAtomFamily('agent-a'))).toBeNull()
  })

  test('Given 两个 Agent 打开不同笔记，When 读取各自当前文件，Then 不混用会话', () => {
    const store = createStore()
    store.set(agentDiffPanelTabAtom, new Map([['agent-a', 'vault'], ['agent-b', 'vault']]))
    openVault(store, 'agent-a', 'Inbox/A.md')
    openVault(store, 'agent-b', 'Inbox/B.md')
    expect(store.get(currentOpenFileAtomFamily('agent-a'))).toMatchObject({ relativePath: 'Inbox/A.md' })
    expect(store.get(currentOpenFileAtomFamily('agent-b'))).toMatchObject({ relativePath: 'Inbox/B.md' })
    expect(store.get(currentOpenFileAtomFamily('agent-c'))).toBeNull()
  })

  test('Given 并排焦点与旧标签不同，When 从 Vault 切到预览 Pane，Then 引用随实际焦点切换', () => {
    const store = createStore()
    openVault(store, 'agent-a')
    store.set(previewFileMapAtom, new Map([['agent-a', { filePath: '/project/app.ts' }]]))
    store.set(agentDiffPanelTabAtom, new Map([['agent-a', 'preview:file-a']]))
    store.set(agentSidePanelSplitMapAtom, new Map([['agent-a', { leftTab: 'vault', rightTab: 'preview:file-a', focusedPane: 'left', ratio: 0.5 }]]))
    expect(store.get(currentOpenFileAtomFamily('agent-a'))).toMatchObject({ kind: 'vault' })
    store.set(agentSidePanelSplitMapAtom, new Map([['agent-a', { leftTab: 'vault', rightTab: 'preview:file-a', focusedPane: 'right', ratio: 0.5 }]]))
    expect(store.get(currentOpenFileAtomFamily('agent-a'))).toEqual({ kind: 'preview', path: '/project/app.ts' })
  })
})
