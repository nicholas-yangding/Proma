import { randomUUID } from 'node:crypto'
import type { AgentStreamPayload, BotConversation, BotDefinition, SDKAssistantMessage, SDKMessage } from '@proma/shared'
import { createInitialState, reduce } from './feishu/card-run-state'

export interface BotTurnInput {
  bot: BotDefinition
  conversation: BotConversation
  sessionId: string
  prompt: string
  systemPromptAppend: string
  inputThroughSeq: number
  additionalDirectories: string[]
}

export interface BotTurnResult {
  text: string
  stopped: boolean
  error?: string
}

export type BotTurnEvent = { kind: 'text'; text: string } | { kind: 'activity'; text: string }

export interface BotRuntime {
  ensureSession: (input: {
    conversationId: string
    botId: string
    workspaceId: string
    membershipStartedAfterSeq: number
  }) => string
  run: (input: BotTurnInput, emit: (event: BotTurnEvent) => void) => Promise<BotTurnResult>
  stop: (sessionId: string) => void
}

/** completion 包含整个会话，公开聊天只采用本轮最后一条 assistant 回复。 */
export function extractNewBotReply(messages: SDKMessage[], baselineIds: ReadonlySet<string>): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const candidate = messages[index]!
    if (candidate.type !== 'assistant') continue
    const message = candidate as SDKAssistantMessage
    if (!message.uuid || baselineIds.has(message.uuid)
      || message.parent_tool_use_id || message.error || message.isReplay) continue
    const text = message.message.content.flatMap((block) => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n\n')
    if (text.trim()) return text
  }
  return ''
}

export function createBotStreamProjection(emit: (event: BotTurnEvent) => void): (payload: AgentStreamPayload) => void {
  let state = createInitialState()
  let previousText = ''
  let previousActivity = ''
  return (payload) => {
    state = reduce(state, payload)
    const text = state.blocks.filter((block) => block.kind === 'text').map((block) => block.content).join('\n\n')
    if (text !== previousText) {
      previousText = text
      emit({ kind: 'text', text })
    }
    const runningTool = state.blocks.findLast((block) => block.kind === 'tool' && block.tool.status === 'running')
    const activity = runningTool?.kind === 'tool' ? `正在使用 ${runningTool.tool.name}` : state.reasoning.active ? '正在思考' : text ? '正在回复' : '正在处理'
    if (activity !== previousActivity) {
      previousActivity = activity
      emit({ kind: 'activity', text: activity })
    }
  }
}

export async function createBotsRuntime(): Promise<BotRuntime> {
  const [sessions, channels, settings, registry, agentService, workspaces] = await Promise.all([
    import('./agent-session-manager'),
    import('./channel-manager'),
    import('./settings-service'),
    import('./agent-headless-runner-registry'),
    import('./agent-service'),
    import('./agent-workspace-manager'),
  ])

  return {
    ensureSession(input) {
      if (!workspaces.getAgentWorkspace(input.workspaceId)) throw new Error('Bot 聊天绑定的项目不存在，请重新选择项目。')
      const existing = sessions.listAgentSessions().find((session) => session.botContext?.conversationId === input.conversationId
        && session.botContext.botId === input.botId
        && session.botContext.membershipStartedAfterSeq === input.membershipStartedAfterSeq)
      if (existing) return existing.id
      return sessions.createAgentSession('Bot 聊天', undefined, input.workspaceId, undefined, 'session', 'root', false, {
        botContext: {
          conversationId: input.conversationId,
          botId: input.botId,
          membershipStartedAfterSeq: input.membershipStartedAfterSeq,
        },
      }).id
    },
    async run(input, emit) {
      if (!workspaces.getAgentWorkspace(input.conversation.workspaceId)) throw new Error('Bot 聊天绑定的项目不存在。')
      const appSettings = settings.getSettings()
      const channelId = input.bot.model.kind === 'fixed' ? input.bot.model.channelId : appSettings.agentChannelId
      const channel = channelId ? channels.getChannelById(channelId) : undefined
      if (!channel?.enabled) throw new Error('请为 Bot 选择已启用的模型渠道。')
      const modelId = input.bot.model.kind === 'fixed' ? input.bot.model.modelId : appSettings.agentModelId ?? channel.models.find((model) => model.enabled)?.id
      if (!modelId || !channel.models.some((model) => model.id === modelId && model.enabled)) throw new Error('Bot 的模型不存在或未启用。')
      const baselineIds = new Set(sessions.getAgentSessionSDKMessages(input.sessionId).flatMap((message) => 'uuid' in message && typeof message.uuid === 'string' ? [message.uuid] : []))
      let result: BotTurnResult = { text: '', stopped: false }
      let streamedText = ''
      const startedAt = Date.now()
      const project = createBotStreamProjection((event) => {
        if (event.kind === 'text') streamedText = event.text
        emit(event)
      })
      const unsubscribe = agentService.agentEventBus.on((sessionId, payload) => {
        if (sessionId !== input.sessionId) return
        if (payload.kind === 'sdk_delta' && payload.delta.runStartedAt !== undefined && payload.delta.runStartedAt !== startedAt) return
        if (payload.kind === 'sdk_message' && payload.message.type === 'assistant' && typeof payload.message.uuid === 'string' && baselineIds.has(payload.message.uuid)) return
        project(payload)
      })
      try {
        await registry.runRegisteredHeadlessAgent({
          sessionId: input.sessionId,
          userMessage: input.prompt,
          userMessageUuid: randomUUID(),
          channelId: channel.id,
          modelId,
          workspaceId: input.conversation.workspaceId,
          additionalDirectories: input.additionalDirectories,
          permissionModeOverride: input.bot.permissionMode,
          triggeredBy: 'external',
          startedAt,
        }, {
          source: 'bots',
          onError(error) { result.error = error },
          onComplete(_messages, options) {
            result.text = extractNewBotReply(sessions.getAgentSessionSDKMessages(input.sessionId), baselineIds)
            result.stopped = options?.stoppedByUser ?? false
          },
          onTitleUpdated() {},
        }, { systemPromptAppend: input.systemPromptAppend })
        if (!result.text && result.stopped) result.text = streamedText
        return result
      } finally {
        unsubscribe()
      }
    },
    stop(sessionId) { registry.stopRegisteredAgent(sessionId) },
  }
}
