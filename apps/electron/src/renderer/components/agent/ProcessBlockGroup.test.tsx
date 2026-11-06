import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import { agentProcessExpandedByDefaultAtom } from '@/atoms/ui-preferences'
import { ProcessBlockGroup } from './ProcessBlockGroup'

function renderProcess(isStreaming: boolean, expandByDefault?: boolean): string {
  const store = createStore()
  if (expandByDefault !== undefined) store.set(agentProcessExpandedByDefaultAtom, expandByDefault)
  return renderToStaticMarkup(
    <Provider store={store}>
      <ProcessBlockGroup
        blocks={[{ type: 'thinking', thinking: '思考内容' }]}
        isStreaming={isStreaming}
        renderChildren={() => <p>思考内容</p>}
      />
    </Provider>,
  )
}

describe('Agent 执行过程默认状态', () => {
  test('未设置偏好时，历史回复默认收起', () => {
    const history = renderProcess(false)
    expect(history).toContain('aria-expanded="false"')
    expect(history).not.toContain('思考内容')
  })

  test('开启默认展开后，历史回复显示思考内容', () => {
    const history = renderProcess(false, true)
    expect(history).toContain('aria-expanded="true"')
    expect(history).toContain('思考内容')
  })

  test('关闭默认展开后，仍可看到正在执行的过程', () => {
    expect(renderProcess(true, false)).toContain('aria-expanded="true"')
  })
})
