// Explicitly select the Electron binary even when the developer last ran Node tests.
const { createRequire } = require('node:module')
const { dirname } = require('node:path')
const { execFileSync } = require('node:child_process')

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Build the Windows x64 installer on a Windows x64 host.')
}

const sqlitePackage = require.resolve('better-sqlite3/package.json')
const sqliteRequire = createRequire(sqlitePackage)
const electronVersion = require('electron/package.json').version
execFileSync(process.execPath, [
  sqliteRequire.resolve('prebuild-install/bin.js'),
  '--runtime', 'electron', '--target', electronVersion,
  '--arch', 'x64', '--platform', 'win32'
], { cwd: dirname(sqlitePackage), stdio: 'inherit' })

execFileSync(require('electron'), ['-e', 'const db = new (require("better-sqlite3"))(":memory:"); db.close()'], {
  stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
