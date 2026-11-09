import { atom } from 'jotai'
import { appModeAtom } from './app-mode'
import { currentAgentSessionIdAtom } from './agent-atoms'
import { botsWorkspaceSessionIdAtom } from './bot-atoms'

/** 文件工作区身份独立于上次查看的 Agent 会话。 */
export const workspaceSessionIdAtom = atom((get) => get(appModeAtom) === 'bots'
  ? get(botsWorkspaceSessionIdAtom)
  : get(currentAgentSessionIdAtom))
