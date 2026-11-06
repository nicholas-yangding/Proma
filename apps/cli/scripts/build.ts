#!/usr/bin/env bun
/** 编译独立 CLI；桌面应用复用此入口，统一平台兼容与可执行验证。 */
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const cliDir = resolve(import.meta.dir, '..')
export const cliBinaryName = process.platform === 'win32' ? 'proma.exe' : 'proma'

export function buildCli(outFile = join(cliDir, 'dist', cliBinaryName)): void {
  const entry = join(cliDir, 'src/index.ts')
  const compileArgs = ['build', '--compile', '--outfile', outFile, entry]
  let tempBunPath: string | undefined
  mkdirSync(dirname(outFile), { recursive: true })

  // Windows 长路径下编译可能无法复制 Bun，改用临时目录中的短路径副本。
  if (process.platform === 'win32') {
    const candidate = join(tmpdir(), `bun-compile-${process.pid}-${Date.now()}.exe`)
    try {
      copyFileSync(process.execPath, candidate)
      tempBunPath = candidate
      compileArgs.splice(2, 0, '--compile-executable-path', candidate)
    } catch (error) {
      console.warn('[build:cli] 无法准备 Bun 短路径副本，尝试直接编译:', error)
    }
  }

  try {
    const result = spawnSync(process.execPath, compileArgs, { cwd: cliDir, stdio: 'inherit' })
    if (result.status !== 0 || !existsSync(outFile)) {
      throw new Error(`CLI 编译失败（exit ${result.status}，signal ${result.signal}）`)
    }

    // Bun 追加可执行内容后，旧版本生成的 Mach-O 签名可能失效；本地临时签名
    // 保证开发产物可运行，正式打包仍由 electron-builder 使用发布证书重签。
    if (process.platform === 'darwin') {
      execFileSync('codesign', ['--force', '--sign', '-', outFile], { stdio: 'inherit' })
      execFileSync('codesign', ['--verify', '--strict', outFile], { stdio: 'inherit' })
    }

    const smoke = spawnSync(outFile, ['--help'], { encoding: 'utf8', timeout: 15_000 })
    if (smoke.error || smoke.status !== 0 || !`${smoke.stdout}${smoke.stderr}`.includes('proma session')) {
      throw new Error(`CLI 启动验证失败（exit ${smoke.status}，signal ${smoke.signal}）`, { cause: smoke.error })
    }
    console.log(`[build:cli] 已编译并验证 ${outFile}（${(statSync(outFile).size / 1024 / 1024).toFixed(0)} MB）`)
  } finally {
    if (tempBunPath) {
      try { unlinkSync(tempBunPath) } catch (error) {
        console.warn('[build:cli] 无法清理 Bun 临时副本:', error)
      }
    }
  }
}

if (import.meta.main) buildCli()
