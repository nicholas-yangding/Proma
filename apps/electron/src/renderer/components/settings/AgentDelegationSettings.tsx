import * as React from 'react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import type { AgentThinkingLevel, ModelOption, ReasoningCapability } from '@proma/shared'
import { AGENT_DELEGATION_ALIAS_PATTERN, CURRENT_AGENT_DELEGATION_ALIAS } from '@/types/settings'
import type { AgentDelegationProfile } from '@/types/settings'
import { channelsAtom } from '@/atoms/chat-atoms'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsInput, SettingsRow, SettingsSection, SettingsSelect } from './primitives'

const THINKING_LABELS: Record<AgentThinkingLevel, string> = {
  off: '关闭',
  minimal: '最小',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
}

const NO_REASONING: ReasoningCapability = { source: 'profile', levels: ['off'], defaultLevel: 'off' }

interface ProfileDraft {
  originalAlias?: string
  alias: string
  model: Pick<ModelOption, 'channelId' | 'modelId'> | null
  thinkingLevel?: AgentThinkingLevel
  description: string
}

const NEW_PROFILE: ProfileDraft = { alias: '', model: null, description: '' }

export function AgentDelegationSettings(): React.ReactElement {
  const channels = useAtomValue(channelsAtom)
  const [profiles, setProfiles] = React.useState<AgentDelegationProfile[] | null>(null)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [draft, setDraft] = React.useState<ProfileDraft | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [reasoning, setReasoning] = React.useState<ReasoningCapability | null>(null)
  const [reasoningFailed, setReasoningFailed] = React.useState(false)
  const channelId = draft?.model?.channelId
  const modelId = draft?.model?.modelId

  const loadProfiles = React.useCallback(async (): Promise<void> => {
    setLoadFailed(false)
    try {
      const settings = await window.electronAPI.getSettings()
      setProfiles(settings.agentDelegationProfiles ?? [])
    } catch {
      setLoadFailed(true)
    }
  }, [])

  React.useEffect(() => { void loadProfiles() }, [loadProfiles])

  React.useEffect(() => {
    if (!channelId || !modelId) return
    let cancelled = false
    void window.electronAPI.getPiReasoningCapability(channelId, modelId).then((capability) => {
      if (!cancelled) setReasoning(capability ?? NO_REASONING)
    }).catch(() => {
      if (!cancelled) setReasoningFailed(true)
    })
    return () => { cancelled = true }
  }, [channelId, modelId])

  const alias = draft?.alias.trim().replace(/^@/, '').toLowerCase() ?? ''
  const aliasError = alias && (
    !AGENT_DELEGATION_ALIAS_PATTERN.test(alias)
      ? '请使用字母开头的别名，仅可包含字母、数字和连字符，最多 32 个字符。'
      : alias === CURRENT_AGENT_DELEGATION_ALIAS
        ? '此别名由当前模型使用。'
        : profiles?.some((profile) => profile.alias === alias && profile.alias !== draft?.originalAlias)
          ? '此别名已存在。'
          : undefined
  )
  const channel = channels.find((item) => item.id === channelId && item.enabled)
  const modelAvailable = channel?.models.some((item) => item.id === modelId && item.enabled)
  const thinkingLevel = draft?.thinkingLevel && reasoning?.levels.includes(draft.thinkingLevel)
    ? draft.thinkingLevel
    : reasoning?.defaultLevel

  const openDraft = (profile: ProfileDraft): void => {
    setReasoning(null)
    setReasoningFailed(false)
    setDraft(profile)
  }

  const saveProfiles = async (next: AgentDelegationProfile[]): Promise<void> => {
    setSaving(true)
    try {
      const settings = await window.electronAPI.updateSettings({ agentDelegationProfiles: next })
      setProfiles(settings.agentDelegationProfiles ?? [])
      setDraft(null)
      toast.success('Agent 配置已保存')
    } catch (error) {
      toast.error('保存 Agent 配置失败', { description: error instanceof Error ? error.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  const submitDraft = (): void => {
    if (!profiles || !draft?.model || !alias || aliasError || !modelAvailable || !thinkingLevel) return
    const profile: AgentDelegationProfile = {
      ...draft.model,
      alias,
      thinkingLevel,
      description: draft.description.trim() || undefined,
    }
    const next = draft.originalAlias
      ? profiles.map((existing) => existing.alias === draft.originalAlias ? profile : existing)
      : [...profiles, profile]
    void saveProfiles(next)
  }

  if (loadFailed) {
    return (
      <SettingsSection title="多 Agent" description="无法读取 Agent 配置。">
        <Button size="sm" variant="outline" onClick={() => void loadProfiles()}>重试</Button>
      </SettingsSection>
    )
  }
  if (!profiles) return <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Agent 别名"
        description="在绑定项目的主 Agent 会话中，输入 @ 选择委派对象，或在消息开头输入 @别名。点名多个 Agent 时，子会话并行执行只读分析。主 Agent 可以根据配置自主委派。计划模式下需先批准计划。"
        action={<Button size="sm" disabled={!!draft || saving} onClick={() => openDraft(NEW_PROFILE)}>添加 Agent</Button>}
      >
        <SettingsCard>
          <SettingsRow
            label={`@${CURRENT_AGENT_DELEGATION_ALIAS}`}
            description="使用当前会话的模型和推理强度执行独立任务。"
          />
          {profiles.map((profile) => {
            const target = channels.find((item) => item.id === profile.channelId)
            const model = target?.models.find((item) => item.id === profile.modelId)
            return (
              <SettingsRow
                key={profile.alias}
                label={`@${profile.alias}`}
                description={
                  <>
                    <span>{target?.name ?? profile.channelId} · {model?.name ?? profile.modelId} · 推理{THINKING_LABELS[profile.thinkingLevel]}</span>
                    {(!target?.enabled || !model?.enabled) && <span className="ml-2 text-destructive">模型不可用</span>}
                    {profile.description && <span className="block">{profile.description}</span>}
                  </>
                }
              >
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={!!draft || saving} aria-label={`编辑 @${profile.alias}`} onClick={() => openDraft({
                    originalAlias: profile.alias,
                    alias: profile.alias,
                    model: { channelId: profile.channelId, modelId: profile.modelId },
                    thinkingLevel: profile.thinkingLevel,
                    description: profile.description ?? '',
                  })}>编辑</Button>
                  <Button size="sm" variant="ghost" disabled={!!draft || saving} aria-label={`移除 @${profile.alias}`} onClick={() => void saveProfiles(profiles.filter((item) => item.alias !== profile.alias))}>移除</Button>
                </div>
              </SettingsRow>
            )
          })}
        </SettingsCard>
      </SettingsSection>

      {draft && (
        <SettingsSection title={draft.originalAlias ? `编辑 @${draft.originalAlias}` : '添加 Agent'}>
          <SettingsCard>
            <SettingsInput
              label="别名"
              placeholder="例如 codex"
              value={draft.alias}
              onChange={(value) => setDraft({ ...draft, alias: value })}
              error={aliasError || undefined}
              disabled={saving}
            />
            <SettingsRow label="默认模型" description="复用已启用的渠道和模型。">
              <ModelSelector
                externalSelectedModel={draft.model}
                showChannelInTrigger
                onModelSelect={(option) => {
                  if (saving || (option.channelId === channelId && option.modelId === modelId)) return
                  openDraft({ ...draft, model: { channelId: option.channelId, modelId: option.modelId }, thinkingLevel: undefined })
                }}
              />
            </SettingsRow>
            <SettingsSelect
              label="默认推理强度"
              value={thinkingLevel ?? ''}
              options={(reasoning?.levels ?? []).map((level) => ({ value: level, label: THINKING_LABELS[level] }))}
              onValueChange={(value) => {
                const level = reasoning?.levels.find((item) => item === value)
                if (level) setDraft({ ...draft, thinkingLevel: level })
              }}
              placeholder={reasoningFailed ? '无法读取推理强度，请重新打开此配置' : draft.model ? '正在读取可用强度…' : '请先选择模型'}
              disabled={saving || !reasoning || !modelAvailable}
            />
            <SettingsInput
              label="调度说明（可选）"
              description="告诉主 Agent 何时应委派给这个 Agent。"
              placeholder="例如，适合独立审查代码和查找遗漏的边界条件"
              value={draft.description}
              onChange={(description) => setDraft({ ...draft, description })}
              disabled={saving}
            />
          </SettingsCard>
          <div className="flex gap-2">
            <Button size="sm" disabled={saving || !alias || !!aliasError || !modelAvailable || !thinkingLevel} onClick={submitDraft}>保存 Agent</Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>取消</Button>
          </div>
        </SettingsSection>
      )}
    </div>
  )
}
