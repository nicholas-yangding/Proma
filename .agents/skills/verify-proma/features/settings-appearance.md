# 外观设置（主题切换）

## Sub-features

- 主题模式切换：浅色 / 深色 / 跟随系统 + 特殊风格（`apps/electron/src/renderer/components/settings/AppearanceSettings.tsx`，选项文案"浅色""深色"）。
- 持久化：写入 `$VFY_HOME/.proma-dev/settings.json` 的 `themeMode`。
- 设置面板内其余 tab（通用设置、模型配置、快捷键等）共用同一入口。

## How to get to it (user POV)

主界面左下角齿轮按钮打开设置，左侧导航选"外观设置"，在主题模式里点"深色"（或"浅色"），界面立即变色，设置自动保存。

## Driving it with Chrome DevTools Protocol (CDP)

```bash
# 前置：已完成 onboarding（见 onboarding.md）或点"开始使用"跳过剩余页
node "$CDP" click '[aria-label="打开设置"]'
node "$CDP" clickText "外观设置"
node "$CDP" screenshot $CDP_PORT "$EVIDENCE_DIR/appearance-01-before.png"

node "$CDP" clickText "深色"
sleep 1   # 等主题类名落 DOM

# 通过标准：可见状态 + 持久化副作用
node "$CDP" eval $CDP_PORT "document.documentElement.className + ' | ' + getComputedStyle(document.body).color"
node "$CDP" screenshot $CDP_PORT "$EVIDENCE_DIR/appearance-02-dark.png"
grep themeMode "$VFY_HOME/.proma-dev/settings.json"   # 应为 "dark"，复制到 $EVIDENCE_DIR
```

## Gotchas

- 设置入口 selector 是 `[aria-label="打开设置"]`（`LeftSidebar.tsx`），比文本"设置"稳，优先用它。
- 左侧导航 tab 文案来自 `SettingsPanel.tsx`："通用设置""模型配置""外观设置"等；匹配不到先 `eval document.body.innerText` 探查。
- 主题切换是即时生效的原子写（safe-file），没有"保存"按钮——不要找保存按钮。
- 特殊风格含轻微闪烁动画的预览图（tooltip 有提示），截图对比时别选特殊风格，选"深色"最稳定。
