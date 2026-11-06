# 模型配置（渠道管理）

## Sub-features

- 渠道增删改：设置 → "模型配置" tab（`ChannelSettings.tsx` / `ChannelForm.tsx`），添加渠道需选类型并填 API key。
- 删除确认：AlertDialog，标题文案"确定删除渠道？"。
- 渠道持久化与连通：保存后配置落盘；真实连通需有效 key。

## How to get to it (user POV)

主界面左下角齿轮 → 设置面板 → 左侧"模型配置" → 添加渠道，选择渠道类型、填写名称与 API key 后保存。

## Driving it with Chrome DevTools Protocol (CDP)

```bash
node "$CDP" click '[aria-label="打开设置"]'
node "$CDP" clickText "模型配置"
node "$CDP" eval $CDP_PORT "document.body.innerText.slice(0, 2000)"   # 探查"添加"入口真实文案
node "$CDP" clickText "添加"        # 或表单实际按钮文案
# 表单驱动：字段 selector 以 eval 探查为准，逐项 type；填入无效 key 走校验路径
node "$CDP" screenshot $CDP_PORT "$EVIDENCE_DIR/channels-01-form.png"

# 通过标准（表单校验/保存路径）：保存后渠道列表出现新条目 + 配置落盘
node "$CDP" eval $CDP_PORT "document.body.innerText.includes('<渠道名>')"
find "$VFY_HOME/.proma-dev" -name "*channel*" -type f   # 复制到 $EVIDENCE_DIR
```

## Gotchas

- **完整连通验证需要真实 API key**（生产边界外部系统）：无 key 时旅程止步于"表单可打开、必填校验生效、保存/报错 UI 正确"，这是合法的部分验证，如实标注覆盖范围。
- 填入无效 key 时失败可能发生在"保存时校验"或"发送时连通"两个阶段，以实际观察为准，写进证据。
- 删除渠道是危险操作，验证时只删自己创建的测试渠道；确认弹窗文案"确定删除渠道？"。
- 渠道配置涉及 key 明文，截图与证据复制前先把 key 字段打码。
