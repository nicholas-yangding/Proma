import { describe, expect, test } from 'bun:test'
import {
  buildAgentSessionTrees,
  reduceCollapsedRailPopoverState,
  type CollapsedRailPopoverState,
} from '@/lib/collapsed-agent-rail'

describe('Bots 私有执行会话', () => {
  test('given 普通会话与 Bot 执行会话 when 构建 Agent 列表 then 只展示普通会话', () => {
    const normal = { id: 'normal', title: '普通会话', createdAt: 1, updatedAt: 1 }
    const bot = { id: 'bot-session', title: '研究员', createdAt: 1, updatedAt: 2,
      botContext: { conversationId: 'room', botId: 'researcher', membershipStartedAfterSeq: 0 } }
    expect(buildAgentSessionTrees([normal, bot]).map((item) => item.session.id)).toEqual(['normal'])
  })
})

describe('折叠态 Rail Popover 状态', () => {
  const openState: CollapsedRailPopoverState = {
    openPopoverId: 'parent-a',
    snapshotIds: ['parent-a', 'parent-b'],
  }

  test('given B 已打开 when A 的延迟关闭到达 then 保留 B 的 snapshot', () => {
    const stateAfterBOpens = reduceCollapsedRailPopoverState(openState, {
      type: 'open',
      id: 'parent-b',
      snapshotIds: ['parent-b', 'parent-a'],
    })

    const result = reduceCollapsedRailPopoverState(stateAfterBOpens, {
      type: 'close',
      id: 'parent-a',
    })

    expect(result).toBe(stateAfterBOpens)
    expect(result).toEqual({
      openPopoverId: 'parent-b',
      snapshotIds: ['parent-b', 'parent-a'],
    })
  })

  test('given A 已打开 when A 关闭 then 清理当前面板和 snapshot', () => {
    expect(reduceCollapsedRailPopoverState(openState, {
      type: 'close',
      id: 'parent-a',
    })).toEqual({
      openPopoverId: null,
      snapshotIds: null,
    })
  })

  test('given A 已打开 when B 打开 then 使用 B 的最新入口 snapshot', () => {
    expect(reduceCollapsedRailPopoverState(openState, {
      type: 'open',
      id: 'parent-b',
      snapshotIds: ['parent-b', 'parent-c'],
    })).toEqual({
      openPopoverId: 'parent-b',
      snapshotIds: ['parent-b', 'parent-c'],
    })
  })
})
