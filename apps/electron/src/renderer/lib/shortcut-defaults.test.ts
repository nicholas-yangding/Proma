import { describe, expect, test } from 'bun:test'
import { DEFAULT_SHORTCUTS } from './shortcut-defaults'

test('Given 默认快捷键 When 使用 Command/Ctrl+K Then 搜索和清除上下文绑定不同', () => {
  const search = DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === 'global-search')
  const clear = DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === 'clear-context')
  expect(search).toMatchObject({ defaultMac: 'Cmd+K', defaultWin: 'Ctrl+K' })
  expect(clear?.defaultMac).not.toBe(search?.defaultMac)
  expect(clear?.defaultWin).not.toBe(search?.defaultWin)
})

describe('native zoom shortcuts', () => {
  test('includes readonly zoom controls for every Electron menu role', () => {
    expect(DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === 'zoom-in')).toMatchObject({
      defaultMac: 'Cmd+Plus',
      defaultWin: 'Ctrl+Plus',
      readonly: true,
    })
    expect(DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === 'zoom-out')).toMatchObject({
      defaultMac: 'Cmd+Minus',
      defaultWin: 'Ctrl+Minus',
      readonly: true,
    })
    expect(DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === 'reset-zoom')).toMatchObject({
      defaultMac: 'Cmd+0',
      defaultWin: 'Ctrl+0',
      readonly: true,
    })
  })
})
