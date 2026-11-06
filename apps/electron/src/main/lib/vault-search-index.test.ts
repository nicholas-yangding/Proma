import { describe, expect, test } from 'bun:test'
import { VaultTextIndex } from './vault-search-index'

function note(relativePath: string, content: string, modifiedAt = 1) {
  return { relativePath, content, size: Buffer.byteLength(content), modifiedAt }
}

describe('Vault 全文倒排索引', () => {
  test('Given 中文和英文只在正文中 When 输入第一个字符 Then 立即可以匹配并高亮', () => {
    const index = new VaultTextIndex()
    index.upsert(note('设计.md', '正文包含 灰度索引 与 Incremental'))
    for (const [query, expected] of [['灰', '灰'], ['i', 'I']] as const) {
      const hit = index.search(query).hits[0]!
      expect(hit.title).toBe('设计')
      expect(hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)).toBe(expected)
    }
    expect(index.search(' ').totalMatches).toBe(0)
  })

  test('Given 关键词只在正文尾部 When 搜索中英文子串 Then 返回文档标题与原文高亮', () => {
    const index = new VaultTextIndex()
    index.upsert(note('Research/会议记录.md', `${'前置资料\n'.repeat(1_000)}检索性能与 IncrementalIndex`))
    const hit = index.search('检索性能 incrementalindex').hits[0]!
    expect(hit.title).toBe('会议记录')
    expect(hit.relativePath).toBe('Research/会议记录.md')
    expect(hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)).toBe('检索性能')
    expect(index.search('mentalINDEX').hits[0]?.title).toBe('会议记录')
    expect(index.search('检索性能 不存在').totalMatches).toBe(0)
  })

  test('Given 多个文档具有相同二元组 When 词项实际不连续 Then 排除倒排候选假阳性', () => {
    const index = new VaultTextIndex()
    index.upsert(note('未命中.md', 'ab 分隔 bc'))
    index.upsert(note('命中.md', '正文包含 abc'))
    expect(index.search('abc').hits.map((hit) => hit.title)).toEqual(['命中'])
  })

  test('Given 正文含组合字符与合字 When 搜索归一化文字 Then 高亮完整的原文字符', () => {
    const index = new VaultTextIndex()
    index.upsert(note('Unicode.md', '🙂 Cafe\u0301 ＦＵＬＬ ﬃ'))
    for (const [query, original] of [['CAFÉ', 'Cafe\u0301'], ['full', 'ＦＵＬＬ'], ['ffi', 'ﬃ']] as const) {
      const hit = index.search(query).hits[0]!
      expect(hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)).toBe(original)
    }
  })

  test('Given 同名文件、标题和正文命中 When 结果较多 Then 标题优先并保留路径与总数', () => {
    const index = new VaultTextIndex()
    for (let i = 0; i < 40; i++) index.upsert(note(`folder-${i}/文档.md`, '全文关键字', i))
    index.upsert(note('标题/全文关键字.md', '标题命中'))
    const result = index.search('全文关键字')
    expect(result.totalMatches).toBe(41)
    expect(result.hits).toHaveLength(30)
    expect(result.hits[0]?.relativePath).toBe('标题/全文关键字.md')
    expect(result.hits[1]?.relativePath).toBe('folder-39/文档.md')
    expect(index.search(' '.repeat(257) + '全文关键字').totalMatches).toBe(0)
  })

  test('Given 内容替换和目录移除 When 再次搜索 Then 不返回过期正文', () => {
    const index = new VaultTextIndex()
    index.upsert(note('Folder/一.md', '旧关键词'))
    index.upsert(note('Folder2/二.md', '旧关键词'))
    index.upsert(note('Folder/一.md', '新关键词'))
    expect(index.search('旧关键词').hits.map((hit) => hit.relativePath)).toEqual(['Folder2/二.md'])
    index.removeDirectory('Folder')
    expect(index.search('新关键词').totalMatches).toBe(0)
    expect(index.search('旧关键词').totalMatches).toBe(1)
  })
})
