import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { CREATE_BOT_TOOL_NAME } from '@proma/shared'
import type { AgentWorkspace, BotDefinition, PermissionRequest, SaveBotInput } from '@proma/shared'
import { permissionService } from './agent-permission-service'
import { createBotToolInputSchema } from './bots-validation'

interface CreateBotToolContext {
  sessionId: string
  workspaceId: string
  getWorkspace: (id: string) => Pick<AgentWorkspace, 'id' | 'name'> | undefined
  saveBot: (input: SaveBotInput) => BotDefinition
  onPermissionRequest: (request: PermissionRequest) => void
}

export function buildCreateBotTool(context: CreateBotToolContext) {
  const label = '创建 Bot'
  return {
    name: CREATE_BOT_TOOL_NAME,
    label,
    description: '请求用户批准创建一个新的本地 Bot。仅在用户要求创建时调用。新 Bot 使用当前聊天项目、应用默认模型和计划模式。每次创建都需要单独批准。',
    promptSnippet: '提交新 Bot 的配置并等待用户单次批准。',
    parameters: Type.Object({
      name: Type.String({ description: '新 Bot 的名称', minLength: 1, maxLength: 100 }),
      instructions: Type.String({ description: '新 Bot 的职责指令' }),
    }, { additionalProperties: false }),
    async execute(toolCallId: string, rawInput: unknown, signal: AbortSignal = new AbortController().signal) {
      if (signal.aborted) throw new Error('已取消创建 Bot。')
      const parsed = createBotToolInputSchema.safeParse(rawInput)
      if (!parsed.success) throw new Error('Bot 配置无效。请提供名称和职责指令。')
      const workspace = context.getWorkspace(context.workspaceId)
      if (!workspace) throw new Error('当前聊天项目不存在。')
      const input: SaveBotInput = {
        ...parsed.data,
        avatar: '',
        model: { kind: 'default' },
        defaultWorkspaceId: workspace.id,
        permissionMode: 'plan',
      }
      const result = await permissionService.requestSingleApproval(
        context.sessionId,
        CREATE_BOT_TOOL_NAME,
        {
          名称: input.name,
          职责指令: input.instructions,
          默认项目: workspace.name,
          项目标识: input.defaultWorkspaceId,
          模型: '跟随应用默认模型',
          执行模式: '计划模式',
        },
        { signal, toolUseID: toolCallId, displayName: label, description: '批准后将保存以下 Bot 配置。' },
        context.onPermissionRequest,
      )
      if (signal.aborted) throw new Error('已取消创建 Bot。')
      if (result.behavior !== 'allow') throw new Error(result.message)
      if (!context.getWorkspace(input.defaultWorkspaceId)) throw new Error('审批期间项目已被移除，请重新选择。')
      const bot = context.saveBot(input)
      const details = { id: bot.id, name: bot.name }
      return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details }
    },
  } satisfies ToolDefinition
}
