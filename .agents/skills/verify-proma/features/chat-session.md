# Chat 会话（新建与发送）

## Sub-features

- 新建会话：主界面新建入口创建空白会话。
- 发送消息：输入框（textarea）输入文本，发送按钮或回车提交，消息进入会话流。
- 会话切换：左侧会话列表点击切换历史会话。

## How to get to it (user POV)

完成引导后进入主界面，在底部输入框打字，点发送（或回车）。会话列表在左侧，可随时切换。

## Driving it with Chrome DevTools Protocol (CDP)

```bash
# 前置：已完成 onboarding，处于主界面
node "$CDP" eval $CDP_PORT "document.body.innerText.slice(0, 2000)"   # 探查新建会话入口与输入框状态
node "$CDP" type $CDP_PORT "textarea" "验证消息：verify-proma 冒烟"
node "$CDP" screenshot $CDP_PORT "$EVIDENCE_DIR/chat-01-typed.png"
node "$CDP" clickText "发送"    # 若无按钮则 eval：document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))

# 通过标准（有真实渠道时）：消息出现在会话流、收到回复、会话文件落盘
node "$CDP" screenshot $CDP_PORT "$EVIDENCE_DIR/chat-02-sent.png"
find "$VFY_HOME/.proma-dev" -newer "$EVIDENCE_DIR/chat-01-typed.png" -type f   # 复制新增会话文件到 $EVIDENCE_DIR
```

## Gotchas

- **发送依赖已配置的模型渠道（真实 API key）**。空配置实例上发送会被应用引导去配置渠道——这是预期失败：如实报告"缺渠道前置条件"，并把它记录在此，不要 mock 渠道来让旅程变绿。
- 会话持久化位置以 `$VFY_HOME/.proma-dev/` 下实际新增的 JSON/JSONL 为准（agent-session-manager 管理），不要假设文件名。
- 输入框是 tiptap 富文本编辑器，`type` 子命令用原生 value setter + input 事件；若应用用了 contenteditable 而非 textarea，改用 eval 注入文本事件后回车。
- 回复是流式的：截图判定通过前先 `sleep` 或轮询 innerText 直到消息文本出现，别拿"刚发送瞬间"的截图当失败。
