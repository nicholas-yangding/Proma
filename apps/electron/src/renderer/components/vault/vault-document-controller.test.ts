import { expect, test } from 'bun:test'
import { VaultDocumentController } from './vault-document-controller'

test('Given 笔记带有 Vault 身份，When 保存草稿，Then 新基线仍可作为同一 Vault 的文件引用', async () => {
  const controller = new VaultDocumentController({ vaultId: 'vault-a', relativePath: 'Inbox/笔记.md', content: '旧内容', sha256: 'old', modifiedAt: 1 })
  controller.setDraft('新内容')
  await controller.flush(async () => ({ ok: true, relativePath: 'Inbox/笔记.md', sha256: 'new', modifiedAt: 2 }))
  expect(controller.getSnapshot().base).toEqual({ vaultId: 'vault-a', relativePath: 'Inbox/笔记.md', content: '新内容', sha256: 'new', modifiedAt: 2 })
})
