// Stands in for src/preload during screenshot capture, so the real UI renders
// against sample data instead of the machine running the script.
const { contextBridge } = require('electron')
const sample = require('./sample-data.cjs')

// main.cjs passes the mode through webPreferences.additionalArguments so each
// window mounts in a known state instead of relying on in-app navigation.
const mode = process.argv.find((arg) => arg.startsWith('--capture-mode='))?.split('=')[1]
const firstRun = mode === 'first-run'

let settings = { ...sample.settings, setupComplete: !firstRun }
const permissions = firstRun ? sample.permissionsMissing : sample.permissionsGranted

const noop = () => () => {}

contextBridge.exposeInMainWorld('diskheadroom', {
  getDiskInfo: async () => sample.diskInfo,
  getPermissions: async () => permissions,
  openFullDiskAccess: async () => {},
  getGrantTarget: async () => sample.grantTarget,
  revealGrantTarget: async () => {},
  getSettings: async () => settings,
  setSettings: async (next) => {
    settings = { ...next }
    return settings
  },
  runScan: async () => sample.scanResult,
  trashItems: async () => ({ trashed: [], failed: [], bytesRequested: 0 }),
  openExternal: async () => {},
  copyText: async () => {},
  onScanProgress: noop,
  onTrayScan: noop,
  onTrayDonate: noop
})
