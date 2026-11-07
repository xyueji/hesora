import { dialog, app } from 'electron'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { BizError } from '../shared/result'
import { getCurrentUser } from './auth'
import { runMigrations } from './db/migrate'
import { createBackupService } from './services/backup/backup.service'
import { createSyncService } from './services/sync/sync.service'

export function createBackupIpc(db: Database, migrationsDir: string) {
  const backupsDir = join(app.getPath('userData'), 'backups')
  const backupService = createBackupService(db, db.name, (candidate) => runMigrations(candidate, migrationsDir))
  const syncService = createSyncService(db, { getDbFilePath: () => db.name, backupsDir, backupService })
  let restoring = false
  let checking = false

  async function pickDirectory(title: string): Promise<string | null> {
    const r = await dialog.showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  }

  function restart(): { needRestart: boolean } {
    clearInterval(timer)
    db.close()
    app.relaunch()
    app.exit(0)
    return { needRestart: true }
  }

  async function checkSync(startup = false) {
    if (restoring || checking || !db.open) return
    checking = true
    try {
      if (startup && await syncService.checkRemote()) {
        if (!restoring && db.open) {
          void dialog.showMessageBox({
            type: 'info',
            title: '发现更新的云盘快照',
            message: '云盘有更新的账套快照。',
            detail: '登录后可在「同步与备份」中确认并恢复。'
          })
        }
        return
      }
      if (restoring || !db.open) return
      const { type, intervalHours, last_time } = syncService.getConfig()
      if (type && intervalHours && (!last_time || Date.now() - Date.parse(last_time) >= intervalHours * 3600000)) {
        await syncService.syncNow()
      }
    } catch {
      // Network availability should not interrupt local work.
    } finally {
      checking = false
    }
  }

  const timer = setInterval(() => void checkSync(), 60_000)
  timer.unref()
  setImmediate(() => void checkSync(true))

  return {
    async backupNow(): Promise<string> {
      const dir = await pickDirectory('选择备份保存目录')
      if (!dir) throw new BizError('VALIDATION', '已取消')
      return backupService.backupTo(dir)
    },
    pickDir: () => pickDirectory('选择目录'),
    backupList: () => backupService.listBackups(backupsDir),
    async restoreBackup(name: string): Promise<{ needRestart: boolean }> {
      if (restoring || syncService.isUploading()) throw new BizError('SYNC_FAIL', '请等待当前操作结束')
      restoring = true
      try {
        let path: string
        if (name) {
          if (!backupService.listBackups(backupsDir).some((entry) => entry.name === name)) {
            throw new BizError('NOT_FOUND', '备份文件不存在')
          }
          path = join(backupsDir, name)
        } else {
          const selection = await dialog.showOpenDialog({
            title: '选择要恢复的数据库备份',
            properties: ['openFile'],
            filters: [{ name: '数据库备份', extensions: ['db'] }]
          })
          if (selection.canceled || !selection.filePaths[0]) return { needRestart: false }
          path = selection.filePaths[0]
          const { response } = await dialog.showMessageBox({
            type: 'warning',
            message: '恢复将覆盖当前账套并重启软件。',
            buttons: ['取消', '恢复'],
            defaultId: 0,
            cancelId: 0
          })
          if (response !== 1) return { needRestart: false }
        }
        backupService.restoreFrom(path, db.name, backupsDir, getCurrentUser()?.username)
        return restart()
      } finally {
        restoring = false
      }
    },
    syncGetConfig: () => syncService.getConfig(),
    syncCheckTargets: () => syncService.checkTargets(),
    syncSaveConfig(partial: unknown) {
      syncService.saveConfig(partial as Parameters<typeof syncService.saveConfig>[0])

    },
    async syncNow() {
      if (restoring) throw new BizError('SYNC_FAIL', '恢复进行中')
      return syncService.syncNow()
    },
    async syncDownload(source?: 'local' | 'webdav') {
      if (restoring) throw new BizError('SYNC_FAIL', '恢复进行中')
      return syncService.prepareRestore(source)
    },
    cancelSyncRestore: (token: string) => syncService.discardPreview(token),
    async restoreFromCloud(token: string, acceptLocalChanges: boolean): Promise<{ needRestart: boolean }> {
      if (restoring) throw new BizError('SYNC_FAIL', '恢复进行中')
      restoring = true
      try {
        await syncService.restorePreview(token, acceptLocalChanges, getCurrentUser()?.username)
        return restart()
      } finally {
        restoring = false
      }
    },
    autoBackup(): void {
      try {
        backupService.dailyBackup(backupsDir)
      } catch {
        // An unavailable backup directory does not prevent opening the app.
      }
    }
  }
}

export type BackupIpc = ReturnType<typeof createBackupIpc>
