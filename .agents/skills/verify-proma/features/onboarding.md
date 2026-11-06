# 首次启动引导（onboarding）

## Sub-features

- 首次启动的引导流程：多页讲解（Chat/Agent 模式、项目概念、进阶能力），末页按钮"开始使用"完成并进入主界面（`apps/electron/src/renderer/components/onboarding/OnboardingView.tsx`）。
- 完成标记持久化：完成时写 `$VFY_HOME/.proma-dev/settings.json` 的 `onboardingCompleted: true`。
- 设置内重放：设置面板 → "Proma 新手引导" tab 重新进入（`OnboardingSettings`）。

## How to get to it (user POV)

空配置首启（全新 HOME）自动进入引导第一页。用户逐页阅读，首个讲解页正文下方有"继续向下滚动，查看这一步的真实示例"提示按钮，章节间用"开始进阶篇"等按钮翻页，最后一页点"开始使用"进入主界面。

## Driving it with Chrome DevTools Protocol (CDP)

```bash
# 1. 动作前状态：截图 + 确认尚未完成引导
node "$CDP" screenshot $CDP_PORT "$EVIDENCE_DIR/onboarding-01-first-page.png"
node "$CDP" eval $CDP_PORT "document.body.innerText.slice(0, 1500)"
cat "$VFY_HOME/.proma-dev/settings.json"   # 应不存在或 onboardingCompleted=false

# 2. 循环：每次用当前页面文本决定点哪个按钮（文案随版本演进，按文本包含匹配）
node "$CDP" clickText $CDP_PORT "继续向下滚动"   # 首个讲解页的滚动提示（没有就跳过）
node "$CDP" clickText $CDP_PORT "开始进阶篇"
node "$CDP" clickText $CDP_PORT "开始使用"

# 3. 通过标准（三条都要）：
#    a. 页面已离开引导（eval 返回 false）
node "$CDP" eval $CDP_PORT "!!document.body.innerText.match(/输入|会话|新建/)"
#    b. 持久化副作用
cat "$VFY_HOME/.proma-dev/settings.json"   # onboardingCompleted === true，复制到 $EVIDENCE_DIR
#    c. 结束截图
node "$CDP" screenshot $CDP_PORT "$EVIDENCE_DIR/onboarding-02-after.png"
```

## Gotchas

- 按钮文案随版本变化：以步骤 2 的循环探查为准，匹配不到时先 `eval document.body.innerText` 看真实文案再点，不要盲试坐标。
- 引导页内容较长，翻页按钮可能在折叠区下方；`clickText` 已自动 `scrollIntoView`。
- 读取 settings 必须用 `$VFY_HOME/.proma-dev/settings.json`；读到 `~/.proma-dev/` 说明启动时漏设 `HOME`，实例未隔离，立即停止。
- 首次 prep 未完成时窗口可能停在启动页（splash）：表现为截图只有 logo、无引导文本——回到 SKILL.md 的 Doctor 查主进程日志。
