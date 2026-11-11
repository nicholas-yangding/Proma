import type { BotDefinition } from '@proma/shared'
import { getChannelById } from './channel-manager'
import { getSettings } from './settings-service'

export function resolveBotModel(bot: BotDefinition): { channelId: string; modelId: string } {
  const settings = getSettings()
  const channelId = bot.model.kind === 'fixed' ? bot.model.channelId : settings.agentChannelId
  const channel = channelId ? getChannelById(channelId) : undefined
  if (!channel?.enabled) throw new Error('请为 Bot 选择已启用的模型渠道。')
  const modelId = bot.model.kind === 'fixed' ? bot.model.modelId : settings.agentModelId ?? channel.models.find((model) => model.enabled)?.id
  if (!modelId || !channel.models.some((model) => model.id === modelId && model.enabled)) {
    throw new Error('Bot 的模型不存在或未启用。')
  }
  return { channelId: channel.id, modelId }
}
