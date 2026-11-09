import { z } from 'zod'

const requestSchema = z.object({
  model: z.string().optional(),
  stream: z.boolean().optional(),
  messages: z.array(z.object({ role: z.string(), content: z.unknown().optional() }).passthrough()),
  tools: z.array(z.object({
    function: z.object({
      name: z.string(),
      parameters: z.object({ properties: z.record(z.string(), z.unknown()).optional() }).passthrough().optional(),
    }).passthrough(),
  }).passthrough()).optional(),
}).passthrough()

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((part: unknown) => part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' ? [part.text] : []).join('\n')
}

let requests = 0
const port = Number(process.env.BOTS_VERIFY_PORT ?? 18787)
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.endsWith('/models')) {
      return Response.json({ object: 'list', data: [{ id: 'gpt-4.1-mini', object: 'model', owned_by: 'local-verification' }] })
    }
    if (!url.pathname.endsWith('/chat/completions')) return new Response('Not found', { status: 404 })
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: { message: parsed.error.message } }, { status: 400 })
    const input = parsed.data
    const system = input.messages.filter((message) => message.role === 'system' || message.role === 'developer').map((message) => contentText(message.content)).join('\n')
    const role = /验证角色=([^\s]+)/u.exec(system)?.[1] ?? 'Bot'
    const userIndex = input.messages.findLastIndex((message) => message.role === 'user')
    const prompt = contentText(input.messages[userIndex]?.content)
    const task = prompt.split(/【公共消息 \d+ · 用户】\n/u).at(-1) ?? prompt
    const toolResult = input.messages.slice(userIndex + 1).some((message) => message.role === 'tool')
    const writer = input.tools?.find((tool) => /^(write|Write|write_file)$/u.test(tool.function.name))
    const createFile = task.includes('生成验证文件') && !toolResult && writer
    const questioner = input.tools?.find((tool) => tool.function.name === 'AskUserQuestion')
    const askQuestion = task.includes('询问验证偏好') && !toolResult && questioner
    const reader = input.tools?.find((tool) => /^(read|Read|read_file)$/u.test(tool.function.name))
    const referencedPath = /用户明确引用的文件：\n([^\n]+)/u.exec(prompt)?.[1]
    const readReference = task.includes('验证读取引用') && referencedPath && !toolResult && reader
    const callId = 'call_bots_verify_' + ++requests
    const model = input.model ?? 'gpt-4.1-mini'
    const id = 'chatcmpl-bots-' + requests
    const created = Math.floor(Date.now() / 1000)
    console.log(JSON.stringify({ request: requests, role, model, fileTool: createFile ? writer.function.name : null, streamed: input.stream === true }))
    let text = role + '已完成本轮检查。'
    if (role === '研究员') text = '研究员已核对资料。建议采用长期 Bot、独立话题和群内明确分工。'
    if (role === '工程师') text = toolResult ? '工程师已生成[验证文件](bots-proof.md)。' : '工程师已检查源码。每位成员使用独立 Pi Session，公共聊天单独持久化。'
    if ((role === '主持人' || role === '产品经理') && prompt.includes('分工') && !prompt.includes('此轮只做汇总')) text = '@研究员 请检查交互。\n@工程师 请检查源码。'
    if (prompt.includes('此轮只做汇总')) text = role + '已汇总团队结果。研究与源码检查均已完成。'
    if (task.includes('询问验证偏好') && toolResult) text = role + '已收到验证选择，继续完成任务。'
    if (task.includes('验证读取引用') && toolResult) text = input.messages.slice(userIndex + 1).some((message) => message.role === 'tool' && contentText(message.content).includes('文件由真实 Pi 文件工具生成'))
      ? role + '已读取引用文件，内容包含“文件由真实 Pi 文件工具生成”。' : '引用文件读取失败。'
    const args = writer?.function.parameters?.properties?.file_path !== undefined
      ? { file_path: 'bots-proof.md', content: '# Bots 验证\n\n文件由真实 Pi 文件工具生成。\n' }
      : { path: 'bots-proof.md', content: '# Bots 验证\n\n文件由真实 Pi 文件工具生成。\n' }
    const toolCall = createFile ? { id: callId, type: 'function', function: { name: writer.function.name, arguments: JSON.stringify(args) } }
      : askQuestion ? { id: callId, type: 'function', function: { name: questioner.function.name, arguments: JSON.stringify({ questions: [{ question: '请选择验证偏好', header: '验证偏好', options: [{ label: '简洁', description: '给出简洁结论' }, { label: '详细', description: '说明完整过程' }] }] }) } }
        : readReference ? { id: callId, type: 'function', function: { name: reader.function.name, arguments: JSON.stringify(reader.function.parameters?.properties?.file_path !== undefined ? { file_path: referencedPath } : { path: referencedPath }) } }
          : undefined
    if (!input.stream) {
      return Response.json({ id, object: 'chat.completion', created, model,
        choices: [{ index: 0, message: { role: 'assistant', content: toolCall ? null : text, ...(toolCall ? { tool_calls: [toolCall] } : {}) }, finish_reason: toolCall ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } })
    }
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (delta: object, finish: string | null = null): void => {
          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n'))
        }
        try {
          send({ role: 'assistant' })
          if (toolCall) send({ tool_calls: [{ index: 0, ...toolCall }] })
          else {
            const chunks = task.includes('慢速') ? Array.from(text) : [text]
            for (const chunk of chunks) {
              if (request.signal.aborted) break
              send({ content: chunk })
              if (task.includes('慢速')) await Bun.sleep(250)
            }
          }
          send({}, toolCall ? 'tool_calls' : 'stop')
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch {
          // 停止运行会取消 HTTP 流。
        }
      },
    })
    return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' } })
  },
})
console.log('Bots 验证模型端点 http://127.0.0.1:' + server.port + '/v1')
