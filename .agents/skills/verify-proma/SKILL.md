---
name: verify-proma
description: 驱动 Proma Electron 桌面应用（本仓库 apps/electron）做端到端验证。当需要像真实用户一样启动应用、操作 UI、截图留证、验证本地持久化副作用时使用。通过独立 HOME + PROMA_DEV_INSTANCE 隔离实例，Chrome DevTools Protocol (CDP) 驱动渲染进程。
---

# verify-proma

驱动本仓库的 Proma Electron 桌面应用，用真实用户路径证明行为。所有命令假定：

- **仓库根** = 本 skill 目录的 `../../..`（即含 `apps/electron` 的目录），下文记 `$REPO`。
- 本 harness 的 Node/Bun 均有全局 `fetch` 与 `WebSocket`，CDP 客户端零依赖（`helpers/cdp.mjs`）。

变量约定（每次验证生成一次，后续命令复用）：

```bash
VFY_ID="vfy-$(date +%Y%m%d%H%M%S)"          # 实例标识，只含 [a-zA-Z0-9_-]
CDP_PORT=9223                                # 若被占用换成 9224/9225…
VFY_HOME="/tmp/proma-verify-$VFY_ID/home"    # 验证实例的 HOME（隔离 ~/.proma-dev）
EVIDENCE_DIR="$HOME/.proma-verify/evidence/$VFY_ID"  # 证据目录，真实 HOME 下，cleanup 后保留
LOG_DIR="/tmp/proma-verify-$VFY_ID/logs"     # 进程日志（随 scratch 清理）
mkdir -p "$VFY_HOME" "$EVIDENCE_DIR" "$LOG_DIR"
```

## Launch

**不要用 `bun run dev` 启动验证实例**：它的第一步 `dev:kill.ts --vite` 会 `pkill` 本 worktree 的所有 electronmon/electron 进程并杀掉 5173 端口的 vite，会误杀用户正在运行的 dev 实例。验证用逐条 prep + 直接拉起 Electron，不触发任何 kill。

首次 prep（幂等，已构建过则很快；rebuild:node-pty 首次较慢）：

```bash
cd "$REPO/apps/electron"
bun run sync:runtime-deps:dev && bun run rebuild:node-pty && bun run build:native-helpers \
  && bun run prepare:officecli && bun run build:resources \
  && bun run build:main && bun run build:agent-runtime && bun run build:terminal-runtime && bun run build:preload
```

起 Vite（renderer 开发服务器，Electron 主进程硬编码加载 `http://127.0.0.1:5173`，strictPort）：

```bash
cd "$REPO/apps/electron" && bun run dev:vite > "$LOG_DIR/vite.log" 2>&1 &
VITE_PID=$!   # 记住，cleanup 用
# ready = 日志出现 "Local:   http://127.0.0.1:5173/"
```

**复用模式**：若 5173 已被**本 worktree 自己的 vite 进程**占用（`ps -p $(lsof -ti:5173) -o command=` 显示本仓库路径下的 `vite dev` 或 `vite preview`），直接复用它、不再起 vite（此时 `VITE_PID` 留空，cleanup 跳过 vite）。Electron 只从 5173 拉取 renderer，dev 与 preview server 都满足。复用 dev server 时注意用户可能正在改代码（HMR 会影响验证中的页面）；复用 preview 时确认 `dist/renderer` 与 `dist/main.cjs`、`dist/preload.cjs` 构建时间一致。被**其他**进程占用则中止报告。

起 Electron（`electron .` 未打包 = 开发模式：配置目录走 `~/.proma-dev`，渲染进程走 5173）。驱动通道用 Node inspector（`--inspect`，helper 依赖它；Chromium 内建 `--remote-debugging-port` 在本应用主进程下实测不响应，勿用）：

```bash
cd "$REPO/apps/electron"
HOME="$VFY_HOME" PROMA_DEV_INSTANCE="$VFY_ID" bunx electron . --inspect=$CDP_PORT \
  > "$LOG_DIR/electron.log" 2>&1 &
ELECTRON_PID=$!   # 记住，cleanup 用
```

**Ready 判定（usable，不是"进程活着"）**，三条全过才算就绪：

1. `curl -s "http://127.0.0.1:$CDP_PORT/json/list"` 返回含 `"type": "node"` 的 JSON；
2. `node "$REPO/.agents/skills/verify-proma/helpers/cdp.mjs" targets $CDP_PORT` 列出主窗口（URL 含 `127.0.0.1:5173`）；
3. 截图非空白：`node "$REPO/.agents/skills/verify-proma/helpers/cdp.mjs" screenshot $CDP_PORT "$EVIDENCE_DIR/01-launch.png"` 后查看文件大小 > 20KB。

**每次验证必须用新的 $VFY_ID**：复用旧 ID 会撞上一个实例的 userData 单实例锁，新实例静默早退（日志短、无 `[IPC]` 注册行、窗口列表空），这是启动排障的第一嫌疑。

**已知阻塞（2026-11-05 记录）**：当前工作区（含未提交改动）下，主进程完整启动后陷入 JS 无限递归死锁，`--inspect` 与 `--remote-debugging-port` 的请求-响应全部无响应（连接可建立）。对照：同版本最小 Electron app 两通道均正常，根因在应用主进程；sample 证据存 `~/.proma-verify/evidence/vfy-20261105223345/main-thread-sample.txt`。**死锁修复前，本 skill 的 prove 不可完成**；修复后按本文件完整重跑 prove（launch → doctor → 驱动 onboarding → cleanup）。

空的 `$VFY_HOME` → `$VFY_HOME/.proma-dev/settings.json` 不存在 → 首启落在 OnboardingView（引导流程，见 features/onboarding.md）。这就是从空数据目录到达的可用状态，无需 seed 数据。应用配置、会话全部落在 `$VFY_HOME/.proma-dev/`（开发模式目录，不会碰用户正式版 `~/.proma/`）；Electron userData 落在 `$VFY_HOME/Library/Application Support/@proma/electron-dev-$VFY_ID`（由 `PROMA_DEV_INSTANCE` 派生，见 `apps/electron/src/main/index.ts` 与 `src/main/lib/config-paths.ts`）。

## Doctor

只读自检，任何一步异常先跑这个：

```bash
curl -s "http://127.0.0.1:$CDP_PORT/json/list" | head -5                     # inspector 活着？
node "$REPO/.agents/skills/verify-proma/helpers/cdp.mjs" targets $CDP_PORT   # 主窗口在？
lsof -nP -iTCP:5173 -sTCP:LISTEN                                # 5173 被谁占用？
ps -p $ELECTRON_PID -o pid,command                              # Electron 还在？
tail -40 "$LOG_DIR/electron.log"                                # 主进程日志
tail -40 "$LOG_DIR/vite.log"
```

若 inspector 的 HTTP discovery 通、但任何 CDP 命令（含 `targets`）长时间无响应：**主进程大概率死锁**（进程空闲、托盘在，都是假象）。确认方法：`sample $ELECTRON_PID 3 -file /tmp/s.txt`，看主线程栈是否有同一 JS 帧无限重复（历史样例见上文已知阻塞）。死锁实例直接 kill 重来没有意义——先修复或报告，再验证。

判读：

- 5173 被监听：`ps -p $(lsof -ti:5173) -o command=` 看占用者。是**本 worktree 的 vite**（dev 或 preview）→ 按 Launch 的复用模式接入；是其他进程 → **中止并报告**，不要杀它。
- CDP 无响应但 Electron 进程在 → 看 electron.log 是否停在 `bundle readiness`（prep 未完成，重跑 prep 链）或单实例锁退出（`已有 Proma 进程持有单实例锁` → $VFY_ID 撞了同名实例，换 ID 重来）。
- settings 不符合预期 → 确认读的是 `$VFY_HOME/.proma-dev/settings.json`，不是 `~/.proma-dev/`（忘了设 HOME）。

## Drive

CDP 驱动渲染进程（Node ≥21 / Bun 全局 WebSocket，零依赖）：

```bash
CDP="$REPO/.agents/skills/verify-proma/helpers/cdp.mjs"

node "$CDP" eval $CDP_PORT "document.body.innerText.slice(0, 2000)"   # 探查当前页面文本
node "$CDP" clickText $CDP_PORT "开始使用"                              # 按可见文案点按钮
node "$CDP" click $CDP_PORT "[data-testid='x']"                       # 按 selector 点
node "$CDP" type $CDP_PORT "textarea" "你好"                           # 向输入框打字
node "$CDP" screenshot $CDP_PORT "$EVIDENCE_DIR/02-step.png"          # 截图
```

选择器策略：优先 aria-label / data-testid；本应用 UI 多为中文文案，`clickText` 按 button/[role=button] 的可见文本匹配，最稳。拿不准就先 `eval document.body.innerText` 探查真实文案，**不要用坐标**。原生对话框（目录选择、文件保存）不在 Chromium 渲染树里，CDP 驱动不了——涉及的功能见对应 feature 文件的 Gotchas。

## Evidence

一份合格的证明 = 动作前状态 + 动作 + 动作后可见状态 + 持久化副作用，全部落在 `$EVIDENCE_DIR`：

- 截图 PNG（helper screenshot），关键步骤前后各一张；
- `eval` 抓取的 DOM 状态 / 应用状态（JSON 存文件）；
- 持久化副作用：`cp "$VFY_HOME/.proma-dev/settings.json" "$EVIDENCE_DIR/settings-after.json"`，会话/渠道等同理（都在 `$VFY_HOME/.proma-dev/` 下）；
- 主进程日志相关段落：`grep -A5 '关键字' "$LOG_DIR/electron.log" > "$EVIDENCE_DIR/main-log-excerpt.txt"`。

证明标准：走真实用户路径（UI 点击），不用内部 setter、不调测试专用 IPC；截图之外必须核对落盘文件；mock 只允许出现在生产边界已隔离的外部系统（如真实 API 渠道）。

## Cleanup

只杀自己启动的进程，按 PID，绝不 `pkill electron` / `killall`：

```bash
kill $ELECTRON_PID 2>/dev/null; sleep 2   # Electron 主进程退出会带走渲染/工具子进程
kill $VITE_PID 2>/dev/null
sleep 1; rm -rf "/tmp/proma-verify-$VFY_ID"   # 删 scratch（VFY_HOME + 日志）
ls "$EVIDENCE_DIR"                            # 证据必须在，cleanup 不许碰它
```

Electron 未随 `kill`（TERM）退出再补 `kill -9 $ELECTRON_PID`。残留检查：`lsof -nP -iTCP:$CDP_PORT -iTCP:5173 -sTCP:LISTEN` 应为空（或仅剩用户自己的进程）。

## Helpers

`helpers/cdp.mjs`（与本 SKILL.md 同目录）——零依赖 CDP 客户端，子命令 `targets | eval | click | clickText | type | screenshot`，调用方式见上文 Drive 一节。它自动挑选 URL 含 `127.0.0.1:5173` 的 page target；连接失败时报错退出码非 0。所有子命令同步返回，适合脚本编排。
