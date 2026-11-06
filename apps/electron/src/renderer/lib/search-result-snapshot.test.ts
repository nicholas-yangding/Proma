import { describe, expect, test } from 'bun:test'
import { selectSearchResultSnapshot, type SearchResultScope } from './search-result-snapshot'

const scope: SearchResultScope = { mode: 'agent', vaultEnabled: true }
const first = { ...scope, query: '火车', rows: ['火车时刻表'] }

describe('全局搜索结果切换', () => {
  test('增删字符后，等待新结果时继续显示上次命中', () => {
    expect(selectSearchResultSnapshot({ ...scope, hasQuery: true, current: null, previous: first })).toEqual(first)
  })

  test('新搜索完成时直接替换旧结果，即使新结果没有命中', () => {
    const current = { ...scope, query: '火车站', rows: [] }
    expect(selectSearchResultSnapshot({ ...scope, hasQuery: true, current, previous: first })).toEqual(current)
  })

  test('清空关键词时立即回到初始状态', () => {
    expect(selectSearchResultSnapshot({ ...scope, hasQuery: false, current: null, previous: first })).toBeNull()
  })

  test('更换会话模式或 Vault 搜索范围时不展示旧范围的结果', () => {
    expect(selectSearchResultSnapshot({
      ...scope, mode: 'chat', hasQuery: true, current: null, previous: first,
    })).toBeNull()
    expect(selectSearchResultSnapshot({
      ...scope, vaultEnabled: false, hasQuery: true, current: null, previous: first,
    })).toBeNull()
  })
})
