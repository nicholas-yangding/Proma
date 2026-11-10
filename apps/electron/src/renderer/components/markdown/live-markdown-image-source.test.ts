import { describe, expect, test } from 'bun:test'
import { canLoadLiveMarkdownImageDirectly } from './live-markdown-image-source'

describe('Markdown 图片来源', () => {
  test('给定远程或已授权的图片，当预览时可以直接加载', () => {
    for (const src of ['https://cdn.example.com/a.png', 'http://example.com/a.png', 'data:image/png;base64,AA==', 'blob:abc', 'proma-file://token/a.png']) {
      expect(canLoadLiveMarkdownImageDirectly(src)).toBe(true)
    }
  })

  test('给定本地路径或不安全协议，当预览时不能直接加载', () => {
    for (const src of ['images/a.png', '../a.png', '/etc/passwd', 'file:///tmp/a.png', 'javascript:alert(1)', '']) {
      expect(canLoadLiveMarkdownImageDirectly(src)).toBe(false)
    }
  })
})
