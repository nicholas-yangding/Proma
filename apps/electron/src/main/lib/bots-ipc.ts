import { app, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import { BOTS_IPC_CHANNELS } from '@proma/shared'
import type { BotsService } from './bots-service'
import type { BotFileReference } from '@proma/shared'
import { BotsStore } from './bots-store'
import { createBotsRuntime } from './bots-runtime'
import {
  saveBotInputSchema,
  createBotConversationInputSchema,
  updateBotConversationInputSchema,
  sendBotMessageInputSchema,
  stopBotRunInputSchema,
} from './bots-validation'
import { getConfigDir } from './config-paths'
import { ensureDefaultWorkspace, getAgentWorkspace } from './agent-workspace-manager'

const idSchema = z.string().uuid()
const readSchema = z.object({ conversationId: idSchema, throughSeq: z.number().int().nonnegative() }).strict()

interface BotsIpcOptions {
  assertRenderer: (senderId: number) => void
  getWindow: () => BrowserWindow | null
  resolveFileReference: (file: BotFileReference, sessionIds: string[]) => BotFileReference
}

export function registerBotsIpcHandlers(options: BotsIpcOptions): void {
  let servicePromise: Promise<BotsService> | undefined
  const service = (): Promise<BotsService> => {
    if (!servicePromise) {
      servicePromise = Promise.all([import('./bots-service'), createBotsRuntime()]).then(([module, runtime]) => {
        const instance = new module.BotsService({ store: new BotsStore({ directory: join(getConfigDir(), 'bots') }), runtime })
        instance.subscribe((event) => {
          const window = options.getWindow()
          if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(BOTS_IPC_CHANNELS.EVENT, event)
        })
        app.once('before-quit', () => instance.dispose())
        return instance
      }).catch((error: unknown) => {
        servicePromise = undefined
        throw error
      })
    }
    return servicePromise
  }
  const workspaceId = (requested: string): string => {
    const workspace = requested ? getAgentWorkspace(requested) : ensureDefaultWorkspace()
    if (!workspace) throw new Error('所选项目不存在，请重新选择。')
    return workspace.id
  }
  ipcMain.handle(BOTS_IPC_CHANNELS.LIST, async (event) => {
    options.assertRenderer(event.sender.id)
    return (await service()).list()
  })
  ipcMain.handle(BOTS_IPC_CHANNELS.SAVE, async (event, input: unknown) => {
    options.assertRenderer(event.sender.id)
    const parsed = saveBotInputSchema.parse(input)
    return (await service()).saveBot({ ...parsed, defaultWorkspaceId: workspaceId(parsed.defaultWorkspaceId) })
  })
  ipcMain.handle(BOTS_IPC_CHANNELS.ARCHIVE, async (event, input: unknown) => {
    options.assertRenderer(event.sender.id)
    return (await service()).archiveBot(idSchema.parse(input))
  })
  ipcMain.handle(BOTS_IPC_CHANNELS.CREATE_CONVERSATION, async (event, input: unknown) => {
    options.assertRenderer(event.sender.id)
    const parsed = createBotConversationInputSchema.parse(input)
    return (await service()).createConversation({ ...parsed, workspaceId: workspaceId(parsed.workspaceId) })
  })
  ipcMain.handle(BOTS_IPC_CHANNELS.UPDATE_CONVERSATION, async (event, input: unknown) => {
    options.assertRenderer(event.sender.id)
    return (await service()).updateConversation(updateBotConversationInputSchema.parse(input))
  })
  ipcMain.handle(BOTS_IPC_CHANNELS.GET_CONVERSATION, async (event, input: unknown) => {
    options.assertRenderer(event.sender.id)
    return (await service()).get(idSchema.parse(input))
  })
  ipcMain.handle(BOTS_IPC_CHANNELS.SEND, async (event, input: unknown) => {
    options.assertRenderer(event.sender.id)
    const parsed = sendBotMessageInputSchema.parse(input)
    const instance = await service()
    const state = instance.get(parsed.conversationId)
    if (state.acceptedRequestIds.includes(parsed.requestId)) return state
    const sessionIds = state.bindings.map((binding) => binding.sessionId)
    const files = parsed.files?.map((file) => options.resolveFileReference(file, sessionIds))
    return instance.send({ ...parsed, files })
  })
  ipcMain.handle(BOTS_IPC_CHANNELS.STOP, async (event, input: unknown) => {
    options.assertRenderer(event.sender.id)
    return (await service()).stop(stopBotRunInputSchema.parse(input))
  })
  ipcMain.handle(BOTS_IPC_CHANNELS.MARK_READ, async (event, input: unknown) => {
    options.assertRenderer(event.sender.id)
    const parsed = readSchema.parse(input)
    return (await service()).markRead(parsed.conversationId, parsed.throughSeq)
  })
}
