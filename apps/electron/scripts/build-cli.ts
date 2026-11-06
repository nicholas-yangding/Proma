#!/usr/bin/env bun
/** 将经过签名与启动验证的 CLI 编译到桌面应用资源目录。 */
import { resolve } from 'node:path'
import { buildCli, cliBinaryName } from '../../cli/scripts/build'

buildCli(resolve(import.meta.dir, '../resources/bin', cliBinaryName))
