// Stands in for src/preload during screenshot capture, so the real UI renders
// against sample data instead of the machine running the script.
const { contextBridge } = require('electron')
const sample = require('./sample-data.cjs')

// main.cjs passes the mode through webPreferences.additionalArguments so each
// window mounts in a known state instead of relying on in-app navigation.
const mode = process.argv.find((arg) => arg.startsWith('--capture-mode='))?.split('=')[1]
const theme = process.argv.find((arg) => arg.startsWith('--capture-theme='))?.split('=')[1]
const capturePro = process.argv.includes('--capture-pro')
const firstRun = mode === 'first-run'
const scanResult = mode === 'overview' ? sample.compactScanResult : sample.scanResult

let settings = {
  ...sample.settings,
  setupComplete: !firstRun,
  preferencesSetupComplete: mode !== 'welcome-preferences',
  resultsTourComplete: mode !== 'results-tour',
  appearance: theme === 'light' ? 'light' : 'dark'
}
const permissions = firstRun ? sample.permissionsMissing : sample.permissionsGranted

const noop = () => () => {}

contextBridge.exposeInMainWorld('diskheadroom', {
  getDiskInfo: async () => sample.diskInfo,
  getPermissions: async () => permissions,
  openFullDiskAccess: async () => {},
  getGrantTarget: async () => sample.grantTarget,
  revealGrantTarget: async () => {},
  getSettings: async () => settings,
  getLicenseStatus: async () => ({ isPro: capturePro }),
  activateLicense: async () => ({ isPro: capturePro }),
  getForecastStatus: async () =>
    capturePro
      ? {
          entitled: true,
          kind: 'ready',
          sampleCount: 8,
          daysUntilThreshold: 12,
          daysCapped: false,
          predictedAt: '2026-09-21T00:00:00.000Z',
          lastScan: { bytes: 8.4 * 1024 * 1024 * 1024, groups: 6 }
        }
      : {
          entitled: false,
          kind: 'gated',
          sampleCount: 0,
          daysUntilThreshold: null,
          daysCapped: false,
          predictedAt: null,
          lastScan: null
        },
  setSettings: async (next) => {
    settings = { ...next }
    return settings
  },
  runScan: async () => scanResult,
  trashItems: async () => ({ trashed: [], failed: [], bytesRequested: 0 }),
  openExternal: async () => {},
  copyText: async () => {},
  revealItem: async () => true,
  onScanProgress: noop,
  onTrayScan: noop,
  onTrayDonate: noop,
  getUpdateStatus: async () => ({
    phase: 'idle',
    currentVersion: '1.20.0',
    availableVersion: null,
    percent: null,
    error: null,
    offline: false
  }),
  checkForUpdates: async () => ({
    phase: 'not-available',
    currentVersion: '1.20.0',
    availableVersion: null,
    percent: null,
    error: null,
    offline: false
  }),
  downloadUpdate: async () => ({
    phase: 'idle',
    currentVersion: '1.20.0',
    availableVersion: null,
    percent: null,
    error: null,
    offline: false
  }),
  installUpdate: async () => {},
  onUpdateChanged: noop
})
