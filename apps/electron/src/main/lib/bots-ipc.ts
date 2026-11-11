import { ipcMain } from 'electron'
import { z } from 'zod'
import { BOTS_IPC_CHANNELS } from '@proma/shared'
import type { BotFileReference } from '@proma/shared'
import { getBotsService, resolveBotWorkspaceId } from './bots-service-instance'
import {
  saveBotInputSchema,
  createBotConversationInputSchema,
  updateBotConversationInputSchema,
  sendBotMessageInputSchema,
  stopBotRunInputSchema,
} from './bots-validation'

const idSchema = z.string().uuid()
const readSchema = z.object({ conversationId: idSchema, throughSeq: z.number().int().nonnegative() }).strict()

interface BotsIpcOptions {
  assertRenderer: (senderId: number) => void
  resolveFileReference: (file: BotFileReference, sessionIds: string[]) => BotFileReference
}

export function registerBotsIpcHandlers(options: BotsIpcOptions): void {
  ipcMain.handle(BOTS_IPC_CHANNELS.LIST, async (event) => {
    options.assertRenderer(event.sender.id)
    return (await getBotsService()).list()
  })
  ipcMain.handle(BOTS_IPC_CHANNELS.SAVE, async (event, input: unknown) => {
    options.assertRenderer(event.sender.id)
    const parsed = saveBotInputSchema.parse(input)
    return (await getBotsService()).saveBot({ ...parsed, defaultWorkspaceId: resolveBotWorkspaceId(parsed.defaultWorkspaceId) })
  })
  ipcMain.handle(BOTS_IPC_CHANNELS.ARCHIVE, async (event, input: unknown) => {
    options.assertRenderer(event.sender.id)
    return (await getBotsService()).archiveBot(idSchema.parse(input))
  })
  ipcMain.handle(BOTS_IPC_CHANNELS.CREATE_CONVERSATION, async (event, input: unknown) => {
    options.assertRenderer(event.sender.id)
    const parsed = createBotConversationInputSchema.parse(input)
    return (await getBotsService()).createConversation({ ...parsed, workspaceId: resolveBotWorkspaceId(parsed.workspaceId) })
  })
  ipcMain.handle(BOTS_IPC_CHANNELS.UPDATE_CONVERSATION, async (event, input: unknown) => {
    options.assertRenderer(event.sender.id)
    return (await getBotsService()).updateConversation(updateBotConversationInputSchema.parse(input))
  })
  ipcMain.handle(BOTS_IPC_CHANNELS.GET_CONVERSATION, async (event, input: unknown) => {
    options.assertRenderer(event.sender.id)
    return (await getBotsService()).get(idSchema.parse(input))
  })
  ipcMain.handle(BOTS_IPC_CHANNELS.SEND, async (event, input: unknown) => {
    options.assertRenderer(event.sender.id)
    const parsed = sendBotMessageInputSchema.parse(input)
    const instance = await getBotsService()
    const state = instance.get(parsed.conversationId)
    if (state.acceptedRequestIds.includes(parsed.requestId)) return state
    const sessionIds = state.bindings.map((binding) => binding.sessionId)
    const files = parsed.files?.map((file) => options.resolveFileReference(file, sessionIds))
    return instance.send({ ...parsed, files })
  })
  ipcMain.handle(BOTS_IPC_CHANNELS.STOP, async (event, input: unknown) => {
    options.assertRenderer(event.sender.id)
    return (await getBotsService()).stop(stopBotRunInputSchema.parse(input))
  })
  ipcMain.handle(BOTS_IPC_CHANNELS.MARK_READ, async (event, input: unknown) => {
    options.assertRenderer(event.sender.id)
    const parsed = readSchema.parse(input)
    return (await getBotsService()).markRead(parsed.conversationId, parsed.throughSeq)
  })
}
