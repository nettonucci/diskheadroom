import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  writeFile: vi.fn(),
  loadSettings: vi.fn(),
  loadURL: vi.fn(),
  destroy: vi.fn(),
  printToPDF: vi.fn(),
  on: vi.fn()
}))

vi.mock('electron', () => {
  class MockBrowserWindow {
    webContents = {
      loadURL: mocks.loadURL,
      printToPDF: mocks.printToPDF,
      on: mocks.on
    }
    loadURL = mocks.loadURL
    destroy = mocks.destroy
    constructor() {
      mocks.on.mockImplementation((event: string, callback: () => void) => {
        if (event === 'did-finish-load') {
          setTimeout(callback, 0)
        }
      })
    }
  }

  return {
    dialog: { showSaveDialog: mocks.showSaveDialog },
    BrowserWindow: MockBrowserWindow
  }
})

vi.mock('node:fs/promises', () => {
  const module = {
    writeFile: mocks.writeFile
  }
  return { default: module, ...module }
})

vi.mock('../src/main/settings', () => ({
  loadSettings: mocks.loadSettings
}))

import { exportCleanReport } from '../src/main/report'
import type { ExportReportRequest } from '../src/shared/types'

const sampleRequest: ExportReportRequest = {
  scanResult: {
    scannedAt: '2025-01-01T00:00:00.000Z',
    limited: false,
    items: [
      {
        id: '1',
        categoryId: 'userCaches',
        name: 'Cache 1',
        path: '/Users/test/Library/Caches/1',
        bytes: 1024,
        selectedByDefault: true,
        optional: false,
        lastUsedAt: null,
        daysIdle: null
      }
    ]
  },
  options: {
    locale: 'en',
    format: 'markdown'
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('exportCleanReport', () => {
  it('rejects export when isPro is false', async () => {
    mocks.loadSettings.mockResolvedValue({ isPro: false, locale: 'en' })

    const result = await exportCleanReport(sampleRequest)
    expect(result).toEqual({ success: false, error: 'PRO_REQUIRED' })
    expect(mocks.showSaveDialog).not.toHaveBeenCalled()
  })

  it('handles user cancellation in save dialog', async () => {
    mocks.loadSettings.mockResolvedValue({ isPro: true, locale: 'en' })
    mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })

    const result = await exportCleanReport(sampleRequest)
    expect(result).toEqual({ success: false, canceled: true })
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('exports markdown report successfully when isPro is true', async () => {
    mocks.loadSettings.mockResolvedValue({ isPro: true, locale: 'en' })
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/Users/test/report.md' })
    mocks.writeFile.mockResolvedValue(undefined)

    const result = await exportCleanReport(sampleRequest)
    expect(result).toEqual({ success: true, filePath: '/Users/test/report.md', format: 'markdown' })
    expect(mocks.writeFile).toHaveBeenCalledWith(
      '/Users/test/report.md',
      expect.stringContaining('Clean Report'),
      'utf8'
    )
  })

  it('exports PDF report successfully using offscreen window printToPDF', async () => {
    mocks.loadSettings.mockResolvedValue({ isPro: true, locale: 'en' })
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/Users/test/report.pdf' })
    const pdfBuffer = Buffer.from('mock-pdf-content')
    mocks.printToPDF.mockResolvedValue(pdfBuffer)
    mocks.writeFile.mockResolvedValue(undefined)

    const result = await exportCleanReport({
      ...sampleRequest,
      options: { locale: 'en', format: 'pdf' }
    })

    expect(result).toEqual({ success: true, filePath: '/Users/test/report.pdf', format: 'pdf' })
    expect(mocks.printToPDF).toHaveBeenCalledWith(
      expect.objectContaining({ printBackground: true, pageSize: 'A4' })
    )
    expect(mocks.writeFile).toHaveBeenCalledWith('/Users/test/report.pdf', pdfBuffer)
  })

  it('returns write error when filesystem throws', async () => {
    mocks.loadSettings.mockResolvedValue({ isPro: true, locale: 'en' })
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/Users/test/report.md' })
    mocks.writeFile.mockRejectedValue(new Error('EACCES: permission denied'))

    const result = await exportCleanReport(sampleRequest)
    expect(result).toEqual({
      success: false,
      error: 'EACCES: permission denied'
    })
  })
})
