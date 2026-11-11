import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PermissionRequest } from '@proma/shared'
import { permissionService } from './agent-permission-service'
import { buildCreateBotTool } from './bots-create-tool'
import { BotsStore } from './bots-store'

const sessionId = 'bot-creation-test'
const workspace = { id: 'workspace-a', name: '研发项目' }
const draft = { name: ' 审阅员 ', instructions: '检查改动并列出问题。' }
let directory: string
let workspaceExists: boolean
let requests: PermissionRequest[]
let tool: ReturnType<typeof buildCreateBotTool>

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'proma-bot-approval-'))
  workspaceExists = true
  requests = []
  const store = new BotsStore({ directory })
  tool = buildCreateBotTool({
    sessionId,
    workspaceId: workspace.id,
    getWorkspace: (id) => workspaceExists && id === workspace.id ? workspace : undefined,
    saveBot: (input) => store.saveBot(input),
    onPermissionRequest: (request) => requests.push(request),
  })
})

afterEach(() => {
  permissionService.clearSessionPending(sessionId)
  rmSync(directory, { recursive: true, force: true })
})

function readBots() {
  return new BotsStore({ directory }).list().bots
}

describe('Bot 代建审批', () => {
  test('Given 待批准配置 When 用户批准 Then 只保存一次卡片中确认的 Bot', async () => {
    const result = tool.execute('create-1', draft)
    expect(readBots()).toEqual([])
    const [request] = requests
    if (!request) throw new Error('未收到审批')
    expect(request.allowAlways).toBe(false)
    expect(request.toolInput).toEqual({
      名称: '审阅员',
      职责指令: draft.instructions,
      默认项目: workspace.name,
      项目标识: workspace.id,
      模型: '跟随应用默认模型',
      执行模式: '计划模式',
    })
    expect(permissionService.respondToPermission(request.requestId, 'allow', true)).toBe(sessionId)
    expect(permissionService.respondToPermission(request.requestId, 'allow', false)).toBeNull()
    const { details } = await result
    expect(readBots()).toEqual([expect.objectContaining({
      ...details,
      name: '审阅员',
      instructions: draft.instructions,
      model: { kind: 'default' },
      permissionMode: 'plan',
      defaultWorkspaceId: workspace.id,
    })])
  })

  test('Given 上一次已批准 When 用户拒绝下一个申请 Then 第二个 Bot 不会写入', async () => {
    const first = tool.execute('create-1', draft)
    permissionService.respondToPermission(requests[0]!.requestId, 'allow', true)
    await first
    const second = tool.execute('create-2', { ...draft, name: '测试员' })
    expect(requests).toHaveLength(2)
    permissionService.respondToPermission(requests[1]!.requestId, 'deny', false)
    await expect(second).rejects.toThrow('用户拒绝')
    expect(readBots().map((bot) => bot.name)).toEqual(['审阅员'])
  })

  test('Given 运行已取消或等待审批时取消 When 尝试批准 Then 不会创建 Bot', async () => {
    const controller = new AbortController()
    const pending = tool.execute('create-1', draft, controller.signal)
    controller.abort()
    expect(permissionService.respondToPermission(requests[0]!.requestId, 'allow', false)).toBeNull()
    await expect(pending).rejects.toThrow('已取消')
    await expect(tool.execute('create-2', draft, controller.signal)).rejects.toThrow('已取消')
    expect(requests).toHaveLength(1)
    expect(readBots()).toEqual([])
  })

  test('Given 用户批准后运行立即中止 When 工具恢复 Then 不会保存 Bot', async () => {
    const controller = new AbortController()
    const result = tool.execute('create-1', draft, controller.signal)
    permissionService.respondToPermission(requests[0]!.requestId, 'allow', false)
    controller.abort()
    await expect(result).rejects.toThrow('已取消')
    expect(readBots()).toEqual([])
  })

  test('Given 项目在审批期间被移除 When 用户批准 Then 配置不会写入', async () => {
    const result = tool.execute('create-1', draft)
    workspaceExists = false
    permissionService.respondToPermission(requests[0]!.requestId, 'allow', false)
    await expect(result).rejects.toThrow('项目已被移除')
    expect(readBots()).toEqual([])
  })

  test('Given 模型传入现有 Bot ID 或请求提升权限 When 运行工具 Then 不会发起审批或写入', async () => {
    await expect(tool.execute('create-1', { ...draft, id: 'existing-bot' })).rejects.toThrow('Bot 配置无效')
    await expect(tool.execute('create-2', { ...draft, permissionMode: 'bypassPermissions' })).rejects.toThrow('Bot 配置无效')
    expect(requests).toEqual([])
    expect(readBots()).toEqual([])
  })
})
