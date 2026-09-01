// Representative data for README screenshots. Kept fictional on purpose: real
// scans expose local paths and installed apps, which do not belong in a public
// repository.
const GB = 1024 * 1024 * 1024
const MB = 1024 * 1024

const days = (count) => new Date(Date.now() - count * 24 * 60 * 60 * 1000).toISOString()

const items = [
  ['userCaches', 'com.apple.Safari', '~/Library/Caches/com.apple.Safari', 2.4 * GB, true],
  ['userCaches', 'Google/Chrome', '~/Library/Caches/Google/Chrome', 1.7 * GB, true],
  ['userCaches', 'com.spotify.client', '~/Library/Caches/com.spotify.client', 812 * MB, true],
  ['userCaches', 'JetBrains', '~/Library/Caches/JetBrains', 604 * MB, true],
  ['userLogs', 'DiagnosticReports', '~/Library/Logs/DiagnosticReports', 268 * MB, true],
  ['userLogs', 'Homebrew', '~/Library/Logs/Homebrew', 96 * MB, true],
  ['homebrewCache', null, '~/Library/Caches/Homebrew', 3.1 * GB, true],
  ['trash', null, '~/.Trash', 5.8 * GB, true],
  ['xcodeDerivedData', null, '~/Library/Developer/Xcode/DerivedData', 14.2 * GB, false],
  ['iosDeviceSupport', null, '~/Library/Developer/Xcode/iOS DeviceSupport', 9.6 * GB, false],
  ['xcodeArchives', null, '~/Library/Developer/Xcode/Archives', 4.1 * GB, false],
  ['coreSimulatorCaches', null, '~/Library/Developer/CoreSimulator/Caches', 1.8 * GB, false]
]

const apps = [
  ['Vector Studio', 1.9 * GB, 214],
  ['Podcast Recorder', 842 * MB, 168],
  ['Legacy VPN', 126 * MB, 402]
]

const nameKeyFor = {
  homebrewCache: 'category.homebrewCache.title',
  trash: 'category.trash.title',
  xcodeDerivedData: 'category.xcodeDerivedData.title',
  iosDeviceSupport: 'category.iosDeviceSupport.title',
  xcodeArchives: 'category.xcodeArchives.title',
  coreSimulatorCaches: 'category.coreSimulatorCaches.title'
}

// Groups render in the order their first item appears, so the opt-in developer
// leftovers are listed last to keep them together in the developer screenshot.
const developerLeftovers = [
  ['unavailableSimulators', 'iPhone 12', null, '~/Library/Developer/CoreSimulator/Devices/11111111-2222-3333-4444-555555555555', 3.4 * GB],
  ['outdatedSimulators', 'iPhone 16 Pro (iOS 18.1)', null, '~/Library/Developer/CoreSimulator/Devices/22222222-3333-4444-5555-666666666666', 2.6 * GB],
  ['androidDevCaches', null, 'category.androidDevCaches.gradle', '~/.gradle/caches', 6.2 * GB],
  ['androidDevCaches', null, 'category.androidDevCaches.cocoapods', '~/Library/Caches/CocoaPods', 1.1 * GB]
]

const scanItems = [
  ...items.map(([categoryId, name, path, bytes, selectedByDefault], index) => ({
    id: `sample-${index}`,
    categoryId,
    name: name ?? '',
    nameKey: name ? undefined : nameKeyFor[categoryId],
    path,
    bytes: Math.round(bytes),
    selectedByDefault,
    optional: !selectedByDefault,
    lastUsedAt: null,
    daysIdle: null
  })),
  ...apps.map(([name, bytes, idle], index) => ({
    id: `sample-app-${index}`,
    categoryId: 'unusedApps',
    name,
    path: `/Applications/${name}.app`,
    bytes: Math.round(bytes),
    selectedByDefault: false,
    optional: true,
    lastUsedAt: days(idle),
    daysIdle: idle
  })),
  ...developerLeftovers.map(([categoryId, name, nameKey, path, bytes], index) => ({
    id: `sample-dev-${index}`,
    categoryId,
    name: name ?? '',
    nameKey: nameKey ?? undefined,
    path,
    bytes: Math.round(bytes),
    selectedByDefault: false,
    optional: true,
    lastUsedAt: null,
    daysIdle: null
  }))
]

const scanResult = {
  scannedAt: new Date().toISOString(),
  limited: false,
  items: scanItems
}

// The action bar floats above the list, so the overview capture uses a short
// result that fits the window instead of slicing a row in half.
const compactScanResult = {
  ...scanResult,
  items: scanItems.filter((item) => item.categoryId === 'userCaches')
}

module.exports = {
  diskInfo: {
    mount: '/',
    totalBytes: Math.round(494 * GB),
    freeBytes: Math.round(103 * GB),
    usedBytes: Math.round(391 * GB)
  },
  permissionsGranted: {
    fullDiskAccess: true,
    libraryCachesReadable: true,
    applicationsReadable: true
  },
  permissionsMissing: {
    fullDiskAccess: false,
    libraryCachesReadable: true,
    applicationsReadable: true
  },
  grantTarget: {
    displayName: 'Disk Headroom',
    bundlePath: '/Applications/Disk Headroom.app',
    packaged: true,
    launchedBy: null
  },
  settings: {
    unusedDays: 90,
    setupComplete: true,
    locale: 'en',
    lowDiskAlert: {
      enabled: true,
      kind: 'percent',
      value: 10
    },
    scanCategories: {
      userCaches: true,
      userLogs: true,
      homebrewCache: true,
      packageManagers: true,
      trash: true,
      xcode: true,
      androidDev: true,
      docker: true,
      idleUserFolders: true,
      unusedApps: true
    }
  },
  scanResult,
  compactScanResult
}
