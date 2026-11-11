import type { ToolDefinition } from '@earendil-works/pi-coding-agent'

/** 仅主进程创建，不接受 renderer 提供的系统指令或工具定义。 */
export interface AgentRunExtensions {
  piCustomTools?: ToolDefinition[]
  systemPromptAppend?: string
  scheduledBot?: true
}
