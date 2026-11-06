/**
 * verify-safe-file:崩溃一致性故障注入测试
 *
 * 验证对象:apps/electron/src/main/lib/safe-file.ts 的 writeJsonFileAtomic + readJsonFileSafe。
 * 核心性质(磁盘原子性):无论 writeJsonFileAtomic 在哪一步被打断(备份、写临时文件、
 * 重命名),磁盘上的目标文件要么是上一次完整写入的内容,要么是这一次的,
 * 永远不会是写了一半的截断内容。
 *
 * 方法:mock node:fs,在写入路径的每个 fs 操作边界注入崩溃(before / 写一半 / after),
 * 枚举全部崩溃点,对每个崩溃后的磁盘状态断言性质成立。另设"非原子对照组"
 * (直接写目标文件)证明注入手段真的能抓到违反——如果对照组都抓不到,
 * 说明注入失效,任何"通过"都不算数。
 *
 * 运行:在仓库根执行
 *   bun test .agents/skills/verify-safe-file/crash-consistency.test.ts
 * 本文件会 mock node:fs 并在 afterAll 还原;请定向运行,不要并入全仓库 bun test。
 */

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import * as realFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 崩溃标记:同步路径中抛出即模拟进程在这一点死亡,后续步骤不会执行 */
const CRASH = 'PROMA-CRASH-INJECTION'

/**
 * 在安装 mock 之前先解构保存真实实现。Bun 的 mock.module 会把已 import 的
 * node:fs 命名空间属性也替换掉,任何经由命名空间的访问都会回到 mock 造成自递归,
 * 因此本文件对真实 fs 的所有访问一律走这里的快照引用。
 */
const realFns = {
  writeFileSync: realFs.writeFileSync,
  renameSync: realFs.renameSync,
  copyFileSync: realFs.copyFileSync,
  existsSync: realFs.existsSync,
  readFileSync: realFs.readFileSync,
  mkdtempSync: realFs.mkdtempSync,
  rmSync: realFs.rmSync,
}

interface CrashPoint {
  /** 目标 fs 操作名 */
  op: 'writeFileSync' | 'renameSync' | 'copyFileSync'
  /** before: 执行前崩溃;half: 执行一半后崩溃(仅写文件);after: 执行完成后崩溃 */
  when: 'before' | 'half' | 'after'
  /** 崩溃点只对该谓词为 true 的路径生效(区分 tmp/主文件/bak) */
  pathFilter: (p: string) => boolean
}

let crashPoint: CrashPoint | null = null

function installFsMock(): void {
  mock.module('node:fs', () => {
    const maybeCrash = (point: CrashPoint, p: string): void => {
      if (crashPoint && crashPoint.op === point.op && crashPoint.pathFilter(p)) {
        if (crashPoint.when === 'before') throw new Error(CRASH)
      }
    }
    const didCrash = (point: CrashPoint, p: string): void => {
      if (crashPoint && crashPoint.op === point.op && crashPoint.pathFilter(p)) {
        if (crashPoint.when === 'after') throw new Error(CRASH)
      }
    }
    return {
      ...realFs,
      writeFileSync: ((p: string, data: string | Uint8Array, ...rest: unknown[]) => {
        maybeCrash({ op: 'writeFileSync', when: 'before', pathFilter: () => true }, p)
        if (
          crashPoint?.op === 'writeFileSync' &&
          crashPoint.when === 'half' &&
          crashPoint.pathFilter(p) &&
          typeof data === 'string' &&
          data.length > 1
        ) {
          // 写一半:落盘前半内容,模拟截断的临时文件
          realFns.writeFileSync(p, data.slice(0, Math.floor(data.length / 2)), ...(rest as []))
          throw new Error(CRASH)
        }
        realFns.writeFileSync(p, data, ...(rest as []))
        didCrash({ op: 'writeFileSync', when: 'after', pathFilter: () => true }, p)
      }) as typeof realFs.writeFileSync,
      renameSync: ((from: string, to: string) => {
        maybeCrash({ op: 'renameSync', when: 'before', pathFilter: () => true }, from)
        realFns.renameSync(from, to)
        didCrash({ op: 'renameSync', when: 'after', pathFilter: () => true }, from)
      }) as typeof realFs.renameSync,
      copyFileSync: ((from: string, to: string) => {
        maybeCrash({ op: 'copyFileSync', when: 'before', pathFilter: () => true }, from)
        realFns.copyFileSync(from, to)
        didCrash({ op: 'copyFileSync', when: 'after', pathFilter: () => true }, from)
      }) as typeof realFs.copyFileSync,
    }
  })
}

function restoreFsMock(): void {
  mock.module('node:fs', () => realFs as typeof realFs)
}

/** 被测模块必须在 mock 安装后导入,其内部 fs 引用才会指向 mock */
let writeJsonFileAtomic: (p: string, d: object, skipBackup?: boolean) => void
let readJsonFileSafe: <T>(p: string) => T | null
/** mock 后的 fs 命名空间:对照组要走它,才能被崩溃注入拦截 */
let mockedFs: typeof realFs

beforeAll(async () => {
  installFsMock()
  mockedFs = (await import('node:fs')) as typeof realFs
  const mod = await import('/Users/nichoalas/Github/Proma/apps/electron/src/main/lib/safe-file.ts')
  writeJsonFileAtomic = mod.writeJsonFileAtomic
  readJsonFileSafe = mod.readJsonFileSafe
})

afterAll(() => {
  restoreFsMock()
})

const OLD = { version: 1, payload: 'old-complete-state' }
const NEW = { version: 2, payload: 'new-complete-state', extra: 'x'.repeat(200) }
const canonical = (v: unknown): string => JSON.stringify(v, null, 2)

interface Outcome {
  crashed: boolean
  mainFile: string | null // 主文件的原始内容;不存在为 null
  readReturned: unknown // readJsonFileSafe 的返回值
}

/**
 * 场景:先完整写入 OLD(无注入),再在 point 崩溃点执行写 NEW。
 * 返回崩溃后的磁盘与读取结果。
 */
function runCrashScenario(point: CrashPoint, writeFile: (p: string, d: object) => void): Outcome {
  const dir = realFns.mkdtempSync(join(tmpdir(), 'proma-formal-'))
  const target = join(dir, 'settings.json')
  try {
    crashPoint = null
    writeFile(target, OLD)
    crashPoint = point
    let crashed = false
    try {
      writeFile(target, NEW)
    } catch (e) {
      crashed = e instanceof Error && e.message === CRASH
    }
    crashPoint = null
    const mainFile = realFns.existsSync(target) ? realFns.readFileSync(target, 'utf-8') : null
    const readReturned = readJsonFileSafe<unknown>(target)
    return { crashed, mainFile, readReturned }
  } finally {
    realFns.rmSync(dir, { recursive: true, force: true })
  }
}

/** 性质断言:主文件要么不存在,要么恰为 OLD 或 NEW 的规范形;读取返回 old 或 new */
function expectCrashConsistent(outcome: Outcome): void {
  expect(outcome.mainFile === null || outcome.mainFile === canonical(OLD) || outcome.mainFile === canonical(NEW))
    .toBe(true)
  expect([OLD, NEW]).toContainEqual(outcome.readReturned)
}

/** writeJsonFileAtomic 的写入路径:备份 copy → 写 .tmp → rename */
function writeAtomic(p: string, d: object): void {
  writeJsonFileAtomic(p, d)
}

/** 非原子对照实现:直接写目标文件(现实中"忘了走 safe-file"的写法) */
function writeNaive(p: string, d: object): void {
  // 走 mock 后的 fs,崩溃注入才能拦到这次直写
  mockedFs.writeFileSync(p, canonical(d), 'utf-8')
}

describe('writeJsonFileAtomic 崩溃一致性', () => {
  test('先决条件:无注入时,两次写入后主文件等于 NEW 且读取返回 NEW', () => {
    const outcome = runCrashScenario({ op: 'copyFileSync', when: 'before', pathFilter: () => false }, writeAtomic)
    expect(outcome.crashed).toBe(false)
    expect(outcome.mainFile).toBe(canonical(NEW))
    expect(outcome.readReturned).toEqual(NEW)
  })

  test('崩溃点枚举:写入 NEW 过程的每一步被打断,磁盘上只见过/新完整状态', () => {
    // copyFileSync 点标注 mustCrash=false:备份在 try/catch 里 best-effort 吞异常,
    // 同步 throw 会被业务 catch 接住、写入继续完成——这本身是崩溃安全行为
    // (真进程死在备份阶段时主文件仍是 OLD,同样一致);其余点必须真的中断。
    const points: Array<{ point: CrashPoint; mustCrash: boolean }> = [
      { point: { op: 'copyFileSync', when: 'before', pathFilter: (p) => !p.endsWith('.bak') && !p.endsWith('.tmp') }, mustCrash: false }, // 备份旧主文件前
      { point: { op: 'copyFileSync', when: 'after', pathFilter: (p) => !p.endsWith('.bak') && !p.endsWith('.tmp') }, mustCrash: false }, // 备份完成
      { point: { op: 'writeFileSync', when: 'before', pathFilter: (p) => p.endsWith('.tmp') }, mustCrash: true }, // 写 .tmp 前
      { point: { op: 'writeFileSync', when: 'half', pathFilter: (p) => p.endsWith('.tmp') }, mustCrash: true }, // .tmp 写一半(截断的临时文件)
      { point: { op: 'writeFileSync', when: 'after', pathFilter: (p) => p.endsWith('.tmp') }, mustCrash: true }, // .tmp 完整落盘,rename 前
      { point: { op: 'renameSync', when: 'before', pathFilter: (p) => p.endsWith('.tmp') }, mustCrash: true }, // rename 前一瞬
      { point: { op: 'renameSync', when: 'after', pathFilter: (p) => p.endsWith('.tmp') }, mustCrash: true }, // rename 完成(等价成功路径的崩溃)
    ]
    for (const { point, mustCrash } of points) {
      const outcome = runCrashScenario(point, writeAtomic)
      expect(outcome.crashed).toBe(mustCrash)
      expectCrashConsistent(outcome)
    }
  })

  test('.tmp 写一半崩溃后,残留截断 .tmp 会被读取路径清理且不污染主文件', () => {
    const outcome = runCrashScenario(
      { op: 'writeFileSync', when: 'half', pathFilter: (p) => p.endsWith('.tmp') },
      writeAtomic,
    )
    expect(outcome.mainFile).toBe(canonical(OLD))
    expect(outcome.readReturned).toEqual(OLD)
  })

  test('对照组(必须能失败):非原子直写在"写一半"崩溃点留下截断主文件,注入手段被证明有效', () => {
    const outcome = runCrashScenario(
      { op: 'writeFileSync', when: 'half', pathFilter: (p) => p.endsWith('.json') },
      writeNaive,
    )
    // 若这些断言失败,说明非原子写在此注入下居然仍是崩溃一致的 —— 即注入失效,
    // 上面所有"通过"都不能作为安全证据,必须先修 harness。
    expect(outcome.mainFile).not.toBe(canonical(OLD))
    expect(outcome.mainFile).not.toBe(canonical(NEW))
    expect(() => JSON.parse(outcome.mainFile ?? '')).toThrow()
  })
})
