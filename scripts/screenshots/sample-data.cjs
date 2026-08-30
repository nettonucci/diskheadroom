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
  ['iosDeviceSupport', null, '~/Library/Developer/Xcode/iOS DeviceSupport', 9.6 * GB, false]
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
  iosDeviceSupport: 'category.iosDeviceSupport.title'
}

const scanResult = {
  scannedAt: new Date().toISOString(),
  limited: false,
  items: [
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
    }))
  ]
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
    locale: 'en'
  },
  scanResult
}
