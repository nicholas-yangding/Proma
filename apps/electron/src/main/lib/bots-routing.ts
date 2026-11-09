/**
 * Copyright 2026 Milind Soni and OpenMausBot contributors.
 * Licensed under the Apache License, Version 2.0.
 * 改编自 OpenMausBot 1de1164 的 mention-boundary、room-mentions 和 roomResponders。
 * 使用 Proma 的持久 Bot 与回应策略类型，归档 Bot 不参与路由。
 */
import type { BotDefinition, BotResponder } from '@proma/shared'

const OPENING_MENTION_BOUNDARY = /[(*_~[{<'"\u2018\u201c\u3008\u300a\u300c\u300e\u3010\uff08]/u

function isMentionBoundary(text: string, at: number): boolean {
  if (at === 0) return true
  const before = text[at - 1]
  return before !== undefined && (/\s/u.test(before) || OPENING_MENTION_BOUNDARY.test(before))
}

function isMentionNameContinuation(value: string | undefined): boolean {
  return value !== undefined && /^[\p{L}\p{N}\p{M}_]/u.test(value)
}

export interface ResolvedBotMentions<T> {
  bots: T[]
  ambiguous: T[][]
}

export function resolveBotMentions<T extends { id: string; name: string; archivedAt?: number }>(
  text: string,
  peers: readonly T[],
  picked: readonly string[] = [],
): ResolvedBotMentions<T> {
  const candidates = peers.filter((peer) => peer.archivedAt === undefined && peer.name.trim()).sort((a, b) => b.name.length - a.name.length)
  const bots: T[] = []
  const ambiguous: T[][] = []
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    if (!isMentionBoundary(text, at)) continue
    const named = (peer: T): boolean => text.slice(at + 1, at + 1 + peer.name.length).toLowerCase() === peer.name.toLowerCase()
    const hit = candidates.find((peer) => named(peer) && !isMentionNameContinuation(text.slice(at + 1 + peer.name.length)))
    if (!hit) continue
    const sharing = candidates.filter((peer) => peer.name.toLowerCase() === hit.name.toLowerCase())
    const chosen = sharing.filter((peer) => picked.includes(peer.id))
    if (sharing.length > 1 && !chosen.length && !ambiguous.some((group) => group[0] === sharing[0])) ambiguous.push(sharing)
    for (const peer of sharing.length > 1 && chosen.length ? chosen : sharing) if (!bots.includes(peer)) bots.push(peer)
  }
  return { bots, ambiguous }
}

export function getBotResponders(
  text: string,
  members: readonly BotDefinition[],
  responder: BotResponder,
  picked: readonly string[] = [],
): BotDefinition[] {
  const available = members.filter((member) => member.archivedAt === undefined)
  const everyone = 'everyone'
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    if (isMentionBoundary(text, at) && text.slice(at + 1, at + 1 + everyone.length).toLowerCase() === everyone && !isMentionNameContinuation(text.slice(at + 1 + everyone.length))) return available
  }
  const { bots, ambiguous } = resolveBotMentions(text, available, picked)
  const mentioned = bots.filter((bot) => !ambiguous.some((sharing) => sharing.includes(bot)))
  if (mentioned.length) return mentioned
  if (responder.kind === 'everyone') return available
  if (responder.kind === 'member') {
    const lead = available.find((member) => member.id === responder.botId)
    return lead ? [lead] : []
  }
  return []
}

export function validateBotMentionTargets(
  text: string,
  members: readonly BotDefinition[],
  picked: readonly string[],
): void {
  const available = members.filter((member) => member.archivedAt === undefined)
  if (picked.some((id) => !available.some((member) => member.id === id))) throw new Error('提及的 Bot 不在当前聊天中')
  if (resolveBotMentions(text, available, picked).ambiguous.length) throw new Error('存在同名 Bot，请从提及列表选择具体成员')
}
