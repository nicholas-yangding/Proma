# Proma 功能验证地图

本目录是 Proma 桌面应用（`apps/electron`）的用户级功能索引，供 `verify-proma` skill 驱动验证使用。每个文件描述一个功能：是什么、用户怎么到达、怎么用 CDP 驱动、可观察的通过标准与坑。

驱动前提：先按 SKILL.md 的 Launch 启动隔离实例（空 `$VFY_HOME` → 首启进 onboarding）。

## 功能索引

| 文件 | 功能 | 无外部依赖可完整驱动 |
| --- | --- | --- |
| [onboarding.md](./onboarding.md) | 首次启动引导 | ✅（prove 基准路径） |
| [settings-appearance.md](./settings-appearance.md) | 外观设置（主题切换） | ✅ |
| [chat-session.md](./chat-session.md) | Chat 会话（新建/发送） | ⚠️ 发送需真实渠道 |
| [channels.md](./channels.md) | 模型配置（渠道管理） | ⚠️ 连通需真实 API key |
| [workspace.md](./workspace.md) | 项目分区 | ⚠️ 添加需原生目录对话框 |

## 维护规则

- 旅程不许为通过而放水：seed/前置条件缺失时，如实报告失败并把原因写进该功能的 Gotchas。
- UI 文案以运行时 `eval document.body.innerText` 探查为准；文件中记录的文案来自源码，版本迭代后可能漂移，漂移不是失败，更新本文件即可。
- 新增用户可见功能时补一个文件并更新本索引。
