import { app } from 'electron'
import { join } from 'node:path'
import { BOTS_IPC_CHANNELS } from '@proma/shared'
import type { BotsService } from './bots-service'
import { BotsStore } from './bots-store'
import { createBotsRuntime } from './bots-runtime'
import { ensureDefaultWorkspace, getAgentWorkspace } from './agent-workspace-manager'
import { getConfigDir } from './config-paths'
import { getMainWindow } from './main-window-store'

let servicePromise: Promise<BotsService> | undefined

export function getBotsService(): Promise<BotsService> {
  servicePromise ??= Promise.all([import('./bots-service'), createBotsRuntime()]).then(([{ BotsService }, runtime]) => {
    const service = new BotsService({ store: new BotsStore({ directory: join(getConfigDir(), 'bots') }), runtime })
    service.subscribe((event) => {
      const window = getMainWindow()
      if (window && !window.webContents.isDestroyed()) window.webContents.send(BOTS_IPC_CHANNELS.EVENT, event)
    })
    app.once('before-quit', () => service.dispose())
    return service
  }).catch((error: unknown) => {
    servicePromise = undefined
    throw error
  })
  return servicePromise
}

export function resolveBotWorkspaceId(requested: string): string {
  const workspace = requested ? getAgentWorkspace(requested) : ensureDefaultWorkspace()
  if (!workspace) throw new Error('所选项目不存在，请重新选择。')
  return workspace.id
}
