import MarkdownIt from 'markdown-it'
import type { AgentThinkingLevel } from '@proma/shared'
import {
  AGENT_DELEGATION_ALIAS_PATTERN,
  AGENT_DELEGATION_ALIAS_SOURCE,
  AGENT_DELEGATION_MENTION_SOURCE,
  CURRENT_AGENT_DELEGATION_ALIAS,
  type AgentDelegationProfile,
} from '../../types'

const THINKING_LEVELS: readonly AgentThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const LEADING_ALIAS = new RegExp(`^(?:[ \\t]*\\r?\\n)* {0,3}@(?:(agent):)?(${AGENT_DELEGATION_ALIAS_SOURCE})(?=\\s|$)`, 'i')
const AGENT_MENTION = new RegExp(AGENT_DELEGATION_MENTION_SOURCE, 'gi')
const GENERATED_CONTEXT = /<(attached_files|quoted_file|quoted_context)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g
const markdown = new MarkdownIt({ html: true }).disable('text_join')

function normalizeProfile(input: unknown): AgentDelegationProfile | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  if (!('alias' in input) || typeof input.alias !== 'string'
    || !('channelId' in input) || typeof input.channelId !== 'string'
    || !('modelId' in input) || typeof input.modelId !== 'string'
    || !('thinkingLevel' in input)) return undefined

  const alias = input.alias.trim().replace(/^@/, '').toLowerCase()
  const channelId = input.channelId.trim()
  const modelId = input.modelId.trim()
  const thinkingLevel = THINKING_LEVELS.find((level) => level === input.thinkingLevel)
  if (!AGENT_DELEGATION_ALIAS_PATTERN.test(alias) || alias === CURRENT_AGENT_DELEGATION_ALIAS
    || !channelId || !modelId || !thinkingLevel) return undefined

  const description = 'description' in input && typeof input.description === 'string'
    ? input.description.trim().slice(0, 500)
    : undefined
  return { alias, channelId, modelId, thinkingLevel, ...(description && { description }) }
}

export function normalizeAgentDelegationProfiles(input: unknown, strict = false): AgentDelegationProfile[] {
  if (!Array.isArray(input)) {
    if (strict) throw new Error('多 Agent 配置必须是列表')
    return []
  }
  const profiles = new Map<string, AgentDelegationProfile>()
  for (const item of input) {
    const profile = normalizeProfile(item)
    if (!profile || profiles.has(profile.alias)) {
      if (strict) throw new Error('多 Agent 配置包含无效字段、保留别名或重复别名')
      continue
    }
    profiles.set(profile.alias, profile)
  }
  return [...profiles.values()]
}

export function parseAgentDelegationMentions(
  rawMessage: string,
  profiles: readonly AgentDelegationProfile[],
): { aliases: string[]; hasTask: boolean } {
  if (!rawMessage.includes('@')) return { aliases: [], hasTask: true }

  let text = rawMessage.replace(GENERATED_CONTEXT, '\n')
  const aliases = new Set<string>()
  const configured = new Set([CURRENT_AGENT_DELEGATION_ALIAS, ...profiles.map(({ alias }) => alias)])
  for (let match = LEADING_ALIAS.exec(text); match; match = LEADING_ALIAS.exec(text)) {
    const alias = match[2]!.toLowerCase()
    if (!match[1] && !configured.has(alias)) break
    aliases.add(alias)
    text = text.slice(match[0].length).replace(/^[ \t]+(?=@)/, ' ')
  }
  if (!text.toLowerCase().includes('@agent:')) return { aliases: [...aliases], hasTask: text.trim().length > 0 }

  let hasTask = false
  let quoteDepth = 0
  for (const token of markdown.parse(text, {})) {
    if (token.type === 'blockquote_open') quoteDepth++
    if (token.type === 'blockquote_close') quoteDepth--
    if (quoteDepth > 0 || !token.children) {
      hasTask ||= Boolean(token.content.trim())
      continue
    }
    let inLink = false
    for (const child of token.children) {
      if (child.type === 'link_open') inLink = true
      if (child.type === 'link_close') inLink = false
      if (child.type !== 'text' || inLink) {
        hasTask ||= Boolean(child.content.trim())
        continue
      }
      const remaining = child.content.replace(AGENT_MENTION, (_full, alias: string) => {
        aliases.add(alias.toLowerCase())
        return ''
      })
      hasTask ||= Boolean(remaining.trim())
    }
  }
  return { aliases: [...aliases], hasTask }
}
