import { app, safeStorage } from 'electron'
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LicenseStatus } from '../shared/types'
import { peekLicenseKeyFallback, setLicenseKeyFallback } from './settings'

/** Product id bound into every signed payload. */
export const LICENSE_PRODUCT_ID = 'diskheadroom'

/** Licenses are lifetime of this major unless `exp` is set. */
export const LICENSE_MAJOR = 1

export const LICENSE_PREFIX = 'dh1'

export const MAX_LICENSE_KEY_LENGTH = 2048

/**
 * Production verifying key. Safe to ship in this MIT repo: it cannot mint licenses.
 * The matching private key is not in git (see `.license-private.pem` locally).
 */
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi/iul7APcs+3xQrszYg+nw8ZPVC28wTUWBnY3oeyle0=
-----END PUBLIC KEY-----
`

export interface LicensePayload {
  product: string
  major: number
  exp?: string | null
}

export function toBase64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Buffer | null {
  if (!value || /[^A-Za-z0-9_-]/.test(value)) return null
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4))
  try {
    const buffer = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
    return buffer.length > 0 ? buffer : null
  } catch {
    return null
  }
}

export function buildLicenseKey(payload: LicensePayload, privateKeyPem: string): string {
  const body = Buffer.from(
    JSON.stringify({
      product: payload.product,
      major: payload.major,
      ...(payload.exp === undefined ? {} : { exp: payload.exp })
    }),
    'utf8'
  )
  const signature = sign(null, body, createPrivateKey(privateKeyPem))
  return `${LICENSE_PREFIX}.${toBase64Url(body)}.${toBase64Url(signature)}`
}

function activePublicKey(): string {
  const testKey = process.env.DISKHEADROOM_TEST_LICENSE_PUBLIC_KEY
  if (process.env.VITEST === 'true' && testKey?.includes('BEGIN PUBLIC KEY')) {
    return testKey
  }
  return LICENSE_PUBLIC_KEY_PEM
}

export function verifyLicenseKey(
  raw: unknown,
  publicKeyPem: string = activePublicKey()
): boolean {
  if (typeof raw !== 'string') return false
  const key = raw.trim()
  if (!key || key.length > MAX_LICENSE_KEY_LENGTH) return false
  const parts = key.split('.')
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) return false
  const body = fromBase64Url(parts[1])
  const signature = fromBase64Url(parts[2])
  if (!body || !signature || signature.length !== 64) return false

  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  const payload = parsed as Record<string, unknown>
  if (payload.product !== LICENSE_PRODUCT_ID) return false
  if (payload.major !== LICENSE_MAJOR) return false
  if (!licenseExpiryAllows(payload.exp)) return false

  try {
    return verify(null, body, createPublicKey(publicKeyPem), signature)
  } catch {
    return false
  }
}

function licenseExpiryAllows(exp: unknown): boolean {
  if (exp === undefined || exp === null) return true
  if (typeof exp !== 'string' || !exp.trim()) return false
  const at = Date.parse(exp)
  return Number.isFinite(at) && at > Date.now()
}

function encryptedLicensePath(): string {
  return join(app.getPath('userData'), 'license.bin')
}

async function readKeychainLicense(): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const blob = await readFile(encryptedLicensePath())
    const text = safeStorage.decryptString(blob)
    return typeof text === 'string' && text.trim() ? text.trim() : null
  } catch {
    return null
  }
}

async function writeKeychainLicense(key: string): Promise<boolean> {
  if (!safeStorage.isEncryptionAvailable()) return false
  try {
    const blob = safeStorage.encryptString(key)
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(encryptedLicensePath(), blob)
    return true
  } catch {
    return false
  }
}

async function clearKeychainLicense(): Promise<void> {
  try {
    await rm(encryptedLicensePath(), { force: true })
  } catch {
    // File may already be gone.
  }
}

async function readStoredLicenseKey(): Promise<string | null> {
  return (await readKeychainLicense()) ?? (await peekLicenseKeyFallback())
}

export async function getLicenseStatus(): Promise<LicenseStatus> {
  const stored = await readStoredLicenseKey()
  return { isPro: stored ? verifyLicenseKey(stored) : false }
}

export async function activateLicense(raw: unknown): Promise<LicenseStatus> {
  if (!verifyLicenseKey(raw)) {
    return { isPro: false }
  }
  const key = (raw as string).trim()
  const storedInKeychain = await writeKeychainLicense(key)
  if (storedInKeychain) {
    await setLicenseKeyFallback(null)
    return { isPro: true }
  }
  await setLicenseKeyFallback(key)
  await clearKeychainLicense()
  return { isPro: true }
}
