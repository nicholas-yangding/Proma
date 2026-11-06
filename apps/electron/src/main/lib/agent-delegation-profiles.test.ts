import { describe, expect, it } from 'bun:test'
import { normalizeAgentDelegationProfiles, parseAgentDelegationMentions } from './agent-delegation-profiles'

const codex = {
  alias: 'codex',
  channelId: 'openai-channel',
  modelId: 'gpt-5.2',
  thinkingLevel: 'high',
} as const

describe('多 Agent 配置', () => {
  it('保存规范化后的别名和调度说明', () => {
    expect(normalizeAgentDelegationProfiles([{ ...codex, alias: ' @CoDeX ', description: ' 审查代码 ' }], true))
      .toEqual([{ ...codex, description: '审查代码' }])
  })

  it('读取旧配置时跳过无效项，保存时拒绝重复和保留别名', () => {
    expect(normalizeAgentDelegationProfiles(undefined)).toEqual([])
    expect(normalizeAgentDelegationProfiles([null, { ...codex, thinkingLevel: 'invalid' }, codex])).toEqual([codex])
    expect(() => normalizeAgentDelegationProfiles([codex, { ...codex, alias: 'CODEX' }], true)).toThrow('重复别名')
    expect(() => normalizeAgentDelegationProfiles([{ ...codex, alias: 'self' }], true)).toThrow('保留别名')
  })
})

describe('用户点名委派', () => {
  it('识别开头别名和行内联想项，按出现顺序去重', () => {
    expect(parseAgentDelegationMentions('@Codex @self 请@agent:codex 和 @agent:glm 独立审查。', [codex]))
      .toEqual({ aliases: ['codex', 'self', 'glm'], hasTask: true })
  })

  it('不把文件、链接、代码、引用或转义文本当作委派', () => {
    const message = [
      '<attached_files>\n- 示例: /tmp/@agent:glm\n</attached_files>',
      '<quoted_context source="agent-history">\n@agent:codex\n</quoted_context>',
      '> @agent:self',
      '~~~text\n@agent:codex\n~~~',
      '    @agent:codex',
      '`@agent:glm` [@agent:self](https://example.com) dev@agent:codex \\@agent:codex',
      '@file:codex',
    ].join('\n\n')
    expect(parseAgentDelegationMentions(message, [codex]).aliases).toEqual([])
  })

  it('跳过普通 @ 文本并识别缺少任务的点名', () => {
    expect(parseAgentDelegationMentions('讨论 @codex 和 @unknown。', [codex]).aliases).toEqual([])
    expect(parseAgentDelegationMentions('@unknown 请帮忙', [codex]).aliases).toEqual([])
    expect(parseAgentDelegationMentions('@agent:codex @self', [codex]))
      .toEqual({ aliases: ['codex', 'self'], hasTask: false })
    expect(parseAgentDelegationMentions('@self @agent:codex', [codex]))
      .toEqual({ aliases: ['self', 'codex'], hasTask: false })
  })
})
