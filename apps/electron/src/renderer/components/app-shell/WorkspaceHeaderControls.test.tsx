import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import { agentSidePanelOpenAtomFamily, agentWorkspacePositionAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { WorkspaceHeaderControls } from './WorkspaceHeaderControls'

function renderControls(store: ReturnType<typeof createStore>, scopeId: string): string {
  return renderToStaticMarkup(
    <Provider store={store}>
      <WorkspaceHeaderControls scopeId={scopeId} chatLabel="聊天" />
    </Provider>,
  )
}

describe('工作区头部控件', () => {
  test('Given 工作区已展开，When 显示控件，Then 保留布局菜单且不重复显示展开按钮', () => {
    const store = createStore()
    store.set(agentSidePanelOpenAtomFamily('topic-a'), true)

    const controls = renderControls(store, 'topic-a')

    expect(controls).toContain('aria-label="工作区布局"')
    expect(controls).not.toContain('aria-label="展开工作区"')
  })

  test('Given 工作区已折叠，When 显示控件，Then 显示布局菜单与展开按钮', () => {
    const store = createStore()
    store.set(agentSidePanelOpenAtomFamily('topic-a'), false)

    const controls = renderControls(store, 'topic-a')

    expect(controls).toContain('aria-label="工作区布局"')
    expect(controls).toContain('aria-label="展开工作区"')
  })

  test('Given 无运行绑定的 Bot 聊天已折叠且 Agent 工作区展开，When 显示 Bot 控件，Then 按 Bot 的独立 scope 显示展开按钮', () => {
    const store = createStore()
    store.set(currentAgentSessionIdAtom, 'agent-a')
    store.set(agentSidePanelOpenAtomFamily('agent-a'), true)
    store.set(agentSidePanelOpenAtomFamily('bots:conversation:topic-a'), false)

    expect(renderControls(store, 'bots:conversation:topic-a')).toContain('aria-label="展开工作区"')
    expect(renderControls(store, 'agent-a')).not.toContain('aria-label="展开工作区"')
  })

  test('Given 文件居中且工作区折叠，When 显示展开按钮，Then 使用左侧面板图标', () => {
    const store = createStore()
    store.set(agentSidePanelOpenAtomFamily('topic-a'), false)
    store.set(agentWorkspacePositionAtom, 'center')

    expect(renderControls(store, 'topic-a')).toContain('lucide-panel-left')
  })

  test('Given 文件在右且工作区折叠，When 显示展开按钮，Then 使用右侧面板图标', () => {
    const store = createStore()
    store.set(agentSidePanelOpenAtomFamily('topic-a'), false)
    store.set(agentWorkspacePositionAtom, 'right')

    expect(renderControls(store, 'topic-a')).toContain('lucide-panel-right')
  })
})
