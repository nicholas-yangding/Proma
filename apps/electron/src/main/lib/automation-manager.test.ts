import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeJsonFileAtomic } from './safe-file'

let home: string
let indexPath: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'proma-automation-'))
  const config = join(home, '.proma-dev')
  mkdirSync(config)
  indexPath = join(config, 'automations.json')
})

afterEach(() => rmSync(home, { recursive: true, force: true }))

function verifyAutomation(code: string): void {
  const manager = JSON.stringify(join(import.meta.dir, 'automation-manager.ts'))
  const result = Bun.spawnSync({
    cmd: [process.execPath, '--eval', `
      import assert from 'node:assert/strict'
      import { createAutomation, updateAutomation, getAutomation, listAutomations, setLastSessionId } from ${manager}
      ${code}
    `],
    env: { ...process.env, HOME: home, PROMA_DEV: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

describe('定时任务执行者', () => {
  test('Given 旧任务仅配置模型，When 重新加载并更新任务，Then 保留模型和启用状态', () => {
    writeJsonFileAtomic(indexPath, { version: 4, automations: [{
      id: 'legacy', name: '原模型任务', prompt: '运行检查', scheduleType: 'interval', intervalMinutes: 15,
      channelId: 'legacy-channel', modelId: 'legacy-model', workspaceId: 'workspace', active: true,
      createdAt: 1, updatedAt: 1, nextRunAt: 1, runHistory: [],
    }] })
    verifyAutomation(`
      const task = updateAutomation({ id: 'legacy', name: '模型任务' })
      assert.equal(task.active, true)
      assert.equal(task.channelId, 'legacy-channel')
      assert.equal(task.modelId, 'legacy-model')
      assert.equal(task.executor, undefined)
    `)
    expect(JSON.parse(readFileSync(indexPath, 'utf8')).automations[0]).toMatchObject({ name: '模型任务', active: true })
  })

  test('Given 一次性任务仅配置 Bot，When 保存并重新加载，Then 保留启用状态、Bot 和指定执行时间', () => {
    const scheduledAt = Date.now() + 60_000
    verifyAutomation(`
      createAutomation({ name: 'Bot 任务', prompt: '运行检查', scheduleType: 'once', intervalMinutes: 10,
        scheduledAt: ${scheduledAt}, channelId: '', workspaceId: 'workspace', executor: { kind: 'bot', botId: 'researcher' } })
    `)
    verifyAutomation(`
      const [task] = listAutomations()
      assert.equal(task.active, true)
      assert.equal(task.nextRunAt, ${scheduledAt})
      assert.deepEqual(task.executor, { kind: 'bot', botId: 'researcher' })
      assert.equal(task.channelId, '')
    `)
  })

  test('Given 已运行的 Bot 任务，When 切换执行者，Then 新执行者不复用旧会话', () => {
    verifyAutomation(`
      const { id } = createAutomation({ name: 'Bot 任务', prompt: '运行检查', scheduleType: 'interval', intervalMinutes: 15,
        channelId: 'fallback-channel', workspaceId: 'workspace', executor: { kind: 'bot', botId: 'researcher' } })
      setLastSessionId(id, 'researcher-session')
      assert.equal(updateAutomation({ id, name: '改名' }).lastSessionId, 'researcher-session')
      assert.equal(updateAutomation({ id, executor: { kind: 'bot', botId: 'reviewer' } }).lastSessionId, undefined)
      setLastSessionId(id, 'reviewer-session')
      const task = updateAutomation({ id, executor: null })
      assert.equal(task.lastSessionId, undefined)
      assert.equal(task.executor, undefined)
      assert.equal(task.channelId, 'fallback-channel')
      assert.equal(task.active, true)
    `)
  })

  test('Given 未配置项目的 Bot 草稿，When 尝试启用，Then 保留草稿和原配置', () => {
    verifyAutomation(`
      const { id } = createAutomation({ name: 'Bot 草稿', prompt: '运行检查', scheduleType: 'interval', intervalMinutes: 15,
        channelId: '', executor: { kind: 'bot', botId: 'researcher' } })
      assert.throws(() => updateAutomation({ id, executor: { kind: 'bot', botId: 'reviewer' }, active: true }))
      assert.equal(getAutomation(id).active, false)
      assert.deepEqual(getAutomation(id).executor, { kind: 'bot', botId: 'researcher' })
    `)
  })
})
