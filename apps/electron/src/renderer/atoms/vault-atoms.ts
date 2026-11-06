import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { VaultReadResult } from '@proma/shared'

/** A renderer can host several Agent sessions, each with independent Vault navigation. */
export function getVaultSessionScope(sessionId?: string): string {
  return sessionId ?? '__standalone_vault__'
}

export const selectedVaultFileAtomFamily = atomFamily((sessionScope: string) => atom<string | null>(null))
/** Transient navigation target for an Obsidian context chip; not Agent state. */
export const focusedVaultFolderAtomFamily = atomFamily((sessionScope: string) => atom<string | null>(null))
export const vaultReadResultAtomFamily = atomFamily((sessionScope: string) => atom<VaultReadResult | null>(null))
export const vaultRefreshTokenAtom = atom(0)

export interface VaultOpenRequest {
  scope: string
  vaultId: string
  relativePath: string
}

/** 由目标 VaultView 消费，确保打开结果也经过现有的草稿保存流程。 */
export const vaultOpenRequestAtom = atom<VaultOpenRequest | null>(null)
