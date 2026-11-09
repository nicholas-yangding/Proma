import { describe, expect, test } from 'bun:test'
import type { BotDefinition } from '@proma/shared'
import { getBotResponders, resolveBotMentions, validateBotMentionTargets } from './bots-routing'

function bot(id: string, name: string, archivedAt?: number): BotDefinition {
  return { id, name, avatar: '', instructions: '', model: { kind: 'default' }, defaultWorkspaceId: 'workspace-1', permissionMode: 'plan', createdAt: 0, updatedAt: 0, ...(archivedAt !== undefined ? { archivedAt } : {}) }
}

describe('Bots 提及和回应路由', () => {
  const research = bot('research', '研究员')
  const engineer = bot('engineer', '工程师')
  const lead = bot('lead', '产品经理')
  const members = [research, engineer, lead]

  test('Given 中文和 Markdown 提及 When 解析 Then 按出现顺序去重选择成员', () => {
    expect(resolveBotMentions('【@工程师】检查，再请 **@研究员** 复核 @工程师。', members).bots.map((item) => item.id)).toEqual(['engineer', 'research'])
  })

  test('Given URL、邮箱和词内 @ When 解析 Then 不会意外唤醒 Bot', () => {
    expect(resolveBotMentions('https://example.com/@研究员 name@工程师 资料@研究员', members).bots).toEqual([])
    expect(getBotResponders('https://example.com/@everyone user@everyone', members, { kind: 'mentions' })).toEqual([])
  })

  test('Given Bot 名称是另一个名称前缀 When 解析 Then 使用最长完整 Unicode 名称', () => {
    const peers = [bot('short', '研'), research, bot('long', '研究员助手')]
    expect(resolveBotMentions('@研究员助手 看一下', peers).bots.map((item) => item.id)).toEqual(['long'])
    expect(resolveBotMentions('@研究员其他人', peers).bots).toEqual([])
    expect(resolveBotMentions('@研究员2', peers).bots).toEqual([])
  })

  test('Given 同名 Bot When 未点选或明确点选 Then 返回歧义或选择对应身份', () => {
    const second = bot('research-2', '研究员')
    expect(resolveBotMentions('@研究员 请调研', [research, second]).ambiguous).toHaveLength(1)
    expect(() => validateBotMentionTargets('@研究员 请调研', [research, second], [])).toThrow('同名')
    expect(getBotResponders('@研究员 请调研', [research, second], { kind: 'mentions' })).toEqual([])
    expect(resolveBotMentions('@研究员 请调研', [research, second], [second.id]).bots.map((item) => item.id)).toEqual(['research-2'])
  })

  test('Given 显式提及 When 群默认负责人不同 Then 优先响应被点名成员', () => {
    expect(getBotResponders('@研究员 @工程师 分别回答', members, { kind: 'member', botId: lead.id }).map((item) => item.id)).toEqual(['research', 'engineer'])
  })

  test('Given 全员提及和归档成员 When 路由 Then 仅返回仍可回应的成员', () => {
    const archived = bot('archived', '旧 Bot', 10)
    expect(getBotResponders('请 @EVERYONE 回答', [...members, archived], { kind: 'mentions' }).map((item) => item.id)).toEqual(['research', 'engineer', 'lead'])
    expect(resolveBotMentions('@旧 Bot 请回答', [archived]).bots).toEqual([])
  })

  test('Given 未点名消息 When 使用不同群规则 Then 仅负责人、全员或无人回应', () => {
    expect(getBotResponders('讨论一下', members, { kind: 'member', botId: lead.id }).map((item) => item.id)).toEqual(['lead'])
    expect(getBotResponders('讨论一下', members, { kind: 'everyone' })).toEqual(members)
    expect(getBotResponders('讨论一下', members, { kind: 'mentions' })).toEqual([])
  })

  test('Given 被点选 ID 不在正文或不在群 When 路由 Then 不凭 ID 增加回应者并拒绝非法成员', () => {
    expect(getBotResponders('没有提及', members, { kind: 'mentions' }, [research.id])).toEqual([])
    expect(() => validateBotMentionTargets('@研究员', members, ['unknown'])).toThrow('不在')
    expect(resolveBotMentions('@不存在 请处理', members).bots).toEqual([])
  })
})
