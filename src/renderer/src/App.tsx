import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX
} from 'react'
import {
  UNUSED_DAY_OPTIONS,
  SCAN_CATEGORY_IDS,
  SPONSORS_URL,
  REPO_URL,
  proCheckoutUrl,
  LOW_DISK_ALERT_PRESETS,
  SCAN_REMINDER_INTERVAL_DAYS,
  LARGE_FILE_MIN_BYTES_OPTIONS,
  DOWNLOADS_MIN_DAYS_OPTIONS,
  DOWNLOADS_MIN_BYTES_OPTIONS,
  HEADROOM_DISPLAY_MAX_DAYS,
  DEFAULT_LOW_DISK_ALERT,
  isProScanCategory,
  lowDiskAlertPresetKey,
  parseLowDiskAlertPreset,
  type LargeFileMinBytes,
  type DownloadsMinBytes,
  type DownloadsMinDays,
  type LowDiskAlertSettings,
  type ScanCategoryFlag,
  type ScanReminderSettings,
  type UnusedDays
} from '../../shared/constants'
import { APPEARANCE_OPTIONS, type Appearance } from '../../shared/appearance'
import { applyDocumentTheme } from './lib/theme'
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
  DiskInfo,
  GrantTarget,
  LowDiskDebugStatus,
  PermissionStatus,
  ScanItem,
  ScanProgress,
  ScanResult,
  AppUpdateStatus
} from '../../shared/types'
import {
  CATEGORY_META,
  CATEGORY_WARNING,
  NAV,
  SETTINGS_TABS,
  SCAN_CATEGORY_LABELS,
  tabForSection,
  type SettingsSection,
  type SettingsTab,
  type ViewId
} from './lib/copy'
import { APP_SHORTCUTS, matchAppShortcut } from './lib/shortcuts'
import { formatBytes, formatDate } from './lib/format'
import { isProEntitled } from '../../shared/entitlement'
import { gatedForecastStatus, type HeadroomForecastStatus } from '../../shared/headroomForecast'
import {
  categoryExtrasSelected,
  isLastUnselectedDuplicate,
  selectionAfterCategoryToggle
} from '../../shared/duplicates'
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

function WelcomePreferencesDialog(props: {
  t: Translator
  locale: Locale
  appearance: Appearance
  onLocale: (locale: Locale) => void
  onAppearance: (appearance: Appearance) => void
  onContinue: () => void
  onDone: () => void
  step: 'choose' | 'howto'
}): JSX.Element {
  return (
    <div className="dialog-backdrop welcome" role="presentation">
      <div
        className="dialog welcome"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-preferences-title"
        aria-describedby="welcome-preferences-message"
      >
        {props.step === 'choose' ? (
          <>
            <h3 id="welcome-preferences-title">{props.t('welcome.preferences.title')}</h3>
            <p id="welcome-preferences-message" className="muted">
              {props.t('welcome.preferences.subtitle')}
            </p>
            <div className="dialog-field">
              <label htmlFor="welcome-appearance">{props.t('settings.appearanceTitle')}</label>
              <select
                id="welcome-appearance"
                value={props.appearance}
                onChange={(event) => props.onAppearance(event.target.value as Appearance)}
              >
                {APPEARANCE_OPTIONS.map((appearance) => (
                  <option key={appearance} value={appearance}>
                    {props.t(`settings.appearance.${appearance}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="dialog-field">
              <label htmlFor="welcome-locale">{props.t('settings.languageTitle')}</label>
              <select
                id="welcome-locale"
                value={props.locale}
                onChange={(event) => props.onLocale(event.target.value as Locale)}
              >
                {LOCALES.map((locale) => (
                  <option key={locale} value={locale}>
                    {LOCALE_NAMES[locale]}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <button className="btn primary" type="button" autoFocus onClick={props.onContinue}>
                {props.t('welcome.preferences.continue')}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 id="welcome-preferences-title">{props.t('welcome.preferences.doneTitle')}</h3>
            <p id="welcome-preferences-message" className="muted">
              {props.t('welcome.preferences.doneIntro')}
            </p>
            <ol className="dialog-steps">
              <li>
                {props.t('welcome.preferences.step1', { settings: props.t('nav.settings') })}
              </li>
              <li>
                {props.t('welcome.preferences.step2', { general: props.t('settings.tab.general') })}
              </li>
              <li>
                {props.t('welcome.preferences.step3', {
                  appearance: props.t('settings.appearanceTitle'),
                  language: props.t('settings.languageTitle')
                })}
              </li>
            </ol>
            <div className="row">
              <button className="btn primary" type="button" autoFocus onClick={props.onDone}>
                {props.t('welcome.preferences.gotIt')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

type TourStep = {
  selector: string
  title: TranslationKey
  body: TranslationKey
  placement: 'right' | 'vertical'
  view?: ViewId
  settingsTab?: SettingsTab
}

const PRODUCT_TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="navigation"]',
    title: 'tour.navigation.title',
    body: 'tour.navigation.body',
    placement: 'right',
    view: 'dashboard'
  },
  {
    selector: '[data-tour="disk"]',
    title: 'tour.disk.title',
    body: 'tour.disk.body',
    placement: 'vertical',
    view: 'dashboard'
  },
  {
    selector: '[data-tour="forecast"]',
    title: 'tour.forecast.title',
    body: 'tour.forecast.body',
    placement: 'vertical',
    view: 'dashboard'
  },
  {
    selector: '[data-tour="scan"]',
    title: 'tour.scan.title',
    body: 'tour.scan.body',
    placement: 'vertical',
    view: 'dashboard'
  },
  {
    selector: '[data-tour="settings"]',
    title: 'tour.settings.title',
    body: 'tour.settings.body',
    placement: 'right',
    view: 'dashboard'
  },
  {
    selector: '[data-tour="settings-tabs"]',
    title: 'tour.settings.tabs.title',
    body: 'tour.settings.tabs.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'pro'
  },
  {
    selector: '[data-tour="settings-pro"]',
    title: 'tour.settings.pro.title',
    body: 'tour.settings.pro.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'pro'
  },
  {
    selector: '[data-tour="settings-donate"]',
    title: 'tour.settings.donate.title',
    body: 'tour.settings.donate.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'pro'
  },
  {
    selector: '[data-tour="settings-scan-categories"]',
    title: 'tour.settings.scanCategories.title',
    body: 'tour.settings.scanCategories.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'scan'
  },
  {
    selector: '[data-tour="settings-large-files"]',
    title: 'tour.settings.largeFiles.title',
    body: 'tour.settings.largeFiles.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'scan'
  },
  {
    selector: '[data-tour="settings-downloads"]',
    title: 'tour.settings.downloads.title',
    body: 'tour.settings.downloads.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'scan'
  },
  {
    selector: '[data-tour="settings-duplicates"]',
    title: 'tour.settings.duplicates.title',
    body: 'tour.settings.duplicates.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'scan'
  },
  {
    selector: '[data-tour="settings-never-touch"]',
    title: 'tour.settings.neverTouch.title',
    body: 'tour.settings.neverTouch.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'scan'
  },
  {
    selector: '[data-tour="settings-idle"]',
    title: 'tour.settings.idle.title',
    body: 'tour.settings.idle.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'scan'
  },
  {
    selector: '[data-tour="settings-permissions"]',
    title: 'tour.settings.permissions.title',
    body: 'tour.settings.permissions.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'permissions'
  },
  {
    selector: '[data-tour="settings-launch-at-login"]',
    title: 'tour.settings.launchAtLogin.title',
    body: 'tour.settings.launchAtLogin.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'general'
  },
  {
    selector: '[data-tour="settings-scan-reminder"]',
    title: 'tour.settings.scanReminder.title',
    body: 'tour.settings.scanReminder.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'general'
  },
  {
    selector: '[data-tour="settings-low-disk"]',
    title: 'tour.settings.lowDisk.title',
    body: 'tour.settings.lowDisk.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'general'
  },
  {
    selector: '[data-tour="settings-appearance"]',
    title: 'tour.settings.appearance.title',
    body: 'tour.settings.appearance.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'general'
  },
  {
    selector: '[data-tour="settings-shortcuts"]',
    title: 'tour.settings.shortcuts.title',
    body: 'tour.settings.shortcuts.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'general'
  },
  {
    selector: '[data-tour="settings-replay"]',
    title: 'tour.settings.replay.title',
    body: 'tour.settings.replay.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'general'
  },
  {
    selector: '[data-tour="settings-language"]',
    title: 'tour.settings.language.title',
    body: 'tour.settings.language.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'general'
  },
  {
    selector: '[data-tour="settings-updates"]',
    title: 'tour.settings.updates.title',
    body: 'tour.settings.updates.body',
    placement: 'vertical',
    view: 'settings',
    settingsTab: 'updates'
  }
]

const RESULTS_TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="results-overview"]',
    title: 'tour.results.overview.title',
    body: 'tour.results.overview.body',
    placement: 'vertical'
  },
  {
    selector: '[data-tour="results-summary"]',
    title: 'tour.results.summary.title',
    body: 'tour.results.summary.body',
    placement: 'vertical'
  },
  {
    selector: '[data-tour="results-filter"]',
    title: 'tour.results.filter.title',
    body: 'tour.results.filter.body',
    placement: 'vertical'
  },
  {
    selector: '[data-tour="results-group"]',
    title: 'tour.results.group.title',
    body: 'tour.results.group.body',
    placement: 'vertical'
  },
  {
    selector: '[data-tour="results-item"]',
    title: 'tour.results.item.title',
    body: 'tour.results.item.body',
    placement: 'vertical'
  },
  {
    selector: '[data-tour="results-actions"]',
    title: 'tour.results.actions.title',
    body: 'tour.results.actions.body',
    placement: 'vertical'
  }
]

type TourRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>

function visibleTourTarget(selector: string): Element | null {
  const matches = document.querySelectorAll(selector)
  for (const element of matches) {
    if (element.closest('[hidden]')) continue
    return element
  }
  return null
}

function ProductTour(props: {
  t: Translator
  steps: TourStep[]
  onClose: () => void
  onPrepareStep?: (step: TourStep) => void
  layoutKey?: string
}): JSX.Element {
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<TourRect | null>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(props.onClose)
  onCloseRef.current = props.onClose
  const steps = props.steps
  const step = steps[Math.min(stepIndex, Math.max(0, steps.length - 1))]

  useEffect(() => {
    if (stepIndex >= steps.length) onCloseRef.current()
  }, [stepIndex, steps.length])

  const move = useCallback((direction: 1 | -1) => {
    setStepIndex((current) => {
      const next = current + direction
      if (next < 0) return current
      if (next >= steps.length) {
        onCloseRef.current()
        return current
      }
      return next
    })
  }, [steps.length])

  useLayoutEffect(() => {
    props.onPrepareStep?.(step)
  }, [props.onPrepareStep, step])

  useLayoutEffect(() => {
    let attempts = 0
    let retry: number | undefined
    let cancelled = false
    let didScroll = false
    function sameRect(current: TourRect | null, rect: DOMRect): boolean {
      return Boolean(
        current &&
          current.top === rect.top &&
          current.left === rect.left &&
          current.width === rect.width &&
          current.height === rect.height
      )
    }
    function measure(scrollToTarget: boolean): void {
      if (cancelled) return
      const element = visibleTourTarget(step.selector)
      if (!element) {
        attempts += 1
        if (attempts < 24) {
          if (retry !== undefined) window.clearTimeout(retry)
          retry = window.setTimeout(() => measure(true), 16)
          return
        }
        setStepIndex((current) => {
          if (current >= steps.length - 1) {
            onCloseRef.current()
            return current
          }
          return current + 1
        })
        return
      }
      if (scrollToTarget && !didScroll) {
        didScroll = true
        element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      }
      const rect = element.getBoundingClientRect()
      setTargetRect((current) =>
        sameRect(current, rect)
          ? current
          : {
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left,
              width: rect.width,
              height: rect.height
            }
      )
    }
    measure(true)
    const onRelayout = () => measure(false)
    window.addEventListener('resize', onRelayout)
    document.querySelector('.main')?.addEventListener('scroll', onRelayout)
    return () => {
      cancelled = true
      if (retry !== undefined) window.clearTimeout(retry)
      window.removeEventListener('resize', onRelayout)
      document.querySelector('.main')?.removeEventListener('scroll', onRelayout)
    }
  }, [props.layoutKey, step.selector, stepIndex, steps.length])

  useEffect(() => {
    actionRef.current?.focus()
  }, [stepIndex])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        props.onClose()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        move(1)
      } else if (event.key === 'ArrowLeft' && stepIndex > 0) {
        event.preventDefault()
        move(-1)
      } else if (event.key === 'Tab') {
        const buttons = Array.from(
          document.querySelectorAll<HTMLButtonElement>('.tour-tooltip button:not(:disabled)')
        )
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
        if (buttons.length > 0 && event.shiftKey && current <= 0) {
          event.preventDefault()
          buttons.at(-1)?.focus()
        } else if (buttons.length > 0 && !event.shiftKey && current === buttons.length - 1) {
          event.preventDefault()
          buttons[0].focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, props.onClose, stepIndex])

  const padding = 8
  const spotlightStyle: CSSProperties | undefined = targetRect
    ? {
        top: Math.max(6, targetRect.top - padding),
        left: Math.max(6, targetRect.left - padding),
        width: Math.min(window.innerWidth - 12, targetRect.width + padding * 2),
        height: Math.min(window.innerHeight - 12, targetRect.height + padding * 2)
      }
    : undefined

  const tooltipWidth = Math.min(340, window.innerWidth - 32)
  const tooltipHeight = 260
  let tooltipTop = 24
  let tooltipLeft = Math.max(16, (window.innerWidth - tooltipWidth) / 2)
  if (targetRect) {
    if (step.placement === 'right') {
      tooltipTop = Math.min(
        Math.max(16, targetRect.top),
        window.innerHeight - tooltipHeight - 16
      )
      tooltipLeft = Math.min(targetRect.right + 20, window.innerWidth - tooltipWidth - 16)
    } else {
      const fitsBelow = targetRect.bottom + tooltipHeight + 20 < window.innerHeight
      tooltipTop = fitsBelow
        ? targetRect.bottom + 16
        : Math.max(16, targetRect.top - tooltipHeight - 16)
      tooltipLeft = Math.min(
        Math.max(16, targetRect.left + (targetRect.width - tooltipWidth) / 2),
        window.innerWidth - tooltipWidth - 16
      )
    }
  }

  const lastStep = stepIndex === steps.length - 1
  return (
    <div className="tour-layer" role="presentation">
      {spotlightStyle && <div className="tour-spotlight" style={spotlightStyle} />}
      <div
        className="tour-tooltip"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        style={{ top: tooltipTop, left: tooltipLeft, width: tooltipWidth }}
      >
        <p className="tour-progress" aria-live="polite">
          {props.t('tour.progress', {
            current: stepIndex + 1,
            total: steps.length
          })}
        </p>
        <h3 id="tour-title">{props.t(step.title)}</h3>
        <p id="tour-body" className="muted">
          {props.t(step.body)}
        </p>
        <div className="tour-actions">
          <button className="btn" type="button" onClick={props.onClose}>
            {props.t('tour.skip')}
          </button>
          <div className="row">
            {stepIndex > 0 && (
              <button className="btn" type="button" onClick={() => move(-1)}>
                {props.t('tour.back')}
              </button>
            )}
            <button
              ref={actionRef}
              className="btn primary"
              type="button"
              onClick={() => (lastStep ? props.onClose() : move(1))}
            >
              {props.t(lastStep ? 'tour.finish' : 'tour.next')}
            </button>
          </div>
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
  const [view, setView] = useState<ViewId>('dashboard')
  const [settingsSection, setSettingsSection] = useState<{
    id: SettingsSection
    nonce: number
  } | null>(null)
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
  const [scanFailed, setScanFailed] = useState(false)
  const [busyClean, setBusyClean] = useState(false)
  const [confirmCleanOpen, setConfirmCleanOpen] = useState(false)
  const [filterFocusNonce, setFilterFocusNonce] = useState(0)
  const [isPro, setIsPro] = useState(false)
  const [forecast, setForecast] = useState<HeadroomForecastStatus>(gatedForecastStatus)
  const [welcomeStep, setWelcomeStep] = useState<'choose' | 'howto'>('choose')
  const [tourKind, setTourKind] = useState<'intro' | 'results' | null>(null)
  const [tourReturnView, setTourReturnView] = useState<ViewId>('dashboard')
  const [tourSettingsTab, setTourSettingsTab] = useState<SettingsTab | null>(null)
  const bootstrapped = useRef(false)
  const locale = settings?.locale ?? 'en'
  const t = translator(locale)

  useEffect(() => {
    if (!settings) return
    return applyDocumentTheme(settings.appearance)
  }, [settings?.appearance])

  const refresh = useCallback(async () => {
    const [nextSettings, nextDisk, nextPerms, nextTarget, license, nextForecast] = await Promise.all([
      window.diskheadroom.getSettings(),
      // A failed capacity reading must not take the rest of the UI down with it:
      // the panel can be missing, the app still scans and cleans.
      window.diskheadroom.getDiskInfo().catch(() => null),
      window.diskheadroom.getPermissions(),
      window.diskheadroom.getGrantTarget(),
      window.diskheadroom.getLicenseStatus(),
      window.diskheadroom.getForecastStatus().catch(() => gatedForecastStatus())
    ])
    setSettings(nextSettings)
    setDisk(nextDisk)
    setPerms(nextPerms)
    setGrantTarget(nextTarget)
    setIsPro(isProEntitled(license.isPro))
    setForecast(isProEntitled(license.isPro) ? nextForecast : gatedForecastStatus())
    // Only the first load decides the landing view. Later refreshes come from
    // Recheck or a finished cleanup, and pulling the user out of the screen they
    // opened makes those buttons feel broken.
    if (!bootstrapped.current && !nextSettings.setupComplete) {
      setView('settings')
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
      const next = await window.diskheadroom.runScan({
        unusedDays: settings.unusedDays,
        categories: settings.scanCategories,
        largeFileMinBytes: settings.largeFileMinBytes,
        downloadsMinDays: settings.downloadsMinDays,
        downloadsMinBytes: settings.downloadsMinBytes
      })
      setResult(next)
      const initial: Record<string, boolean> = {}
      for (const item of next.items) {
        initial[item.id] = item.selectedByDefault
      }
      setSelected(initial)
      setView('results')
      if (!settings.resultsTourComplete) {
        if (next.items.length > 0) {
          setTourReturnView('results')
          setTourKind('results')
        } else {
          void updateSettings(() => ({ resultsTourComplete: true }))
        }
      }
    } catch {
      setScanFailed(true)
    } finally {
      setScanning(false)
      const nextForecast = await window.diskheadroom.getForecastStatus().catch(() => gatedForecastStatus())
      setForecast(isPro ? nextForecast : gatedForecastStatus())
    }
  }, [settings, scanning, isPro])

  useEffect(() => {
    const stopProgress = window.diskheadroom.onScanProgress(setProgress)
    const stopScan = window.diskheadroom.onTrayScan(() => {
      setView('dashboard')
      void startScan()
    })
    const stopDonate = window.diskheadroom.onTrayDonate(() => {
      setView('settings')
      setSettingsSection((current) => ({ id: 'donate', nonce: (current?.nonce ?? 0) + 1 }))
    })
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

  async function updateLargeFileMinBytes(largeFileMinBytes: LargeFileMinBytes): Promise<void> {
    await updateSettings(() => ({ largeFileMinBytes }))
  }

  async function updateDownloadsMinDays(downloadsMinDays: DownloadsMinDays): Promise<void> {
    await updateSettings(() => ({ downloadsMinDays }))
  }

  async function updateDownloadsMinBytes(downloadsMinBytes: DownloadsMinBytes): Promise<void> {
    await updateSettings(() => ({ downloadsMinBytes }))
  }

  async function updateLocale(nextLocale: Locale): Promise<void> {
    await updateSettings(() => ({ locale: nextLocale }))
  }

  async function updateAppearance(appearance: Appearance): Promise<void> {
    await updateSettings(() => ({ appearance }))
  }

  async function markPreferencesSetupDone(): Promise<void> {
    await updateSettings(() => ({ preferencesSetupComplete: true }))
  }

  function startProductTour(returnView: ViewId): void {
    setTourReturnView(returnView)
    setTourSettingsTab(null)
    setView('dashboard')
    setTourKind('intro')
  }

  async function finishWelcome(): Promise<void> {
    const returnView = view
    await markPreferencesSetupDone()
    startProductTour(returnView)
  }

  function closeProductTour(): void {
    const kind = tourKind
    setTourKind(null)
    setTourSettingsTab(null)
    setView(tourReturnView)
    if (kind === 'results') {
      void updateSettings(() => ({ resultsTourComplete: true }))
    }
  }

  const prepareTourStep = useCallback((step: TourStep): void => {
    if (step.view) setView(step.view)
    setTourSettingsTab(step.settingsTab ?? null)
  }, [])

  function restartProductTourFromSettings(): void {
    setSettingsSection((current) => ({
      id: 'general',
      nonce: (current?.nonce ?? 0) + 1
    }))
    startProductTour('settings')
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

  async function updateNeverTouchPaths(neverTouchPaths: string[]): Promise<void> {
    await updateSettings(() => ({ neverTouchPaths }))
  }

  async function updateDuplicateFolders(duplicateFolders: string[]): Promise<void> {
    await updateSettings(() => ({ duplicateFolders }))
  }

  const cancelCleanConfirm = useCallback(() => setConfirmCleanOpen(false), [])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const action = matchAppShortcut(event)
      if (!action) return
      if (confirmCleanOpen || tourKind) return
      if (action === 'scan') {
        event.preventDefault()
        void startScan()
        return
      }
      if (!result || result.items.length === 0) return
      event.preventDefault()
      setView('results')
      setFilterFocusNonce((current) => current + 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [confirmCleanOpen, result, startScan, tourKind])

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
        <nav className="nav" data-tour="navigation">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={
                view === item.id || (item.id === 'dashboard' && view === 'results') ? 'active' : ''
              }
              onClick={() => setView(item.id)}
              type="button"
              data-tour={item.id === 'settings' ? 'settings' : undefined}
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
        {view === 'dashboard' && (
          <DashboardView
            t={t}
            locale={locale}
            disk={disk}
            usedPct={usedPct}
            scanning={scanning}
            progress={progress}
            unusedDays={settings?.unusedDays ?? 90}
            limited={Boolean(perms && !perms.fullDiskAccess)}
            scanFailed={scanFailed}
            isPro={isPro}
            forecast={forecast}
            alert={settings?.lowDiskAlert ?? DEFAULT_LOW_DISK_ALERT}
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
            cleanFailed={cleanFailed}
            onToggle={(item, value) => {
              if (value && isLastUnselectedDuplicate(item, result.items, selected)) return
              setSelected((current) => ({ ...current, [item.id]: value }))
            }}
            onToggleCategory={(ids, value) => {
              setSelected((current) => selectionAfterCategoryToggle(result.items, ids, value, current))
            }}
            onClean={requestClean}
            onRescan={() => void startScan()}
            filterFocusNonce={filterFocusNonce}
          />
        )}
        {view === 'results' && !result && (
          <DashboardView
            t={t}
            locale={locale}
            disk={disk}
            usedPct={usedPct}
            scanning={scanning}
            progress={progress}
            unusedDays={settings?.unusedDays ?? 90}
            limited={Boolean(perms && !perms.fullDiskAccess)}
            scanFailed={scanFailed}
            isPro={isPro}
            forecast={forecast}
            alert={settings?.lowDiskAlert ?? DEFAULT_LOW_DISK_ALERT}
            onScan={() => void startScan()}
          />
        )}
        {view === 'settings' && settings && (
          <SettingsView
            t={t}
            settings={settings}
            onUnusedDays={(value) => void updateUnusedDays(value)}
            onLargeFileMinBytes={(value) => void updateLargeFileMinBytes(value)}
            onDownloadsMinDays={(value) => void updateDownloadsMinDays(value)}
            onDownloadsMinBytes={(value) => void updateDownloadsMinBytes(value)}
            onLocale={(value) => void updateLocale(value)}
            onAppearance={(value) => void updateAppearance(value)}
            onScanCategory={(id, enabled) => void updateScanCategory(id, enabled)}
            onLowDiskAlert={(patch) => void updateLowDiskAlert(patch)}
            onLaunchAtLogin={(enabled) => void updateLaunchAtLogin(enabled)}
            onScanReminder={(patch) => void updateScanReminder(patch)}
            onNeverTouchPaths={(paths) => void updateNeverTouchPaths(paths)}
            onDuplicateFolders={(paths) => void updateDuplicateFolders(paths)}
            isPro={isPro}
            onLicenseChange={(next) => {
              setIsPro(next)
              void window.diskheadroom
                .getForecastStatus()
                .then((status) => setForecast(next ? status : gatedForecastStatus()))
                .catch(() => setForecast(gatedForecastStatus()))
            }}
            perms={perms}
            grantTarget={grantTarget}
            onOpenFullDiskAccess={() => window.diskheadroom.openFullDiskAccess()}
            onRevealGrantTarget={() => void window.diskheadroom.revealGrantTarget()}
            onRecheck={refresh}
            onContinue={() => void markSetupDone()}
            focusSection={settingsSection}
            tourTab={tourKind === 'intro' ? tourSettingsTab : null}
            onStartTour={restartProductTourFromSettings}
          />
        )}
        {import.meta.env.DEV && view === 'debug' && (
          <DebugView isPro={isPro} onLicenseChange={setIsPro} />
        )}
      </main>
      {settings && !settings.preferencesSetupComplete && (
        <WelcomePreferencesDialog
          t={t}
          locale={locale}
          appearance={settings.appearance}
          onLocale={(value) => void updateLocale(value)}
          onAppearance={(value) => void updateAppearance(value)}
          onContinue={() => setWelcomeStep('howto')}
          onDone={() => void finishWelcome()}
          step={welcomeStep}
        />
      )}
      {tourKind && (
        <ProductTour
          t={t}
          steps={tourKind === 'results' ? RESULTS_TOUR_STEPS : PRODUCT_TOUR_STEPS}
          onClose={closeProductTour}
          onPrepareStep={prepareTourStep}
          layoutKey={`${view}:${tourSettingsTab ?? ''}`}
        />
      )}
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
  setupComplete: boolean
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
    <div id="settings-permissions" data-tour="settings-permissions">
      <div className="hero">
        <div>
          <h3>{props.t('permissions.title')}</h3>
          <p className="muted">{props.t('permissions.description')}</p>
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
        {!props.setupComplete && (
          <button className="btn" type="button" onClick={props.onContinue}>
            {props.t('permissions.continueLimited')}
          </button>
        )}
      </div>
    </div>
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
    <div className="card disk-panel" data-tour="disk">
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

function ForecastCard(props: {
  t: Translator
  locale: Locale
  isPro: boolean
  forecast: HeadroomForecastStatus
  alert: LowDiskAlertSettings
}): JSX.Element {
  const threshold =
    props.alert.kind === 'percent'
      ? props.t('forecast.threshold.percent', { value: props.alert.value })
      : props.t('forecast.threshold.gigabytes', { value: props.alert.value })
  const entitled = isProEntitled(props.isPro)

  return (
    <div className="card forecast-card" data-tour="forecast">
      <div className="forecast-head">
        <h3>{props.t('forecast.title')}</h3>
        <small className="pro-badge">{props.t('settings.proBadge')}</small>
      </div>
      <p className="muted">{props.t('forecast.hint')}</p>
      {!entitled && (
        <>
          <p>{props.t('forecast.cta')}</p>
          <button
            className="btn primary"
            type="button"
            onClick={() => void window.diskheadroom.openExternal(proCheckoutUrl(props.locale))}
          >
            {props.t('settings.proBuy')}
          </button>
        </>
      )}
      {entitled && props.forecast.kind === 'collecting' && (
        <p>{props.t('forecast.collecting')}</p>
      )}
      {entitled && props.forecast.kind === 'stable' && <p>{props.t('forecast.stable')}</p>}
      {entitled && props.forecast.kind === 'below' && <p>{props.t('forecast.below')}</p>}
      {entitled && props.forecast.kind === 'ready' && (
        <>
          <strong className="forecast-headline">
            {props.forecast.daysCapped
              ? props.t('forecast.daysCapped', { days: HEADROOM_DISPLAY_MAX_DAYS })
              : props.t('forecast.days', { days: props.forecast.daysUntilThreshold ?? 0 })}
          </strong>
          {props.forecast.predictedAt && (
            <p className="muted">
              {props.t('forecast.predicted', {
                date: formatDate(props.forecast.predictedAt, props.locale)
              })}
            </p>
          )}
        </>
      )}
      {entitled && props.forecast.lastScan && (
        <p className="muted">
          {props.t('forecast.lastScan', {
            size: formatBytes(props.forecast.lastScan.bytes),
            groups: props.forecast.lastScan.groups
          })}
        </p>
      )}
      <p className="muted">{props.t('forecast.thresholdHint', { threshold })}</p>
    </div>
  )
}

function DashboardView(props: {
  t: Translator
  locale: Locale
  disk: DiskInfo | null
  usedPct: number
  scanning: boolean
  progress: ScanProgress | null
  unusedDays: number
  limited: boolean
  scanFailed: boolean
  isPro: boolean
  forecast: HeadroomForecastStatus
  alert: LowDiskAlertSettings
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
      <ForecastCard
        t={props.t}
        locale={props.locale}
        isPro={props.isPro}
        forecast={props.forecast}
        alert={props.alert}
      />
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
          aria-keyshortcuts={APP_SHORTCUTS.scan.aria}
          onClick={props.onScan}
          data-tour="scan"
        >
          {props.scanning && <Spinner />}
          {props.scanning ? props.t('dashboard.scanning') : props.t('dashboard.scan')}
        </button>
        <span className="shortcut-hint">
          <kbd aria-hidden="true">{APP_SHORTCUTS.scan.chord}</kbd>
        </span>
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
  keepLocked: boolean
  tourTarget?: boolean
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
    <div className="item" data-tour={props.tourTarget ? 'results-item' : undefined}>
      <label className="item-select">
        <input
          type="checkbox"
          checked={props.checked}
          disabled={props.keepLocked}
          onChange={(event) => props.onToggle(item, event.target.checked)}
        />
        <span>
          <strong>{item.nameKey ? t(item.nameKey) : item.name}</strong>
          <div className="path">{item.path}</div>
          {(item.categoryId === 'unusedApps' ||
            item.categoryId === 'idleUserFolders' ||
            item.categoryId === 'downloadsReview' ||
            item.categoryId === 'duplicateFiles') && (
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
  filterFocusNonce: number
}): JSX.Element {
  const [query, setQuery] = useState('')
  const filterRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (props.filterFocusNonce === 0) return
    filterRef.current?.focus()
    filterRef.current?.select()
  }, [props.filterFocusNonce])
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
      <div className="hero" data-tour="results-overview">
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
      <div data-tour="results-summary">
        <DiskPanel
          t={props.t}
          disk={props.disk}
          usedPct={props.usedPct}
          foundBytes={props.foundBytes}
          selectedBytes={props.selectedBytes}
        />
      </div>
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
      {props.result.items.length > 0 && (
        <div className="results-filter" data-tour="results-filter">
          <input
            ref={filterRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={props.t('results.filterPlaceholder')}
            aria-label={props.t('results.filterPlaceholder')}
            aria-keyshortcuts={APP_SHORTCUTS.focusResultsFilter.aria}
          />
          <kbd aria-hidden="true">{APP_SHORTCUTS.focusResultsFilter.chord}</kbd>
        </div>
      )}
      {Array.from(grouped.entries()).map(([categoryId, items], categoryIndex) => {
        // Select/clear group only toggles the rows currently on screen, so a
        // filter cannot silently change hidden items in the same category.
        const ids = items.map((item) => item.id)
        const allOn = categoryExtrasSelected(items, props.selected)
        const bytes = items.reduce((sum, item) => sum + item.bytes, 0)
        const meta = CATEGORY_META[categoryId]
        const sorted = items.slice().sort((a, b) => b.bytes - a.bytes)
        return (
          <div
            className="list-card category"
            key={categoryId}
            data-tour={categoryIndex === 0 ? 'results-group' : undefined}
          >
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
            {sorted.map((item, itemIndex) => (
              <ResultItemRow
                key={item.id}
                t={props.t}
                locale={props.locale}
                item={item}
                checked={Boolean(props.selected[item.id])}
                keepLocked={isLastUnselectedDuplicate(item, props.result.items, props.selected)}
                tourTarget={categoryIndex === 0 && itemIndex === 0}
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
      <div className="footer-bar" data-tour="results-actions">
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

function UpdateSettingsCard(props: { t: Translator }): JSX.Element {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null)

  useEffect(() => {
    void window.diskheadroom.getUpdateStatus().then(setStatus)
    return window.diskheadroom.onUpdateChanged(setStatus)
  }, [])

  async function run(action: () => Promise<AppUpdateStatus>): Promise<void> {
    setStatus(await action())
  }

  return (
    <div className="card" data-tour="settings-updates">
      <h3>{props.t('settings.updateTitle')}</h3>
      <p className="muted">{props.t('settings.updateHint')}</p>
      {status && (
        <>
          <p className="muted">{props.t('settings.updateVersion', { version: status.currentVersion })}</p>
          {status.phase === 'packaged-only' && (
            <p className="muted">{props.t('settings.updatePackagedOnly')}</p>
          )}
          {status.phase === 'not-available' && <p>{props.t('settings.updateUpToDate')}</p>}
          {status.phase === 'available' && status.availableVersion && (
            <p>{props.t('settings.updateAvailable', { version: status.availableVersion })}</p>
          )}
          {status.phase === 'downloading' && (
            <p>
              {props.t('settings.updateDownloading', {
                percent: status.percent ?? 0
              })}
            </p>
          )}
          {status.phase === 'ready' && status.availableVersion && (
            <p>{props.t('settings.updateReady', { version: status.availableVersion })}</p>
          )}
          {status.phase === 'error' && (
            <p className="notice">
              {status.offline ? props.t('settings.updateOffline') : props.t('settings.updateError')}
            </p>
          )}
          <div className="row">
            {(status.phase === 'idle' ||
              status.phase === 'not-available' ||
              status.phase === 'error') && (
              <button
                className="btn"
                type="button"
                onClick={() => void run(() => window.diskheadroom.checkForUpdates())}
              >
                {props.t('settings.updateCheck')}
              </button>
            )}
            {status.phase === 'checking' && (
              <button className="btn busy" type="button" disabled>
                <Spinner />
                {props.t('settings.updateChecking')}
              </button>
            )}
            {status.phase === 'available' && (
              <button
                className="btn"
                type="button"
                onClick={() => void run(() => window.diskheadroom.downloadUpdate())}
              >
                {props.t('settings.updateDownload')}
              </button>
            )}
            {status.phase === 'ready' && (
              <button
                className="btn"
                type="button"
                onClick={() => void window.diskheadroom.installUpdate()}
              >
                {props.t('settings.updateInstall')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SettingsView(props: {
  t: Translator
  settings: AppSettings
  onUnusedDays: (value: UnusedDays) => void
  onLargeFileMinBytes: (value: LargeFileMinBytes) => void
  onDownloadsMinDays: (value: DownloadsMinDays) => void
  onDownloadsMinBytes: (value: DownloadsMinBytes) => void
  onLocale: (value: Locale) => void
  onAppearance: (value: Appearance) => void
  onScanCategory: (id: ScanCategoryFlag, enabled: boolean) => void
  onLowDiskAlert: (patch: Partial<LowDiskAlertSettings>) => void
  onLaunchAtLogin: (enabled: boolean) => void
  onScanReminder: (patch: Partial<ScanReminderSettings>) => void
  onNeverTouchPaths: (paths: string[]) => void
  onDuplicateFolders: (paths: string[]) => void
  isPro: boolean
  onLicenseChange: (isPro: boolean) => void
  perms: PermissionStatus | null
  grantTarget: GrantTarget | null
  onOpenFullDiskAccess: () => Promise<void>
  onRevealGrantTarget: () => void
  onRecheck: () => Promise<void>
  onContinue: () => void
  focusSection: { id: SettingsSection; nonce: number } | null
  tourTab?: SettingsTab | null
  onStartTour: () => void
}): JSX.Element {
  const alert = props.settings.lowDiskAlert
  const reminder = props.settings.scanReminder
  const [neverTouchDraft, setNeverTouchDraft] = useState('')
  const [licenseDraft, setLicenseDraft] = useState('')
  const [licenseInvalid, setLicenseInvalid] = useState(false)
  const [activating, setActivating] = useState(false)
  const [tab, setTab] = useState<SettingsTab>(
    props.settings.setupComplete ? 'pro' : 'permissions'
  )
  const activeTab = props.tourTab ?? tab
  const presets = LOW_DISK_ALERT_PRESETS.some(
    (preset) => preset.kind === alert.kind && preset.value === alert.value
  )
    ? LOW_DISK_ALERT_PRESETS
    : [{ kind: alert.kind, value: alert.value }, ...LOW_DISK_ALERT_PRESETS]

  function addNeverTouchPath(raw: string): void {
    const trimmed = raw.trim()
    if (!trimmed) return
    const merged = Array.from(new Set([...props.settings.neverTouchPaths, trimmed]))
    props.onNeverTouchPaths(merged)
    setNeverTouchDraft('')
  }

  async function activateLicense(): Promise<void> {
    const key = licenseDraft.trim()
    if (!key || activating) return
    setActivating(true)
    setLicenseInvalid(false)
    try {
      const status = await window.diskheadroom.activateLicense(key)
      const entitled = isProEntitled(status.isPro)
      props.onLicenseChange(entitled)
      setLicenseInvalid(!entitled)
      if (entitled) setLicenseDraft('')
    } finally {
      setActivating(false)
    }
  }

  useEffect(() => {
    if (!props.focusSection) return
    setTab(tabForSection(props.focusSection.id))
  }, [props.focusSection])

  const permissions = (
    <PermissionsView
      t={props.t}
      perms={props.perms}
      grantTarget={props.grantTarget}
      setupComplete={props.settings.setupComplete}
      onOpenSettings={props.onOpenFullDiskAccess}
      onReveal={props.onRevealGrantTarget}
      onRecheck={props.onRecheck}
      onContinue={props.onContinue}
    />
  )

  return (
    <section>
      <div className="hero">
        <div>
          <h2>{props.t('settings.title')}</h2>
          <p>{props.t('settings.description')}</p>
        </div>
      </div>
      <div
        className="settings-tabs"
        role="tablist"
        aria-label={props.t('settings.title')}
        data-tour="settings-tabs"
      >
        {SETTINGS_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`settings-tab-${item.id}`}
            aria-controls={`settings-panel-${item.id}`}
            aria-selected={activeTab === item.id}
            onClick={() => setTab(item.id)}
          >
            {props.t(item.label)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="settings-panel-scan"
        aria-labelledby="settings-tab-scan"
        hidden={activeTab !== 'scan'}
      >
      <div className="card" data-tour="settings-scan-categories">
        <h3>{props.t('settings.scanTitle')}</h3>
        <p className="muted">{props.t('settings.scanHint')}</p>
        <div className="scan-flags">
          {SCAN_CATEGORY_IDS.map((id) => (
            <label key={id} className="scan-flag">
              <input
                type="checkbox"
                checked={props.settings.scanCategories[id] && (!isProScanCategory(id) || props.isPro)}
                disabled={isProScanCategory(id) && !props.isPro}
                onChange={(event) => props.onScanCategory(id, event.target.checked)}
              />
              <span>{props.t(SCAN_CATEGORY_LABELS[id])}</span>
              {isProScanCategory(id) && !props.isPro && (
                <small className="pro-badge">{props.t('settings.proBadge')}</small>
              )}
            </label>
          ))}
        </div>
      </div>
      <div className="card" data-tour="settings-large-files">
        <h3>{props.t('settings.largeFilesTitle')}</h3>
        <p className="muted">{props.t('settings.largeFilesHint')}</p>
        <select
          value={props.settings.largeFileMinBytes}
          disabled={!props.isPro}
          onChange={(event) => props.onLargeFileMinBytes(Number(event.target.value) as LargeFileMinBytes)}
        >
          {LARGE_FILE_MIN_BYTES_OPTIONS.map((bytes) => (
            <option key={bytes} value={bytes}>
              {formatBytes(bytes)}
            </option>
          ))}
        </select>
        {!props.isPro && (
          <button
            className="btn primary"
            type="button"
            onClick={() =>
              void window.diskheadroom.openExternal(proCheckoutUrl(props.settings.locale))
            }
          >
            {props.t('settings.largeFilesProCta')}
          </button>
        )}
      </div>
      <div className="card" data-tour="settings-downloads">
        <h3>{props.t('settings.downloadsTitle')}</h3>
        <p className="muted">{props.t('settings.downloadsHint')}</p>
        <label className="field-label" htmlFor="downloads-min-age">
          {props.t('settings.downloadsMinAge')}
        </label>
        <select
          id="downloads-min-age"
          value={props.settings.downloadsMinDays}
          disabled={!props.isPro}
          onChange={(event) =>
            props.onDownloadsMinDays(Number(event.target.value) as DownloadsMinDays)
          }
        >
          {DOWNLOADS_MIN_DAYS_OPTIONS.map((days) => (
            <option key={days} value={days}>
              {days === 0 ? props.t('settings.downloadsAgeAny') : props.t('settings.days', { days })}
            </option>
          ))}
        </select>
        <label className="field-label" htmlFor="downloads-min-size">
          {props.t('settings.downloadsMinSize')}
        </label>
        <select
          id="downloads-min-size"
          value={props.settings.downloadsMinBytes}
          disabled={!props.isPro}
          onChange={(event) =>
            props.onDownloadsMinBytes(Number(event.target.value) as DownloadsMinBytes)
          }
        >
          {DOWNLOADS_MIN_BYTES_OPTIONS.map((bytes) => (
            <option key={bytes} value={bytes}>
              {bytes === 0 ? props.t('settings.downloadsSizeAny') : formatBytes(bytes)}
            </option>
          ))}
        </select>
        {!props.isPro && (
          <button
            className="btn primary"
            type="button"
            onClick={() =>
              void window.diskheadroom.openExternal(proCheckoutUrl(props.settings.locale))
            }
          >
            {props.t('settings.largeFilesProCta')}
          </button>
        )}
      </div>
      <div className="card" data-tour="settings-duplicates">
        <h3>{props.t('settings.duplicateFoldersTitle')}</h3>
        <p className="muted">{props.t('settings.duplicateFoldersHint')}</p>
        <div className="row">
          <button
            className="btn"
            type="button"
            disabled={!props.isPro}
            onClick={() => {
              void window.diskheadroom.pickFolders().then((picked) => {
                if (!picked.length) return
                const merged = Array.from(new Set([...props.settings.duplicateFolders, ...picked]))
                props.onDuplicateFolders(merged)
              })
            }}
          >
            {props.t('settings.duplicateFoldersChoose')}
          </button>
        </div>
        {!props.isPro && (
          <button
            className="btn primary"
            type="button"
            onClick={() =>
              void window.diskheadroom.openExternal(proCheckoutUrl(props.settings.locale))
            }
          >
            {props.t('settings.largeFilesProCta')}
          </button>
        )}
        {props.settings.duplicateFolders.length === 0 ? (
          <p className="muted">{props.t('settings.duplicateFoldersEmpty')}</p>
        ) : (
          <ul className="never-touch-list">
            {props.settings.duplicateFolders.map((path) => (
              <li key={path}>
                <code className="path">{path}</code>
                <div className="row">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void window.diskheadroom.revealItem(path)}
                  >
                    {props.t('settings.duplicateFoldersReveal')}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() =>
                      props.onDuplicateFolders(
                        props.settings.duplicateFolders.filter((item) => item !== path)
                      )
                    }
                  >
                    {props.t('settings.duplicateFoldersRemove')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card" data-tour="settings-never-touch">
        <h3>{props.t('settings.neverTouchTitle')}</h3>
        <p className="muted">{props.t('settings.neverTouchHint')}</p>
        <form
          className="never-touch-add"
          onSubmit={(event) => {
            event.preventDefault()
            addNeverTouchPath(neverTouchDraft)
          }}
        >
          <label className="field-label" htmlFor="never-touch-path">
            {props.t('settings.neverTouchPaste')}
          </label>
          <input
            id="never-touch-path"
            type="text"
            value={neverTouchDraft}
            onChange={(event) => setNeverTouchDraft(event.target.value)}
            placeholder={props.t('settings.neverTouchPlaceholder')}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="row">
            <button className="btn" type="submit">
              {props.t('settings.neverTouchAdd')}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                void window.diskheadroom.pickFolder().then((picked) => {
                  if (picked) addNeverTouchPath(picked)
                })
              }}
            >
              {props.t('settings.neverTouchChoose')}
            </button>
          </div>
        </form>
        {props.settings.neverTouchPaths.length === 0 ? (
          <p className="muted">{props.t('settings.neverTouchEmpty')}</p>
        ) : (
          <ul className="never-touch-list">
            {props.settings.neverTouchPaths.map((path) => (
              <li key={path}>
                <code className="path">{path}</code>
                <div className="row">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void window.diskheadroom.revealItem(path)}
                  >
                    {props.t('settings.neverTouchReveal')}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() =>
                      props.onNeverTouchPaths(
                        props.settings.neverTouchPaths.filter((item) => item !== path)
                      )
                    }
                  >
                    {props.t('settings.neverTouchRemove')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card" data-tour="settings-idle">
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
      </div>
      <div
        role="tabpanel"
        id="settings-panel-permissions"
        aria-labelledby="settings-tab-permissions"
        hidden={activeTab !== 'permissions'}
      >
        {permissions}
      </div>
      <div
        role="tabpanel"
        id="settings-panel-pro"
        aria-labelledby="settings-tab-pro"
        hidden={activeTab !== 'pro'}
      >
      <div className="card">
        <div data-tour="settings-pro">
        <h3>{props.t('settings.proTitle')}</h3>
        <p className="muted">{props.t('settings.proHint')}</p>
        <p className={props.isPro ? 'pro-status on' : 'pro-status'}>
          {props.t(props.isPro ? 'settings.proStatusOn' : 'settings.proStatusOff')}
        </p>
        <form
          className="license-add"
          onSubmit={(event) => {
            event.preventDefault()
            void activateLicense()
          }}
        >
          <label className="field-label" htmlFor="license-key">
            {props.t('settings.proKeyLabel')}
          </label>
          <input
            id="license-key"
            type="text"
            value={licenseDraft}
            onChange={(event) => {
              setLicenseDraft(event.target.value)
              setLicenseInvalid(false)
            }}
            placeholder={props.t('settings.proKeyPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={licenseInvalid}
          />
          {licenseInvalid && <p className="notice">{props.t('settings.proInvalid')}</p>}
          <div className="row">
            <button className="btn" type="submit" disabled={activating || !licenseDraft.trim()}>
              {activating && <Spinner />}
              {activating ? props.t('settings.proActivating') : props.t('settings.proActivate')}
            </button>
            <button
              className="btn primary"
              type="button"
              onClick={() =>
                void window.diskheadroom.openExternal(proCheckoutUrl(props.settings.locale))
              }
            >
              {props.t('settings.proBuy')}
            </button>
          </div>
        </form>
        </div>
        <div className="support-actions" data-tour="settings-donate">
          <p className="muted">{props.t('donate.description')}</p>
          <p className="muted">{props.t('donate.body')}</p>
          <button
            className="btn"
            type="button"
            onClick={() => void window.diskheadroom.openExternal(SPONSORS_URL)}
          >
            {props.t('donate.button')}
          </button>
          <p className="muted">
            {props.t('donate.source')}{' '}
            <button
              className="btn"
              type="button"
              onClick={() => void window.diskheadroom.openExternal(REPO_URL)}
            >
              github.com/nettonucci/diskheadroom
            </button>
          </p>
        </div>
      </div>
      </div>
      <div
        role="tabpanel"
        id="settings-panel-general"
        aria-labelledby="settings-tab-general"
        hidden={activeTab !== 'general'}
      >
      <div className="card" data-tour="settings-launch-at-login">
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
      <div className="card" data-tour="settings-scan-reminder">
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
      <div className="card" data-tour="settings-low-disk">
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
      <div className="card" data-tour="settings-appearance">
        <h3>{props.t('settings.appearanceTitle')}</h3>
        <p className="muted">{props.t('settings.appearanceHint')}</p>
        <select
          aria-label={props.t('settings.appearanceTitle')}
          value={props.settings.appearance}
          onChange={(event) => props.onAppearance(event.target.value as Appearance)}
        >
          {APPEARANCE_OPTIONS.map((appearance) => (
            <option key={appearance} value={appearance}>
              {props.t(`settings.appearance.${appearance}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="card" data-tour="settings-shortcuts">
        <h3>{props.t('settings.shortcutsTitle')}</h3>
        <p className="muted">{props.t('settings.shortcutsHint')}</p>
        <dl className="shortcut-list">
          <div>
            <dt>
              <kbd>{APP_SHORTCUTS.scan.chord}</kbd>
            </dt>
            <dd>{props.t('settings.shortcuts.scan')}</dd>
          </div>
          <div>
            <dt>
              <kbd>{APP_SHORTCUTS.focusResultsFilter.chord}</kbd>
            </dt>
            <dd>{props.t('settings.shortcuts.filter')}</dd>
          </div>
        </dl>
      </div>
      <div className="card" data-tour="settings-replay">
        <h3>{props.t('settings.tourTitle')}</h3>
        <p className="muted">{props.t('settings.tourHint')}</p>
        <button className="btn" type="button" onClick={props.onStartTour}>
          {props.t('settings.tourStart')}
        </button>
      </div>
      <div className="card" data-tour="settings-language">
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
      </div>
      <div
        role="tabpanel"
        id="settings-panel-updates"
        aria-labelledby="settings-tab-updates"
        hidden={activeTab !== 'updates'}
      >
        <UpdateSettingsCard t={props.t} />
      </div>
    </section>
  )
}

const SIMULATION_OPTIONS = [0, 2, 5, 8, 12, 20, 40] as const

// Development-only harness for the low disk alert: pin free space, run the real
// check, and inspect the cooldown without waiting for the disk to fill up.
// Copy stays in English and out of languages.json because it never ships.
function DebugView(props: {
  isPro: boolean
  onLicenseChange: (isPro: boolean) => void
}): JSX.Element {
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
      <div className="card">
        <h3>Pro license</h3>
        <dl className="debug-grid">
          <dt>Entitlement</dt>
          <dd>{props.isPro ? 'Pro active' : 'free'}</dd>
        </dl>
        <p className="muted">
          Removes the stored key so gated finders fall back to the free state. Paste a signed key
          under Settings to activate Pro again.
        </p>
        <div className="debug-actions">
          <button
            className="btn"
            type="button"
            disabled={busy || !props.isPro}
            onClick={() => {
              setBusy(true)
              void debug
                .deactivateLicense()
                .then((status) => {
                  props.onLicenseChange(isProEntitled(status.isPro))
                  setNote(`Pro license removed at ${new Date().toLocaleTimeString()}`)
                })
                .finally(() => setBusy(false))
            }}
          >
            Remove Pro license
          </button>
        </div>
      </div>
    </section>
  )
}
