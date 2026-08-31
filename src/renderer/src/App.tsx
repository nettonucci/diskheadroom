import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { UNUSED_DAY_OPTIONS, SPONSORS_URL, REPO_URL, type UnusedDays } from '../../shared/constants'
import {
  LOCALES,
  LOCALE_NAMES,
  translator,
  type Locale,
  type Translator
} from '../../shared/i18n'
import type {
  AppSettings,
  DiskInfo,
  GrantTarget,
  PermissionStatus,
  ScanItem,
  ScanProgress,
  ScanResult
} from '../../shared/types'
import { CATEGORY_META, NAV, type ViewId } from './lib/copy'
import { formatBytes, formatDate } from './lib/format'
import markUrl from '@brand/mark-color.svg'

function Spinner(): JSX.Element {
  return <span className="spinner" aria-hidden="true" />
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
  const [busyClean, setBusyClean] = useState(false)
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
    setProgress({ phase: 'progress.starting', percent: 2 })
    // Rescans triggered from the results list would otherwise run with no visible
    // sign of work; the dashboard is where the progress bar lives.
    setView('dashboard')
    try {
      const next = await window.diskheadroom.runScan(settings.unusedDays)
      setResult(next)
      const initial: Record<string, boolean> = {}
      for (const item of next.items) {
        initial[item.id] = item.selectedByDefault
      }
      setSelected(initial)
      setView('results')
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

  async function markSetupDone(): Promise<void> {
    if (!settings) return
    const next = await window.diskheadroom.setSettings({ ...settings, setupComplete: true })
    setSettings(next)
    setView('dashboard')
  }

  async function updateUnusedDays(unusedDays: UnusedDays): Promise<void> {
    if (!settings) return
    const next = await window.diskheadroom.setSettings({ ...settings, unusedDays })
    setSettings(next)
  }

  async function updateLocale(nextLocale: Locale): Promise<void> {
    if (!settings) return
    const next = await window.diskheadroom.setSettings({ ...settings, locale: nextLocale })
    setSettings(next)
  }

  async function cleanSelected(): Promise<void> {
    if (selectedItems.length === 0) return
    const includesDocker = selectedItems.some((item) => item.categoryId === 'dockerDesktop')
    const confirmKey =
      selectedItems.length === 1
        ? includesDocker
          ? 'results.confirmDockerOne'
          : 'results.confirmOne'
        : includesDocker
          ? 'results.confirmDockerOther'
          : 'results.confirmOther'
    const confirmed = window.confirm(
      t(confirmKey, {
        count: selectedItems.length,
        size: formatBytes(selectedBytes)
      })
    )
    if (!confirmed) return
    setBusyClean(true)
    try {
      const outcome = await window.diskheadroom.trashItems({
        paths: selectedItems.map((item) => item.path)
      })
      const recovered = selectedItems
        .filter((item) => outcome.trashed.includes(item.path))
        .reduce((sum, item) => sum + item.bytes, 0)
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
            onScan={() => void startScan()}
          />
        )}
        {view === 'results' && result && (
          <ResultsView
            t={t}
            locale={locale}
            result={result}
            disk={disk}
            usedPct={usedPct}
            foundBytes={foundBytes}
            selected={selected}
            selectedBytes={selectedBytes}
            selectedCount={selectedItems.length}
            busyClean={busyClean}
            cleanMessage={cleanMessage}
            onToggle={(item, value) => setSelected((current) => ({ ...current, [item.id]: value }))}
            onToggleCategory={(ids, value) => {
              setSelected((current) => {
                const next = { ...current }
                for (const id of ids) next[id] = value
                return next
              })
            }}
            onClean={() => void cleanSelected()}
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
            onScan={() => void startScan()}
          />
        )}
        {view === 'settings' && settings && (
          <SettingsView
            t={t}
            settings={settings}
            onUnusedDays={(value) => void updateUnusedDays(value)}
            onLocale={(value) => void updateLocale(value)}
            onPermissions={() => setView('permissions')}
          />
        )}
        {view === 'donate' && <DonateView t={t} />}
      </main>
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

function ResultsView(props: {
  t: Translator
  locale: Locale
  result: ScanResult
  disk: DiskInfo | null
  usedPct: number
  foundBytes: number
  selected: Record<string, boolean>
  selectedBytes: number
  selectedCount: number
  busyClean: boolean
  cleanMessage: string | null
  onToggle: (item: ScanItem, value: boolean) => void
  onToggleCategory: (ids: string[], value: boolean) => void
  onClean: () => void
  onRescan: () => void
}): JSX.Element {
  const grouped = new Map<ScanItem['categoryId'], ScanItem[]>()
  for (const item of props.result.items) {
    const list = grouped.get(item.categoryId) ?? []
    list.push(item)
    grouped.set(item.categoryId, list)
  }

  return (
    <section>
      <div className="hero">
        <div>
          <h2>{props.t('results.title')}</h2>
          <p>{props.t('results.description')}</p>
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
          <p className="muted">{props.t('results.trashHint')}</p>
        </div>
      )}
      {Array.from(grouped.entries()).map(([categoryId, items]) => {
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
            {categoryId === 'dockerDesktop' && (
              <div className="notice">{props.t('category.dockerDesktop.warning')}</div>
            )}
            {items
              .slice()
              .sort((a, b) => b.bytes - a.bytes)
              .map((item) => (
                <label className="item" key={item.id}>
                  <input
                    type="checkbox"
                    checked={Boolean(props.selected[item.id])}
                    onChange={(event) => props.onToggle(item, event.target.checked)}
                  />
                  <span>
                    <strong>{item.nameKey ? props.t(item.nameKey) : item.name}</strong>
                    <div className="path">{item.path}</div>
                    {item.categoryId === 'unusedApps' && (
                      <div className="muted">
                        {props.t('results.lastUsed', {
                          date: item.lastUsedAt
                            ? formatDate(item.lastUsedAt, props.locale)
                            : props.t('results.never')
                        })}
                        {item.daysIdle !== null
                          ? ` · ${props.t('results.idleDays', { days: item.daysIdle })}`
                          : ''}
                      </div>
                    )}
                  </span>
                  <strong>{formatBytes(item.bytes)}</strong>
                </label>
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
      <div className="footer-bar">
        <span>
          {props.t(props.selectedCount === 1 ? 'results.selectedOne' : 'results.selectedOther', {
            count: props.selectedCount,
            size: formatBytes(props.selectedBytes)
          })}
        </span>
        <div className="row">
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
  onPermissions: () => void
}): JSX.Element {
  return (
    <section>
      <div className="hero">
        <div>
          <h2>{props.t('settings.title')}</h2>
          <p>{props.t('settings.description')}</p>
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
