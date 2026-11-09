import { z } from 'zod'
import { isAbsolute } from 'node:path'

export const botIdSchema = z.string().regex(/^[\w-]{1,128}$/, '标识格式无效')
const seqSchema = z.number().int().nonnegative()
const timeSchema = z.number().finite().nonnegative()
const nameSchema = z.string().trim().min(1, '名称不能为空').max(100)
const titleSchema = z.string().trim().min(1, '聊天标题不能为空').max(200)
const instructionsSchema = z.string().refine((value) => Buffer.byteLength(value, 'utf8') <= 24_000, '职责指令不能超过 24000 字节')
const inputWorkspaceSchema = z.string().max(128)
const memberIdsSchema = z.array(botIdSchema).min(1, '至少选择一位 Bot').max(20).refine((ids) => new Set(ids).size === ids.length, '不能重复选择成员')

export const botModelSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('default') }).strict(),
  z.object({ kind: z.literal('fixed'), channelId: botIdSchema, modelId: z.string().trim().min(1).max(300) }).strict(),
])

export const botResponderSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('member'), botId: botIdSchema }).strict(),
  z.object({ kind: z.literal('mentions') }).strict(),
  z.object({ kind: z.literal('everyone') }).strict(),
])

const botFields = {
  name: nameSchema,
  avatar: z.string().trim().max(64),
  instructions: instructionsSchema,
  model: botModelSelectionSchema,
  defaultWorkspaceId: botIdSchema,
  permissionMode: z.enum(['plan', 'bypassPermissions']),
}

export const saveBotInputSchema = z.object({
  ...botFields,
  id: botIdSchema.optional(),
  defaultWorkspaceId: inputWorkspaceSchema,
}).strict()

export const botDefinitionSchema = z.object({
  ...botFields,
  id: botIdSchema,
  createdAt: timeSchema,
  updatedAt: timeSchema,
  archivedAt: timeSchema.optional(),
}).strict()

export const createBotConversationInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('direct'), botId: botIdSchema, title: titleSchema, workspaceId: inputWorkspaceSchema }).strict(),
  z.object({
    kind: z.literal('group'), memberBotIds: memberIdsSchema, title: titleSchema,
    workspaceId: inputWorkspaceSchema, responder: botResponderSchema, instructions: instructionsSchema,
  }).strict(),
])

export const updateBotConversationInputSchema = z.object({
  conversationId: botIdSchema,
  title: titleSchema.optional(),
  archived: z.boolean().optional(),
  memberBotIds: memberIdsSchema.optional(),
  responder: botResponderSchema.optional(),
  instructions: instructionsSchema.optional(),
}).strict()

const mentionIdsSchema = z.array(botIdSchema).max(20).refine((ids) => new Set(ids).size === ids.length, '提及成员不能重复')
const fileReferencesSchema = z.array(z.object({
  path: z.string().min(1).max(4096).refine((path) => isAbsolute(path) && !path.includes('\0'), '文件引用必须是绝对路径'),
  name: z.string().min(1).max(255),
  isDirectory: z.boolean(),
  sourceSessionId: botIdSchema.optional(),
}).strict()).max(20)

export const sendBotMessageInputSchema = z.object({
  conversationId: botIdSchema,
  requestId: botIdSchema,
  text: z.string().trim().min(1, '消息不能为空').max(100_000),
  mentionedBotIds: mentionIdsSchema,
  files: fileReferencesSchema.optional(),
}).strict()

export const stopBotRunInputSchema = z.object({
  conversationId: botIdSchema,
  runId: botIdSchema.optional(),
}).strict()

const membershipSchema = z.object({
  botId: botIdSchema,
  joinedAfterSeq: seqSchema,
  leftAfterSeq: seqSchema.optional(),
}).strict()

const conversationFields = {
  id: botIdSchema,
  title: titleSchema,
  workspaceId: botIdSchema,
  createdAt: timeSchema,
  updatedAt: timeSchema,
  readThroughSeq: seqSchema,
  archivedAt: timeSchema.optional(),
}

const conversationSchema = z.discriminatedUnion('kind', [
  z.object({ ...conversationFields, kind: z.literal('direct'), botId: botIdSchema }).strict(),
  z.object({
    ...conversationFields, kind: z.literal('group'), members: z.array(membershipSchema),
    responder: botResponderSchema, instructions: instructionsSchema,
  }).strict(),
])

const senderSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user') }).strict(),
  z.object({ kind: z.literal('system') }).strict(),
  z.object({ kind: z.literal('bot'), botId: botIdSchema, name: nameSchema, avatar: z.string().max(64) }).strict(),
])

const messageSchema = z.object({
  id: botIdSchema,
  seq: z.number().int().positive(),
  sender: senderSchema,
  text: z.string(),
  createdAt: timeSchema,
  mentionedBotIds: mentionIdsSchema,
  runId: botIdSchema.optional(),
  sessionId: botIdSchema.optional(),
  files: fileReferencesSchema.optional(),
}).strict()

const runStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('queued') }).strict(),
  z.object({ kind: z.literal('running'), startedAt: timeSchema }).strict(),
  z.object({ kind: z.literal('completed'), finishedAt: timeSchema }).strict(),
  z.object({ kind: z.literal('failed'), finishedAt: timeSchema, error: z.string() }).strict(),
  z.object({ kind: z.literal('cancelled'), finishedAt: timeSchema }).strict(),
  z.object({ kind: z.literal('interrupted'), finishedAt: timeSchema }).strict(),
])

const runSchema = z.object({
  id: botIdSchema, roundId: botIdSchema, botId: botIdSchema, sessionId: botIdSchema,
  inputThroughSeq: seqSchema, outputMessageId: botIdSchema,
  reason: z.enum(['user', 'mention', 'summary']), state: runStateSchema,
  activity: z.string().optional(),
}).strict()

export const botConversationStateSchema = z.object({
  version: z.literal(1),
  revision: seqSchema,
  conversation: conversationSchema,
  messages: z.array(messageSchema),
  bindings: z.array(z.object({
    botId: botIdSchema, sessionId: botIdSchema,
    membershipStartedAfterSeq: seqSchema, consumedThroughSeq: seqSchema,
  }).strict()),
  runs: z.array(runSchema),
  pending: z.array(z.object({
    requestId: botIdSchema, text: z.string().min(1).max(100_000),
    mentionedBotIds: mentionIdsSchema, queuedAt: timeSchema,
    files: fileReferencesSchema.optional(),
  }).strict()),
  acceptedRequestIds: z.array(botIdSchema),
}).strict().superRefine((state, context) => {
  const fail = (message: string): void => { context.addIssue({ code: 'custom', message }) }
  const maxSeq = state.messages.at(-1)?.seq ?? 0
  if (state.conversation.readThroughSeq > maxSeq) fail('已读位置超出消息范围')
  let previousSeq = 0
  for (const message of state.messages) {
    if (message.seq <= previousSeq) fail('消息序号必须递增')
    previousSeq = message.seq
  }
  if (new Set(state.messages.map((message) => message.id)).size !== state.messages.length) fail('消息标识不能重复')
  if (new Set(state.runs.map((run) => run.id)).size !== state.runs.length) fail('运行标识不能重复')
  if (new Set(state.pending.map((pending) => pending.requestId)).size !== state.pending.length) fail('排队请求不能重复')
  if (new Set(state.acceptedRequestIds).size !== state.acceptedRequestIds.length) fail('已接收请求不能重复')
  if (new Set(state.bindings.map((binding) => `${binding.botId}:${binding.membershipStartedAfterSeq}`)).size !== state.bindings.length) fail('成员执行绑定不能重复')
  if (new Set(state.bindings.map((binding) => binding.sessionId)).size !== state.bindings.length) fail('不同成员不能共享执行会话')
  if (state.bindings.some((binding) => binding.consumedThroughSeq < binding.membershipStartedAfterSeq || binding.consumedThroughSeq > maxSeq)) fail('成员处理位置无效')
  if (state.runs.some((run) => run.inputThroughSeq > maxSeq)) fail('运行输入位置超出消息范围')
  if (state.conversation.kind === 'group') {
    const active = state.conversation.members.filter((member) => member.leftAfterSeq === undefined)
    if (new Set(active.map((member) => member.botId)).size !== active.length) fail('群成员不能重复')
    if (state.conversation.members.some((member) => member.joinedAfterSeq > maxSeq || (member.leftAfterSeq !== undefined && (member.leftAfterSeq < member.joinedAfterSeq || member.leftAfterSeq > maxSeq)))) fail('成员历史范围无效')
    const responder = state.conversation.responder
    if (responder.kind === 'member' && !active.some((member) => member.botId === responder.botId)) fail('负责人必须是当前成员')
  }
})

export const botDefinitionsFileSchema = z.object({ version: z.literal(1), bots: z.array(botDefinitionSchema) }).strict().superRefine((file, context) => {
  if (new Set(file.bots.map((bot) => bot.id)).size !== file.bots.length) context.addIssue({ code: 'custom', message: 'Bot 标识不能重复' })
})
