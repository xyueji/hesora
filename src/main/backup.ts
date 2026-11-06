// 备份/同步 IPC（薄 Electron 层）：负责真实路径、对话框与自动重启。
import { dialog, app, shell } from 'electron'
import { join } from 'path'
import { rm } from 'fs/promises'
import type { Database } from 'better-sqlite3'
import { createBackupService } from './services/backup/backup.service'
import { createSyncService } from './services/sync/sync.service'

export function createBackupIpc(db: Database) {
  const userData = app.getPath('userData')
  const dbFilePath = join(userData, 'zhjs-erp.db')
  const backupsDir = join(userData, 'backups')
  const backupService = createBackupService(db, dbFilePath)
  const syncService = createSyncService(db, { getDbFilePath: () => dbFilePath, backupsDir })

  async function pickDirectory(title: string): Promise<string | null> {
    const r = await dialog.showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled || r.filePaths.length === 0 ? null : (r.filePaths[0] ?? null)
  }

  return {
    async backupNow(): Promise<string> {
      const dir = await pickDirectory('选择备份保存目录')
      if (!dir) throw new Error('已取消')
      return backupService.backupTo(dir)
    },
    async pickDir(): Promise<string | null> {
      return pickDirectory('选择目录')
    },
    backupList() {
      return backupService.listBackups(backupsDir)
    },
    restoreBackup(backupPath: string): { needRestart: boolean } {
      backupService.restoreFrom(String(backupPath), dbFilePath)
      // restore only swaps files on disk; the open db handle needs a relaunch
      app.relaunch()
      app.exit(0)
      return { needRestart: true }
    },
    syncGetConfig() {
      return syncService.getConfig()
    },
    syncSaveConfig(partial: unknown) {
      syncService.saveConfig(partial as Parameters<typeof syncService.saveConfig>[0])
    },
    async syncNow() {
      return syncService.syncNow()
    },
    async syncDownload() {
      return syncService.downloadFrom()
    },
    async restoreFromCloud(tempPath: string): Promise<{ needRestart: boolean }> {
      backupService.restoreFrom(String(tempPath), dbFilePath)
      await rm(String(tempPath), { force: true }).catch(() => undefined)
      app.relaunch()
      app.exit(0)
      return { needRestart: true }
    },
    // 启动自动备份：保留最新 10 份
    autoBackup(): void {
      try {
        backupService.backupTo(backupsDir)
        const keep = 10
        const list = backupService.listBackups(backupsDir).filter((b) => !b.name.includes('before-restore'))
        for (const old of list.slice(keep)) {
          void rm(join(backupsDir, old.name), { force: true }).catch(() => undefined)
        }
      } catch {
        // 自动备份失败不阻塞启动
      }
    },
    revealBackupsDir(): void {
      void shell.openPath(backupsDir)
    }
  }
}

export type BackupIpc = ReturnType<typeof createBackupIpc>
