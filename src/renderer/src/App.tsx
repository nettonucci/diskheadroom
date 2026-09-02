import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  UNUSED_DAY_OPTIONS,
  SCAN_CATEGORY_IDS,
  SPONSORS_URL,
  REPO_URL,
  LOW_DISK_ALERT_PRESETS,
  SCAN_REMINDER_INTERVAL_DAYS,
  lowDiskAlertPresetKey,
  parseLowDiskAlertPreset,
  type LowDiskAlertSettings,
  type ScanCategoryFlag,
  type ScanReminderSettings,
  type UnusedDays
} from '../../shared/constants'
import {
  LOCALES,
  LOCALE_NAMES,
  translator,
  type Locale,
  type TranslationKey,
  type Translator
} from '../../shared/i18n'
import type {
  AppSettings,
  CleanResult,
  DiskInfo,
  GrantTarget,
  LowDiskDebugStatus,
  PermissionStatus,
  ScanItem,
  ScanProgress,
  ScanResult
} from '../../shared/types'
import { CATEGORY_META, CATEGORY_WARNING, NAV, SCAN_CATEGORY_LABELS, type ViewId } from './lib/copy'
import { formatBytes, formatDate } from './lib/format'
import markUrl from '@brand/mark-color.svg'

function Spinner(): JSX.Element {
  return <span className="spinner" aria-hidden="true" />
}

function confirmCopyKey(items: ScanItem[]): TranslationKey {
  const includesDocker = items.some((item) => item.categoryId === 'dockerDesktop')
  if (items.length === 1) {
    return includesDocker ? 'results.confirmDockerOne' : 'results.confirmOne'
  }
  return includesDocker ? 'results.confirmDockerOther' : 'results.confirmOther'
}

function ConfirmDialog(props: {
  title: string
  message: string
  warning: boolean
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') props.onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onCancel])

  return (
    <div className="dialog-backdrop" onClick={props.onCancel} role="presentation">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clean-confirm-title"
        aria-describedby="clean-confirm-message"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="clean-confirm-title">{props.title}</h3>
        <p id="clean-confirm-message" className={props.warning ? 'notice' : 'muted'}>
          {props.message}
        </p>
        <div className="row">
          <button className="btn" type="button" autoFocus onClick={props.onCancel}>
            {props.cancelLabel}
          </button>
          <button className="btn danger" type="button" onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// Keeps a button visibly working until its IPC round trip settles.
function useBusyAction(action: () => Promise<void>): [boolean, () => void] {
  const [busy, setBusy] = useState(false)
  const run = useCallback(() => {
    setBusy(true)
    // Local IPC can settle in a couple of milliseconds. Without a floor the
    // spinner only flashes and the click still reads as ignored.
    const floor = new Promise((resolve) => window.setTimeout(resolve, 350))
    void Promise.all([action(), floor]).finally(() => setBusy(false))
  }, [action])
  return [busy, run]
}

export function App(): JSX.Element {
  if (typeof window.diskheadroom === 'undefined') {
    const t = translator('en')
    return (
      <main className="main">
        <h2>{t('bridge.title')}</h2>
        <p className="muted">{t('bridge.message')}</p>
      </main>
    )
  }

  return <AppShell />
}

function AppShell(): JSX.Element {
  const [view, setView] = useState<ViewId>('permissions')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [disk, setDisk] = useState<DiskInfo | null>(null)
  const [perms, setPerms] = useState<PermissionStatus | null>(null)
  const [grantTarget, setGrantTarget] = useState<GrantTarget | null>(null)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [cleanMessage, setCleanMessage] = useState<string | null>(null)
  const [cleanFailed, setCleanFailed] = useState<{ path: string; error: string }[]>([])
  const [lastCleanResult, setLastCleanResult] = useState<CleanResult | null>(null)
  const [scanFailed, setScanFailed] = useState(false)
  const [busyClean, setBusyClean] = useState(false)
  const [confirmCleanOpen, setConfirmCleanOpen] = useState(false)
  const bootstrapped = useRef(false)
  const locale = settings?.locale ?? 'en'
  const t = translator(locale)

  const refresh = useCallback(async () => {
    const [nextSettings, nextDisk, nextPerms, nextTarget] = await Promise.all([
      window.diskheadroom.getSettings(),
      // A failed capacity reading must not take the rest of the UI down with it:
      // the panel can be missing, the app still scans and cleans.
      window.diskheadroom.getDiskInfo().catch(() => null),
      window.diskheadroom.getPermissions(),
      window.diskheadroom.getGrantTarget()
    ])
    setSettings(nextSettings)
    setDisk(nextDisk)
    setPerms(nextPerms)
    setGrantTarget(nextTarget)
    // Only the first load decides the landing view. Later refreshes come from
    // Recheck or a finished cleanup, and pulling the user out of the screen they
    // opened makes those buttons feel broken.
    if (nextSettings.setupComplete && !bootstrapped.current) {
      setView((current) => (current === 'permissions' ? 'dashboard' : current))
    }
    bootstrapped.current = true
  }, [])

  const refreshDisk = useCallback(async () => {
    const next = await window.diskheadroom.getDiskInfo().catch(() => null)
    // Keep the previous reading on a transient failure rather than blanking the panel.
    if (next) setDisk(next)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Space is freed outside this window — emptying the Trash in Finder, another
  // app writing files — and macOS sends no event for it, so the panel would keep
  // showing a stale number until the next relaunch.
  useEffect(() => {
    function sync(): void {
      if (document.hidden) return
      void refreshDisk()
    }
    const timer = window.setInterval(sync, 5000)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [refreshDisk])

  const startScan = useCallback(async () => {
    if (!settings || scanning) return
    setScanning(true)
    setCleanMessage(null)
    setCleanFailed([])
    setScanFailed(false)
    setProgress({ phase: 'progress.starting', percent: 2 })
    // Rescans triggered from the results list would otherwise run with no visible
    // sign of work; the dashboard is where the progress bar lives.
    setView('dashboard')
    try {
      const next = await window.diskheadroom.runScan(settings.unusedDays, settings.scanCategories)
      setResult(next)
      const initial: Record<string, boolean> = {}
      for (const item of next.items) {
        initial[item.id] = item.selectedByDefault
      }
      setSelected(initial)
      setView('results')
    } catch {
      setScanFailed(true)
    } finally {
      setScanning(false)
    }
  }, [settings, scanning])

  useEffect(() => {
    const stopProgress = window.diskheadroom.onScanProgress(setProgress)
    const stopScan = window.diskheadroom.onTrayScan(() => {
      setView('dashboard')
      void startScan()
    })
    const stopDonate = window.diskheadroom.onTrayDonate(() => setView('donate'))
    return () => {
      stopProgress()
      stopScan()
      stopDonate()
    }
  }, [startScan])

  const selectedItems = useMemo(() => {
    return (result?.items ?? []).filter((item) => selected[item.id])
  }, [result, selected])

  const selectedBytes = selectedItems.reduce((sum, item) => sum + item.bytes, 0)
  const foundBytes = (result?.items ?? []).reduce((sum, item) => sum + item.bytes, 0)

  async function updateSettings(
    patch: (current: AppSettings) => Partial<AppSettings>
  ): Promise<void> {
    if (!settings) return
    const next = await window.diskheadroom.setSettings({ ...settings, ...patch(settings) })
    setSettings(next)
  }

  async function markSetupDone(): Promise<void> {
    if (!settings) return
    await updateSettings(() => ({ setupComplete: true }))
    setView('dashboard')
  }

  async function updateUnusedDays(unusedDays: UnusedDays): Promise<void> {
    await updateSettings(() => ({ unusedDays }))
  }

  async function updateLocale(nextLocale: Locale): Promise<void> {
    await updateSettings(() => ({ locale: nextLocale }))
  }

  async function updateScanCategory(id: ScanCategoryFlag, enabled: boolean): Promise<void> {
    await updateSettings((current) => ({
      scanCategories: { ...current.scanCategories, [id]: enabled }
    }))
  }

  async function updateLowDiskAlert(patch: Partial<LowDiskAlertSettings>): Promise<void> {
    await updateSettings((current) => ({ lowDiskAlert: { ...current.lowDiskAlert, ...patch } }))
  }

  async function updateLaunchAtLogin(enabled: boolean): Promise<void> {
    await updateSettings(() => ({ launchAtLogin: enabled }))
  }

  async function updateScanReminder(patch: Partial<ScanReminderSettings>): Promise<void> {
    await updateSettings((current) => ({ scanReminder: { ...current.scanReminder, ...patch } }))
  }

  async function updatePro(isPro: boolean): Promise<void> {
    await updateSettings(() => ({ isPro }))
  }

  const cancelCleanConfirm = useCallback(() => setConfirmCleanOpen(false), [])

  function requestClean(): void {
    if (selectedItems.length === 0) return
    setConfirmCleanOpen(true)
  }

  async function cleanSelected(): Promise<void> {
    if (selectedItems.length === 0) return
    setConfirmCleanOpen(false)
    setBusyClean(true)
    try {
      const outcome = await window.diskheadroom.trashItems({
        paths: selectedItems.map((item) => item.path)
      })
      const recovered = selectedItems
        .filter((item) => outcome.trashed.includes(item.path))
        .reduce((sum, item) => sum + item.bytes, 0)
      setCleanFailed(outcome.failed)
      setLastCleanResult(outcome)
      setCleanMessage(
        t(outcome.trashed.length === 1 ? 'results.cleanedOne' : 'results.cleanedOther', {
          count: outcome.trashed.length,
          size: formatBytes(recovered)
        }) +
          (outcome.failed.length
            ? t(outcome.failed.length === 1 ? 'results.failedOne' : 'results.failedOther', {
                count: outcome.failed.length
              })
            : '')
      )
      setResult((current) =>
        current
          ? {
              ...current,
              items: current.items.filter((item) => !outcome.trashed.includes(item.path))
            }
          : current
      )
      await refresh()
    } finally {
      setBusyClean(false)
    }
  }

  const usedPct = disk ? Math.min(100, Math.round((disk.usedBytes / disk.totalBytes) * 100)) : 0

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src={markUrl} alt="" width={30} height={30} />
          <div>
            <h1>Disk Headroom</h1>
            <p>{t('app.tagline')}</p>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={view === item.id || (item.id === 'dashboard' && view === 'results') ? 'active' : ''}
              onClick={() => setView(item.id)}
              type="button"
            >
              {t(item.label)}
            </button>
          ))}
          {import.meta.env.DEV && (
            <button
              className={view === 'debug' ? 'active' : ''}
              onClick={() => setView('debug')}
              type="button"
            >
              Debug
            </button>
          )}
        </nav>
      </aside>
      <main className="main">
        {view === 'permissions' && (
          <PermissionsView
            t={t}
            perms={perms}
            grantTarget={grantTarget}
            onOpenSettings={() => window.diskheadroom.openFullDiskAccess()}
            onReveal={() => void window.diskheadroom.revealGrantTarget()}
            onRecheck={refresh}
            onContinue={() => void markSetupDone()}
          />
        )}
        {view === 'dashboard' && (
          <DashboardView
            t={t}
            disk={disk}
            usedPct={usedPct}
            scanning={scanning}
            progress={progress}
            unusedDays={settings?.unusedDays ?? 90}
            limited={Boolean(perms && !perms.fullDiskAccess)}
            scanFailed={scanFailed}
            onScan={() => void startScan()}
          />
        )}
        {view === 'results' && result && (
          <ResultsView
            t={t}
            locale={locale}
            result={result}
            disk={disk}
            isPro={Boolean(settings?.isPro)}
            lastCleanResult={lastCleanResult}
            usedPct={usedPct}
            foundBytes={foundBytes}
            selected={selected}
            selectedBytes={selectedBytes}
            selectedCount={selectedItems.length}
            busyClean={busyClean}
            cleanMessage={cleanMessage}
            cleanFailed={cleanFailed}
            onToggle={(item, value) => setSelected((current) => ({ ...current, [item.id]: value }))}
            onToggleCategory={(ids, value) => {
              setSelected((current) => {
                const next = { ...current }
                for (const id of ids) next[id] = value
                return next
              })
            }}
            onClean={requestClean}
            onRescan={() => void startScan()}
          />
        )}
        {view === 'results' && !result && (
          <DashboardView
            t={t}
            disk={disk}
            usedPct={usedPct}
            scanning={scanning}
            progress={progress}
            unusedDays={settings?.unusedDays ?? 90}
            limited={Boolean(perms && !perms.fullDiskAccess)}
            scanFailed={scanFailed}
            onScan={() => void startScan()}
          />
        )}
        {view === 'settings' && settings && (
          <SettingsView
            t={t}
            settings={settings}
            onUnusedDays={(value) => void updateUnusedDays(value)}
            onLocale={(value) => void updateLocale(value)}
            onScanCategory={(id, enabled) => void updateScanCategory(id, enabled)}
            onLowDiskAlert={(patch) => void updateLowDiskAlert(patch)}
            onLaunchAtLogin={(enabled) => void updateLaunchAtLogin(enabled)}
            onScanReminder={(patch) => void updateScanReminder(patch)}
            onPro={(isPro) => void updatePro(isPro)}
            onPermissions={() => setView('permissions')}
          />
        )}
        {view === 'donate' && <DonateView t={t} />}
        {import.meta.env.DEV && view === 'debug' && <DebugView />}
      </main>
      {confirmCleanOpen && (
        <ConfirmDialog
          title={t('results.confirmTitle')}
          message={t(confirmCopyKey(selectedItems), {
            count: selectedItems.length,
            size: formatBytes(selectedBytes)
          })}
          warning={selectedItems.some((item) => item.categoryId === 'dockerDesktop')}
          confirmLabel={t('results.confirmAction')}
          cancelLabel={t('results.confirmCancel')}
          onConfirm={() => void cleanSelected()}
          onCancel={cancelCleanConfirm}
        />
      )}
    </div>
  )
}

function PermissionsView(props: {
  t: Translator
  perms: PermissionStatus | null
  grantTarget: GrantTarget | null
  onOpenSettings: () => Promise<void>
  onReveal: () => void
  onRecheck: () => Promise<void>
  onContinue: () => void
}): JSX.Element {
  const [copied, setCopied] = useState(false)
  const [openingSettings, openSettings] = useBusyAction(props.onOpenSettings)
  const [rechecking, recheck] = useBusyAction(props.onRecheck)
  const granted = Boolean(props.perms?.fullDiskAccess)
  // Packaged builds get no bundle-hunting instructions; the app appears under its own name.
  const devTarget = props.grantTarget?.packaged === false ? props.grantTarget : null

  async function copyPath(): Promise<void> {
    if (!devTarget) return
    await window.diskheadroom.copyText(devTarget.bundlePath)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section>
      <div className="hero">
        <div>
          <h2>{props.t('permissions.title')}</h2>
          <p>{props.t('permissions.description')}</p>
        </div>
      </div>
      {devTarget && !granted && (
        <div className="card">
          <h3>{props.t('permissions.devTitle', { app: devTarget.displayName })}</h3>
          <p className="muted">{props.t('permissions.devDescription')}</p>
          {devTarget.launchedBy && (
            <div className="notice">
              {props.t('permissions.launcherWarning', {
                launcher: devTarget.launchedBy,
                app: devTarget.displayName
              })}
            </div>
          )}
          <p className="path">{devTarget.bundlePath}</p>
          <div className="row">
            <button className="btn" type="button" onClick={props.onReveal}>
              {props.t('permissions.reveal')}
            </button>
            <button className="btn" type="button" onClick={() => void copyPath()}>
              {copied ? props.t('permissions.copied') : props.t('permissions.copy')}
            </button>
          </div>
          <p className="muted">{props.t('permissions.pickerHint')}</p>
        </div>
      )}
      <div className="card perm-grid">
        <PermissionRow
          t={props.t}
          title={props.t('permissions.fullDisk')}
          hint={props.t('permissions.fullDiskHint')}
          ok={Boolean(props.perms?.fullDiskAccess)}
        />
        <PermissionRow
          t={props.t}
          title={props.t('permissions.caches')}
          hint={props.t('permissions.cachesHint')}
          ok={Boolean(props.perms?.libraryCachesReadable)}
        />
        <PermissionRow
          t={props.t}
          title={props.t('permissions.applications')}
          hint={props.t('permissions.applicationsHint')}
          ok={Boolean(props.perms?.applicationsReadable)}
        />
      </div>
      <div className="row">
        <button
          className={`btn primary${openingSettings ? ' busy' : ''}`}
          type="button"
          disabled={openingSettings}
          onClick={openSettings}
        >
          {openingSettings && <Spinner />}
          {props.t('permissions.openSettings')}
        </button>
        <button
          className={`btn${rechecking ? ' busy' : ''}`}
          type="button"
          disabled={rechecking}
          onClick={recheck}
        >
          {rechecking && <Spinner />}
          {rechecking ? props.t('permissions.rechecking') : props.t('permissions.recheck')}
        </button>
        <button className="btn" type="button" onClick={props.onContinue}>
          {props.t('permissions.continueLimited')}
        </button>
      </div>
    </section>
  )
}

function PermissionRow(props: {
  t: Translator
  title: string
  hint: string
  ok: boolean
}): JSX.Element {
  return (
    <div className="perm-item">
      <div>
        <h3>{props.title}</h3>
        <p className="muted">{props.hint}</p>
      </div>
      <span className={`status ${props.ok ? 'ok' : 'bad'}`}>
        {props.ok ? props.t('permissions.granted') : props.t('permissions.missing')}
      </span>
    </div>
  )
}

function DiskPanel(props: {
  t: Translator
  disk: DiskInfo | null
  usedPct: number
  foundBytes?: number
  selectedBytes?: number
}): JSX.Element | null {
  const disk = props.disk
  if (!disk) return null

  const selectedBytes = props.selectedBytes ?? 0
  // The selected slice is carved out of the used segment so the bar shows what
  // would move to the free side, instead of two totals that no longer add up.
  const selectedPct = Math.min(props.usedPct, (selectedBytes / disk.totalBytes) * 100)

  return (
    <div className="card disk-panel">
      <div className="disk-head">
        <div>
          <h3>{props.t('disk.title')}</h3>
          <p className="muted">{props.t('disk.autoRefresh')}</p>
        </div>
        <strong className="disk-headline">
          {props.t('dashboard.diskFree', {
            free: formatBytes(disk.freeBytes),
            total: formatBytes(disk.totalBytes)
          })}
        </strong>
      </div>
      <div className="disk-bar">
        <span className="seg used" style={{ width: `${props.usedPct - selectedPct}%` }} />
        <span className="seg selected" style={{ width: `${selectedPct}%` }} />
      </div>
      <div className="disk-stats">
        <DiskStat
          label={props.t('disk.usedLabel')}
          value={formatBytes(disk.usedBytes)}
          detail={props.t('disk.percentUsed', { percent: props.usedPct })}
          tone="used"
        />
        <DiskStat
          label={props.t('disk.freeLabel')}
          value={formatBytes(disk.freeBytes)}
          detail={props.t('disk.percentFree', { percent: Math.max(0, 100 - props.usedPct) })}
          tone="free"
        />
        {props.foundBytes !== undefined && (
          <DiskStat label={props.t('disk.foundLabel')} value={formatBytes(props.foundBytes)} />
        )}
        {selectedBytes > 0 && (
          <DiskStat
            label={props.t('disk.selectedLabel')}
            value={formatBytes(selectedBytes)}
            detail={props.t('disk.afterCleanup', {
              size: formatBytes(disk.freeBytes + selectedBytes)
            })}
            tone="selected"
          />
        )}
      </div>
    </div>
  )
}

function DiskStat(props: {
  label: string
  value: string
  detail?: string
  tone?: 'used' | 'free' | 'selected'
}): JSX.Element {
  return (
    <div className="disk-stat">
      <span className="disk-stat-label">
        {props.tone && <i className={`dot ${props.tone}`} aria-hidden="true" />}
        {props.label}
      </span>
      <strong>{props.value}</strong>
      {props.detail && <small className="muted">{props.detail}</small>}
    </div>
  )
}

function DashboardView(props: {
  t: Translator
  disk: DiskInfo | null
  usedPct: number
  scanning: boolean
  progress: ScanProgress | null
  unusedDays: number
  limited: boolean
  scanFailed: boolean
  onScan: () => void
}): JSX.Element {
  return (
    <section>
      <div className="hero">
        <div>
          <h2>{props.t('dashboard.title')}</h2>
          <p>{props.t('dashboard.description', { days: props.unusedDays })}</p>
        </div>
      </div>
      <DiskPanel t={props.t} disk={props.disk} usedPct={props.usedPct} />
      {props.limited && (
        <div className="notice">{props.t('dashboard.limited')}</div>
      )}
      {props.scanFailed && (
        <div className="notice" role="alert">
          {props.t('dashboard.scanFailed')}
        </div>
      )}
      <div className="row">
        <button
          className={`btn primary${props.scanning ? ' busy' : ''}`}
          type="button"
          disabled={props.scanning}
          onClick={props.onScan}
        >
          {props.scanning && <Spinner />}
          {props.scanning ? props.t('dashboard.scanning') : props.t('dashboard.scan')}
        </button>
      </div>
      {props.scanning && props.progress && (
        <div className="progress">
          <p className="muted">
            {props.t('dashboard.progress', {
              phase: props.t(props.progress.phase),
              percent: props.progress.percent
            })}
          </p>
          <div className="progress-track">
            <span style={{ width: `${props.progress.percent}%` }} />
          </div>
        </div>
      )}
    </section>
  )
}

function ResultItemRow(props: {
  t: Translator
  locale: Locale
  item: ScanItem
  checked: boolean
  onToggle: (item: ScanItem, value: boolean) => void
}): JSX.Element {
  const { t, item } = props
  const [copied, setCopied] = useState(false)

  async function copyPath(): Promise<void> {
    await window.diskheadroom.copyText(item.path)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="item">
      <label className="item-select">
        <input
          type="checkbox"
          checked={props.checked}
          onChange={(event) => props.onToggle(item, event.target.checked)}
        />
        <span>
          <strong>{item.nameKey ? t(item.nameKey) : item.name}</strong>
          <div className="path">{item.path}</div>
          {(item.categoryId === 'unusedApps' || item.categoryId === 'idleUserFolders') && (
            <div className="muted">
              {t('results.lastUsed', {
                date: item.lastUsedAt
                  ? formatDate(item.lastUsedAt, props.locale)
                  : t('results.never')
              })}
              {item.daysIdle !== null ? ` · ${t('results.idleDays', { days: item.daysIdle })}` : ''}
            </div>
          )}
        </span>
      </label>
      <div className="item-side">
        <strong>{formatBytes(item.bytes)}</strong>
        <div className="item-actions">
          <button
            className="btn compact"
            type="button"
            onClick={() => void window.diskheadroom.revealItem(item.path)}
          >
            {t('results.reveal')}
          </button>
          <button className="btn compact" type="button" onClick={() => void copyPath()}>
            {copied ? t('results.copied') : t('results.copy')}
          </button>
        </div>
      </div>
    </div>
  )
}

function itemMatchesFilter(item: ScanItem, query: string, t: Translator): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const name = (item.nameKey ? t(item.nameKey) : item.name).toLowerCase()
  return name.includes(needle) || item.path.toLowerCase().includes(needle)
}

function ResultsView(props: {
  t: Translator
  locale: Locale
  result: ScanResult
  disk: DiskInfo | null
  isPro: boolean
  lastCleanResult: CleanResult | null
  usedPct: number
  foundBytes: number
  selected: Record<string, boolean>
  selectedBytes: number
  selectedCount: number
  busyClean: boolean
  cleanMessage: string | null
  cleanFailed: { path: string; error: string }[]
  onToggle: (item: ScanItem, value: boolean) => void
  onToggleCategory: (ids: string[], value: boolean) => void
  onClean: () => void
  onRescan: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [busyExport, setBusyExport] = useState(false)
  const [reportStatus, setReportStatus] = useState<{ message: string; isError?: boolean } | null>(null)

  async function handleExportReport(): Promise<void> {
    if (!props.isPro) {
      setReportStatus({ message: props.t('results.proRequired'), isError: true })
      return
    }
    setBusyExport(true)
    setReportStatus(null)
    try {
      const exportRes = await window.diskheadroom.exportReport({
        scanResult: props.result,
        cleanResult: props.lastCleanResult ?? undefined,
        disk: props.disk ?? undefined,
        options: {
          locale: props.locale,
          format: 'markdown'
        }
      })
      if (exportRes.success && exportRes.filePath) {
        setReportStatus({
          message: props.t('results.reportSaved', { path: exportRes.filePath }),
          isError: false
        })
      } else if (!exportRes.canceled) {
        if (exportRes.error === 'PRO_REQUIRED') {
          setReportStatus({ message: props.t('results.proRequired'), isError: true })
        } else {
          setReportStatus({ message: props.t('results.reportFailed'), isError: true })
        }
      }
    } catch {
      setReportStatus({ message: props.t('results.reportFailed'), isError: true })
    } finally {
      setBusyExport(false)
    }
  }

  const grouped = new Map<ScanItem['categoryId'], ScanItem[]>()
  for (const item of props.result.items) {
    if (!itemMatchesFilter(item, query, props.t)) continue
    const list = grouped.get(item.categoryId) ?? []
    list.push(item)
    grouped.set(item.categoryId, list)
  }
  const visibleCount = Array.from(grouped.values()).reduce((sum, items) => sum + items.length, 0)
  const filtering = query.trim().length > 0

  return (
    <section>
      <div className="hero">
        <div>
          <h2>{props.t('results.title')}</h2>
          <p>{props.t('results.description')}</p>
          <p className="muted">
            {props.t('results.scannedAt', {
              date: formatDate(props.result.scannedAt, props.locale, true)
            })}
          </p>
        </div>
      </div>
      <DiskPanel
        t={props.t}
        disk={props.disk}
        usedPct={props.usedPct}
        foundBytes={props.foundBytes}
        selectedBytes={props.selectedBytes}
      />
      {props.result.limited && (
        <div className="notice">{props.t('results.limited')}</div>
      )}
      {props.cleanMessage && (
        <div className="card">
          <p className="muted">{props.cleanMessage}</p>
          {props.cleanFailed.length > 0 && (
            <>
              <p className="muted">{props.t('results.failedTitle')}</p>
              <ul className="failed-list">
                {props.cleanFailed.map((item) => (
                  <li key={item.path} className="path">
                    {item.path}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted">{props.t('results.trashHint')}</p>
        </div>
      )}
      {reportStatus && (
        <div className="card">
          <p className={reportStatus.isError ? 'notice' : 'muted'}>{reportStatus.message}</p>
        </div>
      )}
      {props.result.items.length > 0 && (
        <div className="results-filter">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={props.t('results.filterPlaceholder')}
            aria-label={props.t('results.filterPlaceholder')}
          />
        </div>
      )}
      {Array.from(grouped.entries()).map(([categoryId, items]) => {
        // Select/clear group only toggles the rows currently on screen, so a
        // filter cannot silently change hidden items in the same category.
        const ids = items.map((item) => item.id)
        const allOn = ids.every((id) => props.selected[id])
        const bytes = items.reduce((sum, item) => sum + item.bytes, 0)
        const meta = CATEGORY_META[categoryId]
        return (
          <div className="list-card category" key={categoryId}>
            <div className="category-head">
              <div>
                <h3>{props.t(meta.title)}</h3>
                <p className="muted">{props.t(meta.hint)}</p>
              </div>
              <div className="row">
                <span className="muted">{formatBytes(bytes)}</span>
                <button className="btn" type="button" onClick={() => props.onToggleCategory(ids, !allOn)}>
                  {allOn ? props.t('results.groupClear') : props.t('results.groupSelect')}
                </button>
              </div>
            </div>
            {CATEGORY_WARNING[categoryId] && (
              <div className="notice">{props.t(CATEGORY_WARNING[categoryId])}</div>
            )}
            {items
              .slice()
              .sort((a, b) => b.bytes - a.bytes)
              .map((item) => (
                <ResultItemRow
                  key={item.id}
                  t={props.t}
                  locale={props.locale}
                  item={item}
                  checked={Boolean(props.selected[item.id])}
                  onToggle={props.onToggle}
                />
              ))}
          </div>
        )
      })}
      {props.result.items.length === 0 && (
        <div className="card">
          <h3>{props.t('results.emptyTitle')}</h3>
          <p className="muted">{props.t('results.emptyHint')}</p>
        </div>
      )}
      {filtering && visibleCount === 0 && props.result.items.length > 0 && (
        <div className="card">
          <h3>{props.t('results.filterEmptyTitle')}</h3>
          <p className="muted">{props.t('results.filterEmptyHint')}</p>
        </div>
      )}
      <div className="footer-bar">
        <span>
          {props.t(props.selectedCount === 1 ? 'results.selectedOne' : 'results.selectedOther', {
            count: props.selectedCount,
            size: formatBytes(props.selectedBytes)
          })}
        </span>
        <div className="row">
          <button
            className={`btn${busyExport ? ' busy' : ''}`}
            type="button"
            disabled={busyExport}
            onClick={() => void handleExportReport()}
          >
            {busyExport && <Spinner />}
            {busyExport
              ? props.t('results.exportingReport')
              : props.isPro
                ? props.t('results.exportReport')
                : props.t('results.exportReportPro')}
            {!props.isPro && <span className="badge">{props.t('results.proBadge')}</span>}
          </button>
          <button className="btn" type="button" onClick={props.onRescan}>
            {props.t('results.rescan')}
          </button>
          <button
            className={`btn danger${props.busyClean ? ' busy' : ''}`}
            type="button"
            disabled={props.selectedCount === 0 || props.busyClean}
            onClick={props.onClean}
          >
            {props.busyClean && <Spinner />}
            {props.busyClean ? props.t('results.moving') : props.t('results.moveTrash')}
          </button>
        </div>
      </div>
    </section>
  )
}

function SettingsView(props: {
  t: Translator
  settings: AppSettings
  onUnusedDays: (value: UnusedDays) => void
  onLocale: (value: Locale) => void
  onScanCategory: (id: ScanCategoryFlag, enabled: boolean) => void
  onLowDiskAlert: (patch: Partial<LowDiskAlertSettings>) => void
  onLaunchAtLogin: (enabled: boolean) => void
  onScanReminder: (patch: Partial<ScanReminderSettings>) => void
  onPro: (enabled: boolean) => void
  onPermissions: () => void
}): JSX.Element {
  const alert = props.settings.lowDiskAlert
  const reminder = props.settings.scanReminder
  const presets = LOW_DISK_ALERT_PRESETS.some(
    (preset) => preset.kind === alert.kind && preset.value === alert.value
  )
    ? LOW_DISK_ALERT_PRESETS
    : [{ kind: alert.kind, value: alert.value }, ...LOW_DISK_ALERT_PRESETS]

  return (
    <section>
      <div className="hero">
        <div>
          <h2>{props.t('settings.title')}</h2>
          <p>{props.t('settings.description')}</p>
        </div>
      </div>
      <div className="card">
        <h3>{props.t('settings.proTitle')}</h3>
        <p className="muted">{props.t('settings.proHint')}</p>
        <label className="scan-flag">
          <input
            type="checkbox"
            checked={props.settings.isPro}
            onChange={(event) => props.onPro(event.target.checked)}
          />
          <span>{props.t('settings.proEnable')}</span>
        </label>
      </div>
      <div className="card">
        <h3>{props.t('settings.scanTitle')}</h3>
        <p className="muted">{props.t('settings.scanHint')}</p>
        <div className="scan-flags">
          {SCAN_CATEGORY_IDS.map((id) => (
            <label key={id} className="scan-flag">
              <input
                type="checkbox"
                checked={props.settings.scanCategories[id]}
                onChange={(event) => props.onScanCategory(id, event.target.checked)}
              />
              <span>{props.t(SCAN_CATEGORY_LABELS[id])}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="card">
        <h3>{props.t('settings.idleTitle')}</h3>
        <p className="muted">{props.t('settings.idleHint')}</p>
        <select
          value={props.settings.unusedDays}
          onChange={(event) => props.onUnusedDays(Number(event.target.value) as UnusedDays)}
        >
          {UNUSED_DAY_OPTIONS.map((days) => (
            <option key={days} value={days}>
              {props.t('settings.days', { days })}
            </option>
          ))}
        </select>
      </div>
      <div className="card">
        <h3>{props.t('settings.launchAtLoginTitle')}</h3>
        <p className="muted">{props.t('settings.launchAtLoginHint')}</p>
        <label className="scan-flag">
          <input
            type="checkbox"
            checked={props.settings.launchAtLogin}
            onChange={(event) => props.onLaunchAtLogin(event.target.checked)}
          />
          <span>{props.t('settings.launchAtLoginEnable')}</span>
        </label>
      </div>
      <div className="card">
        <h3>{props.t('settings.scanReminderTitle')}</h3>
        <p className="muted">{props.t('settings.scanReminderHint')}</p>
        <label className="scan-flag">
          <input
            type="checkbox"
            checked={reminder.enabled}
            onChange={(event) => props.onScanReminder({ enabled: event.target.checked })}
          />
          <span>{props.t('settings.scanReminderEnable')}</span>
        </label>
        <label className="field-label" htmlFor="scan-reminder-interval">
          {props.t('settings.scanReminderInterval')}
        </label>
        <select
          id="scan-reminder-interval"
          disabled={!reminder.enabled}
          value={reminder.intervalDays}
          onChange={(event) =>
            props.onScanReminder({
              intervalDays: Number(event.target.value) as ScanReminderSettings['intervalDays']
            })
          }
        >
          {SCAN_REMINDER_INTERVAL_DAYS.map((days) => (
            <option key={days} value={days}>
              {props.t('settings.scanReminder.days', { days })}
            </option>
          ))}
        </select>
      </div>
      <div className="card">
        <h3>{props.t('settings.lowDiskTitle')}</h3>
        <p className="muted">{props.t('settings.lowDiskHint')}</p>
        <label className="scan-flag">
          <input
            type="checkbox"
            checked={alert.enabled}
            onChange={(event) => props.onLowDiskAlert({ enabled: event.target.checked })}
          />
          <span>{props.t('settings.lowDiskEnable')}</span>
        </label>
        <label className="field-label" htmlFor="low-disk-threshold">
          {props.t('settings.lowDiskThreshold')}
        </label>
        <select
          id="low-disk-threshold"
          disabled={!alert.enabled}
          value={lowDiskAlertPresetKey(alert.kind, alert.value)}
          onChange={(event) => {
            const parsed = parseLowDiskAlertPreset(event.target.value)
            if (parsed) props.onLowDiskAlert(parsed)
          }}
        >
          {presets.map((preset) => (
            <option key={lowDiskAlertPresetKey(preset.kind, preset.value)} value={lowDiskAlertPresetKey(preset.kind, preset.value)}>
              {props.t(
                preset.kind === 'percent' ? 'settings.lowDisk.percent' : 'settings.lowDisk.gigabytes',
                { value: preset.value }
              )}
            </option>
          ))}
        </select>
      </div>
      <div className="card">
        <h3>{props.t('settings.languageTitle')}</h3>
        <p className="muted">{props.t('settings.languageHint')}</p>
        <select
          value={props.settings.locale}
          onChange={(event) => props.onLocale(event.target.value as Locale)}
        >
          {LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {LOCALE_NAMES[locale]}
            </option>
          ))}
        </select>
      </div>
      <div className="card">
        <h3>{props.t('settings.permissionsTitle')}</h3>
        <p className="muted">{props.t('settings.permissionsHint')}</p>
        <button className="btn" type="button" onClick={props.onPermissions}>
          {props.t('settings.openPermissions')}
        </button>
      </div>
    </section>
  )
}

const SIMULATION_OPTIONS = [0, 2, 5, 8, 12, 20, 40] as const

// Development-only harness for the low disk alert: pin free space, run the real
// check, and inspect the cooldown without waiting for the disk to fill up.
// Copy stays in English and out of languages.json because it never ships.
function DebugView(): JSX.Element {
  const debug = window.diskheadroom.debug
  const [status, setStatus] = useState<LowDiskDebugStatus | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!debug) return
    setStatus(await debug.lowDiskStatus())
  }, [debug])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(timer)
  }, [refresh])

  if (!debug) {
    return (
      <section>
        <div className="card">
          <p className="muted">Debug bridge unavailable.</p>
        </div>
      </section>
    )
  }

  async function run(label: string, action: () => Promise<LowDiskDebugStatus>): Promise<void> {
    setBusy(true)
    try {
      setStatus(await action())
      setNote(`${label} at ${new Date().toLocaleTimeString()}`)
    } finally {
      setBusy(false)
    }
  }

  const cooldownLeft =
    status?.lastFiredAt == null
      ? 0
      : Math.max(0, status.lastFiredAt + status.cooldownMs - Date.now())

  return (
    <section>
      <div className="hero">
        <div>
          <h2>Debug</h2>
          <p>Development build only. This tab is absent from packaged builds and screenshots.</p>
        </div>
      </div>
      <div className="card">
        <h3>Low disk alert</h3>
        <dl className="debug-grid">
          <dt>Real free space</dt>
          <dd>
            {status ? formatBytes(status.realFreeBytes) : '—'}
            {status && status.disk.totalBytes > 0
              ? ` (${Math.round((status.realFreeBytes / status.disk.totalBytes) * 100)}%)`
              : ''}
          </dd>
          <dt>Free space the watcher sees</dt>
          <dd>
            {status ? formatBytes(status.disk.freeBytes) : '—'}
            {status?.simulatedFreePercent == null
              ? ''
              : ` (simulated ${status.simulatedFreePercent}%)`}
          </dd>
          <dt>Setting</dt>
          <dd>
            {status
              ? `${status.alert.enabled ? 'on' : 'off'} · below ${status.alert.value}${
                  status.alert.kind === 'percent' ? '%' : ' GB'
                } free`
              : '—'}
          </dd>
          <dt>Below threshold</dt>
          <dd>{status ? (status.belowThreshold ? 'yes' : 'no') : '—'}</dd>
          <dt>Last notification</dt>
          <dd>
            {status?.lastFiredAt == null
              ? 'never'
              : new Date(status.lastFiredAt).toLocaleString()}
          </dd>
          <dt>Cooldown left</dt>
          <dd>{cooldownLeft === 0 ? 'none' : `${Math.ceil(cooldownLeft / 60000)} min`}</dd>
          <dt>Notification Center</dt>
          <dd>{status ? (status.notificationsSupported ? 'supported' : 'unavailable') : '—'}</dd>
        </dl>
        <label className="field-label" htmlFor="debug-simulate">
          Simulate free space
        </label>
        <select
          id="debug-simulate"
          value={status?.simulatedFreePercent ?? ''}
          onChange={(event) => {
            const raw = event.target.value
            void run('Simulation changed', () =>
              debug.simulateFreePercent(raw === '' ? null : Number(raw))
            )
          }}
        >
          <option value="">Off (real disk)</option>
          {SIMULATION_OPTIONS.map((percent) => (
            <option key={percent} value={percent}>
              {percent}% free
            </option>
          ))}
        </select>
        <div className="debug-actions">
          <button
            className="btn primary"
            type="button"
            disabled={busy}
            onClick={() => void run('Check finished', debug.runLowDiskCheck)}
          >
            Run check now
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() =>
              void run('Test notification sent', async () => {
                const outcome = await debug.sendLowDiskNotification()
                return outcome.status
              })
            }
          >
            Send test notification
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => void run('Cooldown reset', debug.resetLowDiskCooldown)}
          >
            Reset cooldown
          </button>
        </div>
        {note && <p className="muted">{note}</p>}
      </div>
    </section>
  )
}

function DonateView(props: { t: Translator }): JSX.Element {
  const [opening, openSponsors] = useBusyAction(() =>
    window.diskheadroom.openExternal(SPONSORS_URL)
  )

  return (
    <section className="donate-panel">
      <div className="hero">
        <div>
          <h2>{props.t('donate.title')}</h2>
          <p>{props.t('donate.description')}</p>
        </div>
      </div>
      <div className="card">
        <p className="muted">{props.t('donate.body')}</p>
        <button
          className={`btn primary${opening ? ' busy' : ''}`}
          type="button"
          disabled={opening}
          onClick={openSponsors}
        >
          {opening && <Spinner />}
          {props.t('donate.button')}
        </button>
      </div>
      <p className="muted">
        {props.t('donate.source')}{' '}
        <button className="btn" type="button" onClick={() => void window.diskheadroom.openExternal(REPO_URL)}>
          github.com/nettonucci/diskheadroom
        </button>
      </p>
    </section>
  )
}
