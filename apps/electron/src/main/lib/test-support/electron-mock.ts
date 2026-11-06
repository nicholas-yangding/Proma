import { join } from 'node:path'

/** 统一 Electron mock 导出，避免多个测试文件覆盖模块时丢失已导入的成员。 */
export function createElectronMock(getHome: () => string) {
  return {
    app: {
      isPackaged: true,
      getPath: () => join(getHome(), 'Library', 'Application Support'),
    },
    BrowserWindow: class {},
    clipboard: {},
    dialog: {},
    nativeImage: { createFromPath: () => ({}) },
    nativeTheme: {},
    powerMonitor: {},
    powerSaveBlocker: {},
    screen: {},
    shell: { openExternal: async () => undefined },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString('utf-8'),
    },
  }
}
