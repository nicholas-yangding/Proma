import { describe, expect, test } from 'bun:test'
import { EditorState } from '@codemirror/state'
import { getLeadingFrontmatter, getLeadingFrontmatterRange, planPropertyEdit } from './live-markdown-frontmatter'

const clipping = [
  '---',
  'title: "剪藏标题" # 保留注释',
  'source: "https://example.com/clip?a=1"',
  'author:',
  '  - "[[作者]]"',
  'published:',
  'created: 2026-11-06',
  'description: "示例描述"',
  'tags:',
  '  - "clippings"',
  '---',
  '',
  '# 正文',
].join('\n')

function properties(document: string) {
  const lines = document.split('\n')
  const range = getLeadingFrontmatterRange(lines)
  return range && getLeadingFrontmatter(lines, range)
}

function property(document: string, name: string) {
  const entry = properties(document)?.find(({ key }) => key === name)
  if (!entry) throw new Error(`找不到属性 ${name}`)
  return entry
}

describe('Vault 笔记属性', () => {
  test('打开 Obsidian 剪藏时保留七项属性的结构和显示值', () => {
    expect(properties(clipping)?.map(({ key }) => key)).toEqual([
      'title', 'source', 'author', 'published', 'created', 'description', 'tags',
    ])
    expect(property(clipping, 'title').value).toMatchObject({ kind: 'scalar', text: '剪藏标题' })
    expect(property(clipping, 'source').value).toMatchObject({ kind: 'scalar', text: 'https://example.com/clip?a=1' })
    expect(property(clipping, 'author').value).toEqual({ kind: 'list', items: ['[[作者]]'] })
    expect(property(clipping, 'tags').value).toEqual({ kind: 'list', items: ['clippings'] })
    expect(property(clipping, 'published').value).toMatchObject({ kind: 'scalar', empty: true })
    expect(property(clipping, 'created').value).toMatchObject({ kind: 'scalar', text: '2026-11-06', date: true })
  })

  test('改标题时只替换目标标量并保留最新正文', () => {
    const state = EditorState.create({ doc: clipping + '\n用户刚写的内容' })
    const changes = planPropertyEdit(state.doc.toJSON(), property(clipping, 'title'), {
      key: 'title', text: '修订: "剪藏标题"',
    })
    const next = state.update({ changes }).state.doc.toString()
    expect(next).toBe(clipping.replace('"剪藏标题"', '"修订: \\"剪藏标题\\""') + '\n用户刚写的内容')
    expect(property(next, 'title').value).toMatchObject({ text: '修订: "剪藏标题"' })
  })

  test('普通属性仍可重命名、修改和删除', () => {
    const source = '---\nkey: simple\npublished: # 保留\nenabled: true\n---\n正文'
    let state = EditorState.create({ doc: source })
    state = state.update({ changes: planPropertyEdit(state.doc.toJSON(), property(source, 'key'), {
      key: 'name', text: 'true',
    }) }).state
    expect(state.doc.toString()).toBe(source.replace('key: simple', 'name: "true"'))

    state = state.update({ changes: planPropertyEdit(state.doc.toJSON(), property(source, 'published'), {
      key: 'published', text: '2026-11-06',
    }) }).state
    expect(state.doc.toString()).toContain('published: 2026-11-06 # 保留')

    state = state.update({ changes: planPropertyEdit(state.doc.toJSON(), property(source, 'enabled'), 'remove') }).state
    expect(state.doc.toString()).toBe('---\nname: "true"\npublished: 2026-11-06 # 保留\n---\n正文')
  })

  test('面板数据过期、重名或值类型不合法时保留文档', () => {
    const title = property(clipping, 'title')
    expect(planPropertyEdit(clipping.replace('剪藏标题', '外部修改').split('\n'), title, 'remove')).toEqual([])
    expect(planPropertyEdit(clipping.split('\n'), title, { key: 'source', text: '改名' })).toEqual([])
    const source = '---\nenabled: true # 保留\n---'
    const enabled = property(source, 'enabled')
    expect(planPropertyEdit(source.split('\n'), enabled, { key: 'enabled', text: 'false # 注入注释' })).toEqual([])
  })

  test('保留复杂值，缩进的分隔线属于 YAML 内容', () => {
    const source = '---\ntext: |\n  开始\n  ---\n  结束\nsettings:\n  key: value\n---\n正文'
    expect(getLeadingFrontmatterRange(source.split('\n'))).toEqual({ endLine: 8 })
    expect(property(source, 'text').value).toMatchObject({ kind: 'scalar', editableSource: null })
    expect(property(source, 'settings').value).toEqual({ kind: 'source' })
    expect(planPropertyEdit(source.split('\n'), property(source, 'settings'), 'remove')).toEqual([])
  })

  test('缺少结束分隔符、非法 YAML 和重复键都回退到源文档', () => {
    expect(properties('---\ntitle: hello')).toBeNull()
    expect(properties('---\ntitle: [hello\n---')).toBeNull()
    expect(properties('---\ntitle: a\ntitle: b\n---')).toBeNull()
  })
})
