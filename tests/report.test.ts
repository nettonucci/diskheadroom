import { describe, expect, it } from 'vitest'
import { computeReportSummary, generateHtmlReport, generateMarkdownReport } from '../src/shared/report'
import type { CleanResult, DiskInfo, ScanResult } from '../src/shared/types'

const sampleDisk: DiskInfo = {
  mount: '/',
  totalBytes: 500 * 1024 * 1024 * 1024, // 500 GB
  usedBytes: 350 * 1024 * 1024 * 1024, // 350 GB
  freeBytes: 150 * 1024 * 1024 * 1024  // 150 GB
}

const sampleScanResult: ScanResult = {
  scannedAt: '2025-02-15T14:30:00.000Z',
  limited: false,
  items: [
    {
      id: 'cache-1',
      categoryId: 'userCaches',
      name: 'Google Chrome Cache',
      path: '/Users/developer/Library/Caches/Google/Chrome',
      bytes: 1024 * 1024 * 500, // 500 MB
      selectedByDefault: true,
      optional: false,
      lastUsedAt: null,
      daysIdle: null
    },
    {
      id: 'log-1',
      categoryId: 'userLogs',
      name: 'Diagnostic Reports',
      path: '/Users/developer/Library/Logs/DiagnosticReports',
      bytes: 1024 * 1024 * 50, // 50 MB
      selectedByDefault: true,
      optional: false,
      lastUsedAt: null,
      daysIdle: null
    },
    {
      id: 'app-1',
      categoryId: 'unusedApps',
      name: 'OldEditor.app',
      path: '/Applications/OldEditor.app',
      bytes: 1024 * 1024 * 1024 * 2, // 2 GB
      selectedByDefault: false,
      optional: true,
      lastUsedAt: '2024-01-01T00:00:00.000Z',
      daysIdle: 410
    }
  ]
}

const sampleCleanResult: CleanResult = {
  trashed: ['/Users/developer/Library/Caches/Google/Chrome'],
  failed: [{ path: '/Users/developer/Library/Logs/DiagnosticReports', error: 'Permission denied' }],
  bytesRequested: 1024 * 1024 * 550
}

describe('computeReportSummary', () => {
  it('correctly aggregates scan, clean, and skipped items', () => {
    const summary = computeReportSummary({
      scanResult: sampleScanResult,
      cleanResult: sampleCleanResult,
      disk: sampleDisk
    })

    expect(summary.totalFoundItems).toBe(3)
    expect(summary.totalFoundBytes).toBe(
      1024 * 1024 * 500 + 1024 * 1024 * 50 + 1024 * 1024 * 1024 * 2
    )
    expect(summary.totalTrashedItems).toBe(1)
    expect(summary.totalTrashedBytes).toBe(1024 * 1024 * 500)
    expect(summary.totalFailedItems).toBe(1)
    expect(summary.totalSkippedItems).toBe(2)
    expect(summary.totalSkippedBytes).toBe(1024 * 1024 * 50 + 1024 * 1024 * 1024 * 2)

    expect(summary.categories).toHaveLength(3)
    const userCaches = summary.categories.find((c) => c.categoryId === 'userCaches')
    expect(userCaches?.foundCount).toBe(1)
    expect(userCaches?.foundBytes).toBe(1024 * 1024 * 500)
    expect(userCaches?.status).toBe('cleaned')
  })

  it('handles scan reports when no clean operation has occurred', () => {
    const summary = computeReportSummary({
      scanResult: sampleScanResult,
      disk: sampleDisk
    })

    expect(summary.totalFoundItems).toBe(3)
    expect(summary.totalTrashedItems).toBe(0)
    expect(summary.totalTrashedBytes).toBe(0)
    expect(summary.totalFailedItems).toBe(0)
    expect(summary.totalSkippedItems).toBe(3)
    expect(summary.totalSkippedBytes).toBe(summary.totalFoundBytes)
  })

  it('handles empty scan result gracefully', () => {
    const emptyScan: ScanResult = { scannedAt: '2025-02-15T14:30:00.000Z', limited: false, items: [] }
    const summary = computeReportSummary({ scanResult: emptyScan })

    expect(summary.totalFoundItems).toBe(0)
    expect(summary.totalFoundBytes).toBe(0)
    expect(summary.categories).toHaveLength(0)
    expect(summary.totalTrashedItems).toBe(0)
    expect(summary.totalSkippedItems).toBe(0)
  })
})

describe('generateMarkdownReport', () => {
  it('generates a complete, structured English markdown report', () => {
    const md = generateMarkdownReport({
      scanResult: sampleScanResult,
      cleanResult: sampleCleanResult,
      disk: sampleDisk,
      options: { locale: 'en', format: 'markdown' }
    })

    expect(md).toContain('# Disk Headroom — Clean Report')
    expect(md).toContain('## Startup Disk Summary')
    expect(md).toContain('## Cleaning Overview')
    expect(md).toContain('## Category Breakdown')
    expect(md).toContain('## Items Moved to Trash')
    expect(md).toContain('## Items Kept / Skipped')
    expect(md).toContain('## Items Failed to Move')
    expect(md).toContain('This report was generated locally by Disk Headroom. No telemetry was sent and no files were uploaded.')
    expect(md).toContain('/Users/developer/Library/Caches/Google/Chrome')
    expect(md).toContain('/Applications/OldEditor.app')
    expect(md).toContain('Permission denied')
  })

  it('generates report in Portuguese (pt-BR)', () => {
    const md = generateMarkdownReport({
      scanResult: sampleScanResult,
      cleanResult: sampleCleanResult,
      disk: sampleDisk,
      options: { locale: 'pt-BR', format: 'markdown' }
    })

    expect(md).toContain('# Disk Headroom — Relatório de Limpeza')
    expect(md).toContain('## Resumo do Disco de Inicialização')
    expect(md).toContain('## Visão Geral da Limpeza')
    expect(md).toContain('## Detalhamento por Categoria')
    expect(md).toContain('## Itens Movidos para a Lixeira')
    expect(md).toContain('## Itens Mantidos / Ignorados')
    expect(md).toContain('## Itens que Não Puderam Ser Movidos')
    expect(md).toContain('Este relatório foi gerado localmente pelo Disk Headroom. Nenhuma telemetria foi enviada e nenhum arquivo foi carregado.')
  })

  it('generates report in Spanish (es)', () => {
    const md = generateMarkdownReport({
      scanResult: sampleScanResult,
      cleanResult: sampleCleanResult,
      disk: sampleDisk,
      options: { locale: 'es', format: 'markdown' }
    })

    expect(md).toContain('# Disk Headroom — Informe de Limpieza')
    expect(md).toContain('## Resumen del Disco de Inicio')
    expect(md).toContain('## Resumen General de la Limpieza')
    expect(md).toContain('## Desglose por Categoría')
    expect(md).toContain('## Elementos Movidos a la Papelera')
    expect(md).toContain('## Elementos Conservados / Omitidos')
    expect(md).toContain('## Elementos que No se Pudieron Mover')
    expect(md).toContain('Este informe fue generado localmente por Disk Headroom. No se enviaron datos de telemetría ni se subieron archivos.')
  })
})

describe('generateHtmlReport', () => {
  it('generates clean, styled, and safe HTML', () => {
    const html = generateHtmlReport({
      scanResult: sampleScanResult,
      cleanResult: sampleCleanResult,
      disk: sampleDisk,
      options: { locale: 'en', format: 'pdf' }
    })

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<title>Disk Headroom — Clean Report</title>')
    expect(html).toContain('<style>')
    expect(html).toContain('Google Chrome Cache')
    expect(html).toContain('/Users/developer/Library/Caches/Google/Chrome')
    expect(html).toContain('Permission denied')
  })

  it('escapes special characters in file paths and errors to prevent injection', () => {
    const injectedScan: ScanResult = {
      scannedAt: '2025-02-15T14:30:00.000Z',
      limited: false,
      items: [
        {
          id: 'xss-1',
          categoryId: 'userCaches',
          name: '<script>alert("xss")</script>',
          path: '/Users/<bad>/path&name="test"',
          bytes: 100,
          selectedByDefault: true,
          optional: false,
          lastUsedAt: null,
          daysIdle: null
        }
      ]
    }

    const html = generateHtmlReport({
      scanResult: injectedScan,
      options: { locale: 'en', format: 'pdf' }
    })

    expect(html).not.toContain('<script>alert("xss")</script>')
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    expect(html).toContain('/Users/&lt;bad&gt;/path&amp;name=&quot;test&quot;')
  })
})
