# 项目分区（工作区）

## Sub-features

- 项目/工作区选择：主界面为会话选择工作目录（项目分区），Agent 在所选项目内工作。
- 添加项目：点击添加入口弹出 macOS 原生目录选择对话框。
- worktree 工作流：开发者场景下基于 worktree 的分区（README 所述自动 worktree）。

## How to get to it (user POV)

主界面会话上方的项目选择器，点击可切换已有项目；"添加项目"打开系统目录选择框，选中一个文件夹后授权，项目进入列表。

## Driving it with Chrome DevTools Protocol (CDP)

```bash
# 已有项目时的切换路径（可完整驱动）：
node "$CDP" eval $CDP_PORT "document.body.innerText.slice(0, 2000)"   # 探查项目选择器文案
node "$CDP" clickText "<已有项目名>"    # 切换后截图 + 查会话上下文日志

# 添加路径（只能验证到对话框弹出）：
node "$CDP" clickText "添加"
sleep 1
node "$CDP" eval $CDP_PORT "!!document.body.innerText.match(/选择|文件夹|目录/)"   # 应用侧 UI 反馈
grep -i "dialog\|选择" "$LOG_DIR/electron.log" | tail -5   # 主进程 dialog 证据
node "$CDP" screenshot $CDP_PORT "$EVIDENCE_DIR/workspace-01-dialog.png"
```

## Gotchas

- **添加项目的目录选择是 macOS 原生对话框，不在 Chromium 渲染树内，CDP 驱动不了**。旅程止步于"点击添加 → 对话框出现"（用主进程日志与应用侧 UI 状态证明），完整选择流程需人工完成；不要为可测性改产品代码。
- 空实例没有已授权项目，切换路径需要先人工添加一次项目作为 seed；缺该 seed 时如实报告前置条件缺失。
- 项目授权边界（AGENTS.md 注入、附加目录）是 Proma 的安全语义：验证时只引用 `$REPO` 自身或 `/tmp` 下的测试目录，不要驱动对用户其他目录的授权。
