---
name: verify-safe-file
description: 形式化验证 apps/electron/src/main/lib/safe-file.ts 的崩溃一致性(全仓库 JSON 配置写入的基石)。改动 safe-file.ts、readJsonFileSafe、writeJsonFileAtomic 或对"写入必须原子"的约定有疑问时使用;一条命令重跑。
---

# verify-safe-file:配置写入的崩溃一致性

## 性质(一句话)

无论 `writeJsonFileAtomic` 在哪一步被打断(备份、写临时文件、重命名),磁盘上的目标文件要么是上一次完整写入的内容,要么是这一次的,**永远不会是写了一半的截断内容**;`readJsonFileSafe` 的多层恢复(.tmp 提升、.bak 回退)不得把损坏内容当有效数据返回。

**破坏它的伤害**:用户配置/会话索引(渠道、设置、会话元数据)在崩溃或强关后变成截断 JSON,数据丢失——这正是该文件头注释声称要解决的问题。

## 怎么跑(一条命令,仓库根)

```bash
bun test ./.agents/skills/verify-safe-file/crash-consistency.test.ts
```

~120ms,零依赖(Bun 自带 mock.module)。**只定向运行**:该文件会 mock `node:fs`(afterAll 还原),不要并入全仓库 `bun test`。

## 结果怎么读

- **全绿** = 在枚举的全部崩溃点(见下)上性质成立。内置"对照组"测试用非原子直写实现断言注入手段真的能抓到截断——对照组红 = 注入失效,其余通过一律不算数,先修 harness。
- **枚举/半写测试红** = 被测代码出现截断路径或该崩不崩,是**真 bug**(先确认不是 harness 建模错误:对照测试是否仍绿、失败断言是否关于磁盘内容而非 crashed 标志)。
- **改了 safe-file.ts 之后**:同步 commit(见下)旧了,先重跑本测试确认描述仍成立,再把 SKILL.md 里的同步 commit 前移。

## 验证方法与覆盖

方法:TypeScript 没有可用的代码级 SMT/模型检查 verifier,且本性质是**有限崩溃点上的执行路径性质**(非无限状态并发),故用故障注入穷举:mock `node:fs` 在每个操作边界注入三种中断(before / 写一半 / after),枚举写入路径全部 7 个崩溃点,断言每个崩溃后的磁盘状态 ∈ {旧完整, 新完整}。这不是手写模型——跑的是 `safe-file.ts` 真实代码。

覆盖的代码(`apps/electron/src/main/lib/safe-file.ts`):

| 函数 | 覆盖 |
| --- | --- |
| `writeJsonFileAtomic` | 备份 copy(含 best-effort catch 吞异常的行为)、.tmp 写入(before/half/after)、rename(before/after) |
| `readJsonFileSafe` | 崩溃后读取(.tmp 残留清理、.bak 回退路径被间接覆盖) |

崩溃点来源与语义:同步 throw 模拟进程死亡;`copyFileSync` 阶段的异常会被代码内 try/catch 吞掉(harness 对应点 `mustCrash=false`,这是真实且安全的行为)。

**不覆盖(诚实边界)**:断电时的 fsync 语义(`writeJsonFileAtomic` 的 tmp+rename 前无 `fsyncSync`,断电可能空文件/丢最近写——POSIX rename 只保证崩溃一致性,不保证掉电持久性);symlink/预测路径攻击(见下方 finding 1);多进程并发写同一文件;`writeTextFileAtomic`(随机临时名路径)未纳入。

**同步 commit:`86d9dfb5`**(注意:该 commit 之上工作区有未提交改动;本验证针对 2026-11-05 的实际工作区状态确认通过)。被覆盖代码变更后,由下一个确认者更新此 commit——只有重跑通过才允许前移。

## 验证时发现的问题(截至同步 commit,未修复,报告用户)

1. **`writeJsonFileAtomic` 使用可预测的 `filePath + '.tmp'`**:同文件 `writeTextFileAtomic` 的注释明确谴责此模式(symlink 预置攻击)并已改用随机名 + `wx` 独占创建;`writeJsonFileAtomic` 未同步修复。建议按 `writeTextFileAtomic` 的模式改造(改时重跑本测试)。
2. **rename 前无 `fsyncSync`**(tmp 与目录均未 sync):文件头声称解决"系统强制关机",但掉电场景下 rename 原子性不保证持久性,可能留下空文件(有 .bak 兜底时 `readJsonFileSafe` 可恢复,首次写入无兜底)。若要覆盖强关场景,考虑 `fsyncSync(tmp fd)` + 目录 sync。

## 证明记录

2026-11-05 按本 skill 完整演练:原代码 4 pass;把 `writeJsonFileAtomic` 临时改成非原子直写后,崩溃点枚举与 .tmp 半写两测试变红(对照/先决仍绿,证明红是性质破坏而非 harness 故障);byte-exact 还原后回到 4 pass。
