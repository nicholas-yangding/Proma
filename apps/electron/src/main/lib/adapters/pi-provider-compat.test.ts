import { describe, expect, test } from 'bun:test'
import { supportsPiDeveloperRole } from './pi-provider-compat'

describe('Pi developer 角色兼容策略', () => {
  test('Given 原生 OpenAI 渠道 When 检查角色能力 Then 保留 developer 角色', () => {
    expect(supportsPiDeveloperRole('openai')).toBe(true)
    expect(supportsPiDeveloperRole('openai-responses')).toBe(true)
  })

  test('Given 只支持 system 的兼容渠道 When 检查角色能力 Then 禁用 developer 角色', () => {
    expect(supportsPiDeveloperRole('doubao-api')).toBe(false)
    expect(supportsPiDeveloperRole('qwen')).toBe(false)
    expect(supportsPiDeveloperRole('custom')).toBe(false)
  })
})
