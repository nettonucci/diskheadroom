import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { generateHtmlReport, generateMarkdownReport } from '../shared/report'
import type { ExportReportRequest, ExportReportResult } from '../shared/types'
import { loadSettings } from './settings'

/**
 * Exports a clean report in Markdown, PDF, or HTML to a user-selected path.
 * Requires Pro status to be enabled in settings.
 */
export async function exportCleanReport(
  request: ExportReportRequest,
  win?: BrowserWindow | null
): Promise<ExportReportResult> {
  try {
    const settings = await loadSettings()
    if (!settings.isPro) {
      return { success: false, error: 'PRO_REQUIRED' }
    }

    const defaultDateStr = new Date().toISOString().slice(0, 10)
    const defaultExtension = request.options?.format === 'pdf' ? 'pdf' : 'md'
    const defaultPath = `disk-headroom-clean-report-${defaultDateStr}.${defaultExtension}`

    const dialogOptions = {
      defaultPath,
      filters: [
        { name: 'Markdown (*.md)', extensions: ['md'] },
        { name: 'PDF Document (*.pdf)', extensions: ['pdf'] },
        { name: 'HTML Document (*.html)', extensions: ['html', 'htm'] },
        { name: 'All Files (*.*)', extensions: ['*'] }
      ]
    }

    const saveResult = win
      ? await dialog.showSaveDialog(win, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, canceled: true }
    }

    const targetPath = saveResult.filePath
    const ext = extname(targetPath).toLowerCase()
    const reportOptions = {
      ...request,
      locale: request.options?.locale ?? settings.locale
    }

    if (ext === '.pdf') {
      const html = generateHtmlReport(reportOptions)
      const pdfBuffer = await renderHtmlToPdf(html)
      await writeFile(targetPath, pdfBuffer)
      return { success: true, filePath: targetPath, format: 'pdf' }
    }

    if (ext === '.html' || ext === '.htm') {
      const html = generateHtmlReport(reportOptions)
      await writeFile(targetPath, html, 'utf8')
      return { success: true, filePath: targetPath, format: 'html' }
    }

    const markdown = generateMarkdownReport(reportOptions)
    await writeFile(targetPath, markdown, 'utf8')
    return { success: true, filePath: targetPath, format: 'markdown' }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const printWindow = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      sandbox: true
    }
  })

  try {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    await printWindow.loadURL(dataUrl)
    return await printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: {
        marginType: 'default'
      }
    })
  } finally {
    printWindow.destroy()
  }
}
