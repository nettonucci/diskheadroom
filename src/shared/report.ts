import { formatBytes, formatDate } from './format'
import { resolveLocale, translator, type Locale, type TranslationKey } from './i18n'
import type {
  CleanReportOptions,
  DiskInfo,
  ScanCategoryId,
  ScanItem
} from './types'

export const CATEGORY_TITLE_KEYS: Record<ScanCategoryId, TranslationKey> = {
  userCaches: 'category.userCaches.title',
  userLogs: 'category.userLogs.title',
  homebrewCache: 'category.homebrewCache.title',
  packageManagerCaches: 'category.packageManagerCaches.title',
  trash: 'category.trash.title',
  xcodeDerivedData: 'category.xcodeDerivedData.title',
  iosDeviceSupport: 'category.iosDeviceSupport.title',
  xcodeArchives: 'category.xcodeArchives.title',
  unavailableSimulators: 'category.unavailableSimulators.title',
  outdatedSimulators: 'category.outdatedSimulators.title',
  coreSimulatorCaches: 'category.coreSimulatorCaches.title',
  dockerDesktop: 'category.dockerDesktop.title',
  androidDevCaches: 'category.androidDevCaches.title',
  idleUserFolders: 'category.idleUserFolders.title',
  unusedApps: 'category.unusedApps.title'
}

export interface CategoryReportSummary {
  categoryId: ScanCategoryId
  categoryTitleKey: TranslationKey
  categoryName: string
  foundCount: number
  foundBytes: number
  trashedCount: number
  trashedBytes: number
  skippedCount: number
  skippedBytes: number
  status: 'cleaned' | 'partial' | 'skipped'
}

export interface ReportSummary {
  scannedAt: string
  generatedAt: string
  locale: Locale
  categories: CategoryReportSummary[]
  totalFoundItems: number
  totalFoundBytes: number
  totalTrashedItems: number
  totalTrashedBytes: number
  totalSkippedItems: number
  totalSkippedBytes: number
  totalFailedItems: number
  trashedItems: ScanItem[]
  skippedItems: ScanItem[]
  failedItems: { path: string; error: string }[]
  disk: DiskInfo | null
}

function escapeMarkdownCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** Computes structured aggregate metrics and lists from scan and clean outcomes. */
export function computeReportSummary(options: CleanReportOptions): ReportSummary {
  const { scanResult, cleanResult, disk } = options
  const locale = resolveLocale(options.locale ?? options.options?.locale)
  const t = translator(locale)
  const trashedSet = new Set(cleanResult?.trashed ?? [])
  const failedList = cleanResult?.failed ?? []
  const generatedAt = options.generatedAt ?? new Date().toISOString()

  const grouped = new Map<ScanCategoryId, ScanItem[]>()
  for (const item of scanResult.items) {
    const list = grouped.get(item.categoryId) ?? []
    list.push(item)
    grouped.set(item.categoryId, list)
  }

  const trashedItems: ScanItem[] = []
  const skippedItems: ScanItem[] = []
  const categories: CategoryReportSummary[] = []

  let totalFoundBytes = 0
  let totalTrashedBytes = 0

  for (const [categoryId, items] of grouped.entries()) {
    let catFoundBytes = 0
    let catTrashedBytes = 0
    let catTrashedCount = 0

    for (const item of items) {
      catFoundBytes += item.bytes
      if (trashedSet.has(item.path)) {
        catTrashedCount += 1
        catTrashedBytes += item.bytes
        trashedItems.push(item)
      } else {
        skippedItems.push(item)
      }
    }

    totalFoundBytes += catFoundBytes
    totalTrashedBytes += catTrashedBytes

    const catSkippedCount = items.length - catTrashedCount
    const catSkippedBytes = catFoundBytes - catTrashedBytes

    let status: 'cleaned' | 'partial' | 'skipped' = 'skipped'
    if (catTrashedCount > 0 && catTrashedCount === items.length) {
      status = 'cleaned'
    } else if (catTrashedCount > 0) {
      status = 'partial'
    }

    const titleKey = CATEGORY_TITLE_KEYS[categoryId] ?? 'progress.starting'
    categories.push({
      categoryId,
      categoryTitleKey: titleKey,
      categoryName: t(titleKey),
      foundCount: items.length,
      foundBytes: catFoundBytes,
      trashedCount: catTrashedCount,
      trashedBytes: catTrashedBytes,
      skippedCount: catSkippedCount,
      skippedBytes: catSkippedBytes,
      status
    })
  }

  trashedItems.sort((a, b) => b.bytes - a.bytes)
  skippedItems.sort((a, b) => b.bytes - a.bytes)

  return {
    scannedAt: scanResult.scannedAt,
    generatedAt,
    locale,
    categories,
    totalFoundItems: scanResult.items.length,
    totalFoundBytes,
    totalTrashedItems: trashedItems.length,
    totalTrashedBytes,
    totalSkippedItems: skippedItems.length,
    totalSkippedBytes: totalFoundBytes - totalTrashedBytes,
    totalFailedItems: failedList.length,
    trashedItems,
    skippedItems,
    failedItems: failedList,
    disk: disk ?? null
  }
}

/** Generates a localized GitHub Flavored Markdown cleaning summary report. */
export function generateMarkdownReport(options: CleanReportOptions): string {
  const summary = computeReportSummary(options)
  const t = translator(summary.locale)
  const lines: string[] = []

  lines.push(`# ${t('report.title')}`)
  lines.push('')
  lines.push(`- **${t('report.scannedAt', { date: formatDate(summary.scannedAt, summary.locale, true) })}**`)
  lines.push(`- **${t('report.generatedAt', { date: formatDate(summary.generatedAt, summary.locale, true) })}**`)
  lines.push('')

  if (summary.disk) {
    lines.push(`## ${t('report.diskSummary')}`)
    lines.push('')
    lines.push(`| ${t('report.colMetric')} | ${t('report.colValue')} |`)
    lines.push('|---|---|')
    lines.push(`| ${t('report.totalCapacity')} | ${formatBytes(summary.disk.totalBytes)} |`)
    lines.push(`| ${t('report.freeBefore')} | ${formatBytes(summary.disk.freeBytes)} |`)
    lines.push(`| ${t('report.spaceRecovered')} | ${formatBytes(summary.totalTrashedBytes)} |`)
    lines.push(`| ${t('report.freeAfter')} | ${formatBytes(summary.disk.freeBytes + summary.totalTrashedBytes)} |`)
    lines.push('')
  }

  lines.push(`## ${t('report.overview')}`)
  lines.push('')
  lines.push(`| ${t('report.colMetric')} | ${t('report.colValue')} |`)
  lines.push('|---|---|')
  lines.push(`| ${t('report.itemsFound')} | ${summary.totalFoundItems} (${formatBytes(summary.totalFoundBytes)}) |`)
  lines.push(`| ${t('report.itemsTrashed')} | ${summary.totalTrashedItems} (${formatBytes(summary.totalTrashedBytes)}) |`)
  lines.push(`| ${t('report.itemsSkipped')} | ${summary.totalSkippedItems} (${formatBytes(summary.totalSkippedBytes)}) |`)
  if (summary.totalFailedItems > 0) {
    lines.push(`| ${t('report.itemsFailed')} | ${summary.totalFailedItems} |`)
  }
  lines.push('')

  lines.push(`## ${t('report.categoryBreakdown')}`)
  lines.push('')
  lines.push(`| ${t('report.colCategory')} | ${t('report.colFound')} | ${t('report.colSize')} | ${t('report.colTrashed')} | ${t('report.colRecovered')} | ${t('report.colSkipped')} | ${t('report.colStatus')} |`)
  lines.push('|---|---:|---:|---:|---:|---:|---|')

  for (const cat of summary.categories) {
    const statusLabel =
      cat.status === 'cleaned'
        ? t('report.statusCleaned')
        : cat.status === 'partial'
          ? t('report.statusPartial')
          : t('report.statusSkipped')

    lines.push(
      `| ${escapeMarkdownCell(cat.categoryName)} | ${cat.foundCount} | ${formatBytes(cat.foundBytes)} | ${cat.trashedCount} | ${formatBytes(cat.trashedBytes)} | ${cat.skippedCount} | ${statusLabel} |`
    )
  }
  lines.push('')

  if (summary.trashedItems.length > 0) {
    lines.push(`## ${t('report.trashedDetails')}`)
    lines.push('')
    lines.push(`| ${t('report.colItem')} | ${t('report.colCategory')} | ${t('report.colSize')} | ${t('report.colPath')} |`)
    lines.push('|---|---|---:|---|')
    for (const item of summary.trashedItems) {
      const catName = t(CATEGORY_TITLE_KEYS[item.categoryId] ?? 'progress.starting')
      const itemName = item.nameKey ? t(item.nameKey) : item.name
      lines.push(
        `| ${escapeMarkdownCell(itemName)} | ${escapeMarkdownCell(catName)} | ${formatBytes(item.bytes)} | \`${escapeMarkdownCell(item.path)}\` |`
      )
    }
    lines.push('')
  }

  if (summary.skippedItems.length > 0) {
    lines.push(`## ${t('report.skippedDetails')}`)
    lines.push('')
    lines.push(`| ${t('report.colItem')} | ${t('report.colCategory')} | ${t('report.colSize')} | ${t('report.colPath')} |`)
    lines.push('|---|---|---:|---|')
    for (const item of summary.skippedItems) {
      const catName = t(CATEGORY_TITLE_KEYS[item.categoryId] ?? 'progress.starting')
      const itemName = item.nameKey ? t(item.nameKey) : item.name
      lines.push(
        `| ${escapeMarkdownCell(itemName)} | ${escapeMarkdownCell(catName)} | ${formatBytes(item.bytes)} | \`${escapeMarkdownCell(item.path)}\` |`
      )
    }
    lines.push('')
  }

  if (summary.failedItems.length > 0) {
    lines.push(`## ${t('report.failedDetails')}`)
    lines.push('')
    lines.push(`| ${t('report.colPath')} | ${t('report.colError')} |`)
    lines.push('|---|---|')
    for (const failed of summary.failedItems) {
      lines.push(`| \`${escapeMarkdownCell(failed.path)}\` | ${escapeMarkdownCell(failed.error)} |`)
    }
    lines.push('')
  }

  lines.push(`> ${t('report.footerNote')}`)
  lines.push('')

  return lines.join('\n')
}

/** Generates a self-contained, print-ready HTML clean report for PDF rendering. */
export function generateHtmlReport(options: CleanReportOptions): string {
  const summary = computeReportSummary(options)
  const t = translator(summary.locale)

  const categoryRows = summary.categories
    .map((cat) => {
      const statusLabel =
        cat.status === 'cleaned'
          ? t('report.statusCleaned')
          : cat.status === 'partial'
            ? t('report.statusPartial')
            : t('report.statusSkipped')
      const statusClass = cat.status
      return `<tr>
        <td><strong>${escapeHtml(cat.categoryName)}</strong></td>
        <td class="num">${cat.foundCount}</td>
        <td class="num">${escapeHtml(formatBytes(cat.foundBytes))}</td>
        <td class="num">${cat.trashedCount}</td>
        <td class="num">${escapeHtml(formatBytes(cat.trashedBytes))}</td>
        <td class="num">${cat.skippedCount}</td>
        <td><span class="badge badge-${statusClass}">${escapeHtml(statusLabel)}</span></td>
      </tr>`
    })
    .join('')

  const trashedRows = summary.trashedItems
    .map((item) => {
      const catName = t(CATEGORY_TITLE_KEYS[item.categoryId] ?? 'progress.starting')
      const itemName = item.nameKey ? t(item.nameKey) : item.name
      return `<tr>
        <td><strong>${escapeHtml(itemName)}</strong></td>
        <td>${escapeHtml(catName)}</td>
        <td class="num">${escapeHtml(formatBytes(item.bytes))}</td>
        <td class="path"><code>${escapeHtml(item.path)}</code></td>
      </tr>`
    })
    .join('')

  const skippedRows = summary.skippedItems
    .map((item) => {
      const catName = t(CATEGORY_TITLE_KEYS[item.categoryId] ?? 'progress.starting')
      const itemName = item.nameKey ? t(item.nameKey) : item.name
      return `<tr>
        <td><strong>${escapeHtml(itemName)}</strong></td>
        <td>${escapeHtml(catName)}</td>
        <td class="num">${escapeHtml(formatBytes(item.bytes))}</td>
        <td class="path"><code>${escapeHtml(item.path)}</code></td>
      </tr>`
    })
    .join('')

  const failedRows = summary.failedItems
    .map((item) => {
      return `<tr>
        <td class="path"><code>${escapeHtml(item.path)}</code></td>
        <td class="danger">${escapeHtml(item.error)}</td>
      </tr>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="${summary.locale}">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(t('report.title'))}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 32px;
      color: #1a1a1a;
      background: #ffffff;
      line-height: 1.5;
    }
    h1 { margin-top: 0; font-size: 24px; color: #111; border-bottom: 2px solid #e5e5e5; padding-bottom: 8px; }
    h2 { font-size: 18px; margin-top: 28px; margin-bottom: 12px; color: #222; }
    .meta { color: #666; font-size: 14px; margin-bottom: 24px; }
    .meta span { display: block; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f5f5f7; font-weight: 600; color: #333; }
    td.num, th.num { text-align: right; }
    td.path code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; word-break: break-all; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .badge-cleaned { background: #d4edda; color: #155724; }
    .badge-partial { background: #fff3cd; color: #856404; }
    .badge-skipped { background: #e2e3e5; color: #383d41; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #777; font-style: italic; }
    .danger { color: #721c24; }
    @media print {
      body { padding: 0; font-size: 12px; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
      thead { display: table-header-group; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(t('report.title'))}</h1>
  <div class="meta">
    <span><strong>${escapeHtml(t('report.scannedAt', { date: formatDate(summary.scannedAt, summary.locale, true) }))}</strong></span>
    <span><strong>${escapeHtml(t('report.generatedAt', { date: formatDate(summary.generatedAt, summary.locale, true) }))}</strong></span>
  </div>

  ${
    summary.disk
      ? `<h2>${escapeHtml(t('report.diskSummary'))}</h2>
  <table>
    <thead>
      <tr><th>${escapeHtml(t('report.colMetric'))}</th><th>${escapeHtml(t('report.colValue'))}</th></tr>
    </thead>
    <tbody>
      <tr><td>${escapeHtml(t('report.totalCapacity'))}</td><td>${escapeHtml(formatBytes(summary.disk.totalBytes))}</td></tr>
      <tr><td>${escapeHtml(t('report.freeBefore'))}</td><td>${escapeHtml(formatBytes(summary.disk.freeBytes))}</td></tr>
      <tr><td>${escapeHtml(t('report.spaceRecovered'))}</td><td>${escapeHtml(formatBytes(summary.totalTrashedBytes))}</td></tr>
      <tr><td>${escapeHtml(t('report.freeAfter'))}</td><td>${escapeHtml(formatBytes(summary.disk.freeBytes + summary.totalTrashedBytes))}</td></tr>
    </tbody>
  </table>`
      : ''
  }

  <h2>${escapeHtml(t('report.overview'))}</h2>
  <table>
    <thead>
      <tr><th>${escapeHtml(t('report.colMetric'))}</th><th>${escapeHtml(t('report.colValue'))}</th></tr>
    </thead>
    <tbody>
      <tr><td>${escapeHtml(t('report.itemsFound'))}</td><td>${summary.totalFoundItems} (${escapeHtml(formatBytes(summary.totalFoundBytes))})</td></tr>
      <tr><td>${escapeHtml(t('report.itemsTrashed'))}</td><td>${summary.totalTrashedItems} (${escapeHtml(formatBytes(summary.totalTrashedBytes))})</td></tr>
      <tr><td>${escapeHtml(t('report.itemsSkipped'))}</td><td>${summary.totalSkippedItems} (${escapeHtml(formatBytes(summary.totalSkippedBytes))})</td></tr>
      ${summary.totalFailedItems > 0 ? `<tr><td>${escapeHtml(t('report.itemsFailed'))}</td><td>${summary.totalFailedItems}</td></tr>` : ''}
    </tbody>
  </table>

  <h2>${escapeHtml(t('report.categoryBreakdown'))}</h2>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(t('report.colCategory'))}</th>
        <th class="num">${escapeHtml(t('report.colFound'))}</th>
        <th class="num">${escapeHtml(t('report.colSize'))}</th>
        <th class="num">${escapeHtml(t('report.colTrashed'))}</th>
        <th class="num">${escapeHtml(t('report.colRecovered'))}</th>
        <th class="num">${escapeHtml(t('report.colSkipped'))}</th>
        <th>${escapeHtml(t('report.colStatus'))}</th>
      </tr>
    </thead>
    <tbody>
      ${categoryRows}
    </tbody>
  </table>

  ${
    summary.trashedItems.length > 0
      ? `<h2>${escapeHtml(t('report.trashedDetails'))}</h2>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(t('report.colItem'))}</th>
        <th>${escapeHtml(t('report.colCategory'))}</th>
        <th class="num">${escapeHtml(t('report.colSize'))}</th>
        <th>${escapeHtml(t('report.colPath'))}</th>
      </tr>
    </thead>
    <tbody>
      ${trashedRows}
    </tbody>
  </table>`
      : ''
  }

  ${
    summary.skippedItems.length > 0
      ? `<h2>${escapeHtml(t('report.skippedDetails'))}</h2>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(t('report.colItem'))}</th>
        <th>${escapeHtml(t('report.colCategory'))}</th>
        <th class="num">${escapeHtml(t('report.colSize'))}</th>
        <th>${escapeHtml(t('report.colPath'))}</th>
      </tr>
    </thead>
    <tbody>
      ${skippedRows}
    </tbody>
  </table>`
      : ''
  }

  ${
    summary.failedItems.length > 0
      ? `<h2>${escapeHtml(t('report.failedDetails'))}</h2>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(t('report.colPath'))}</th>
        <th>${escapeHtml(t('report.colError'))}</th>
      </tr>
    </thead>
    <tbody>
      ${failedRows}
    </tbody>
  </table>`
      : ''
  }

  <div class="footer">
    <p>${escapeHtml(t('report.footerNote'))}</p>
  </div>
</body>
</html>`
}
