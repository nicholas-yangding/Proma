/** 远程和已授权的图片可直接交给浏览器，其余路径必须由文件适配器解析。 */
export function canLoadLiveMarkdownImageDirectly(src: string): boolean {
  return /^(?:https?:|data:|blob:|proma-file:)/i.test(src)
}
