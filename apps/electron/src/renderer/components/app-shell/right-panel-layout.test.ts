import { describe, expect, it } from 'bun:test'
import { clampRightPanelWidth, getWorkspaceDragWidth, MIN_MAIN_AREA_WIDTH } from './right-panel-layout'

describe('Agent 工作区分栏', () => {
  it('工作区在右侧时，向左拖动分隔线会加宽工作区', () => {
    expect(getWorkspaceDragWidth({ startWidth: 460, deltaX: -80, position: 'right' })).toBe(540)
  })

  it('工作区居中时，向右拖动分隔线会加宽工作区', () => {
    expect(getWorkspaceDragWidth({ startWidth: 460, deltaX: 80, position: 'center' })).toBe(540)
    expect(getWorkspaceDragWidth({ startWidth: 460, deltaX: -80, position: 'center' })).toBe(380)
  })

  it('窄窗口中加宽居中工作区时，仍为右侧 Agent 保留可操作的空间', () => {
    const viewportWidth = 960
    const sidebarWidth = 281
    const requestedWidth = getWorkspaceDragWidth({ startWidth: 320, deltaX: 800, position: 'center' })
    const workspaceWidth = clampRightPanelWidth(requestedWidth, viewportWidth, 720, sidebarWidth, true)

    expect(viewportWidth - sidebarWidth - workspaceWidth).toBe(MIN_MAIN_AREA_WIDTH)
  })
})
