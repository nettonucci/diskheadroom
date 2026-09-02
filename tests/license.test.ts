import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FIXTURE_PRIVATE_KEY_PEM,
  FIXTURE_PUBLIC_KEY_PEM
} from './fixtures/licenseKeys'
import {
  LICENSE_PUBLIC_KEY_PEM,
  MAX_LICENSE_KEY_LENGTH,
  buildLicenseKey,
  fromBase64Url,
  toBase64Url,
  verifyLicenseKey
} from '../src/main/license'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  getPath: vi.fn(() => '/tmp/diskheadroom'),
  getLocale: vi.fn(() => 'en'),
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`, 'utf8')),
  decryptString: vi.fn((blob: Buffer) => blob.toString('utf8').slice(4))
}))

vi.mock('node:fs/promises', () => {
  const module = {
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
    mkdir: mocks.mkdir,
    rm: mocks.rm
  }
  return { default: module, ...module }
})

vi.mock('electron', () => {
  const module = {
    app: {
      getPath: mocks.getPath,
      getLocale: mocks.getLocale
    },
    safeStorage: {
      isEncryptionAvailable: mocks.isEncryptionAvailable,
      encryptString: mocks.encryptString,
      decryptString: mocks.decryptString
    }
  }
  return { default: module, ...module }
})

import { activateLicense, getLicenseStatus } from '../src/main/license'

function validFixtureKey(
  overrides: { product?: string; major?: number; exp?: string | null } = {}
): string {
  return buildLicenseKey(
    {
      product: overrides.product ?? 'diskheadroom',
      major: overrides.major ?? 1,
      exp: overrides.exp
    },
    FIXTURE_PRIVATE_KEY_PEM
  )
}

const files = new Map<string, Buffer | string>()

beforeEach(() => {
  vi.clearAllMocks()
  files.clear()
  mocks.isEncryptionAvailable.mockReturnValue(true)
  mocks.encryptString.mockImplementation((value: string) => Buffer.from(`enc:${value}`, 'utf8'))
  mocks.decryptString.mockImplementation((blob: Buffer) => blob.toString('utf8').slice(4))
  mocks.readFile.mockImplementation(async (path: string) => {
    const value = files.get(String(path))
    if (value === undefined) {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
    return value
  })
  mocks.writeFile.mockImplementation(async (path: string, data: Buffer | string) => {
    files.set(String(path), data)
  })
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.rm.mockImplementation(async (path: string) => {
    files.delete(String(path))
  })
})

describe('license verification', () => {
  it('accepts a fixture key signed for this product and major', () => {
    expect(verifyLicenseKey(validFixtureKey(), FIXTURE_PUBLIC_KEY_PEM)).toBe(true)
  })

  it('fails closed for empty, non-string, overlong, and malformed keys', () => {
    expect(verifyLicenseKey('', FIXTURE_PUBLIC_KEY_PEM)).toBe(false)
    expect(verifyLicenseKey('   ', FIXTURE_PUBLIC_KEY_PEM)).toBe(false)
    expect(verifyLicenseKey(null, FIXTURE_PUBLIC_KEY_PEM)).toBe(false)
    expect(verifyLicenseKey('x'.repeat(MAX_LICENSE_KEY_LENGTH + 1), FIXTURE_PUBLIC_KEY_PEM)).toBe(
      false
    )
    expect(verifyLicenseKey('dh1.onlyone', FIXTURE_PUBLIC_KEY_PEM)).toBe(false)
    expect(verifyLicenseKey('dh2.aaa.bbb', FIXTURE_PUBLIC_KEY_PEM)).toBe(false)
    expect(verifyLicenseKey('dh1.%%%.aaa', FIXTURE_PUBLIC_KEY_PEM)).toBe(false)
  })

  it('rejects a tampered payload and a fixture key against the production public key', () => {
    const key = validFixtureKey()
    const parts = key.split('.')
    const body = fromBase64Url(parts[1])
    expect(body).not.toBeNull()
    const tampered = Buffer.from(body!.toString('utf8').replace('diskheadroom', 'otherproduct'))
    const forged = `${parts[0]}.${toBase64Url(tampered)}.${parts[2]}`
    expect(verifyLicenseKey(forged, FIXTURE_PUBLIC_KEY_PEM)).toBe(false)
    expect(verifyLicenseKey(key, LICENSE_PUBLIC_KEY_PEM)).toBe(false)
    expect(verifyLicenseKey(key)).toBe(false)
    expect(LICENSE_PUBLIC_KEY_PEM).toContain('BEGIN PUBLIC KEY')
  })

  it('rejects the wrong product, major, expired, and invalid expiry', () => {
    expect(verifyLicenseKey(validFixtureKey({ product: 'other' }), FIXTURE_PUBLIC_KEY_PEM)).toBe(
      false
    )
    expect(verifyLicenseKey(validFixtureKey({ major: 2 }), FIXTURE_PUBLIC_KEY_PEM)).toBe(false)
    expect(
      verifyLicenseKey(validFixtureKey({ exp: '2000-01-01T00:00:00.000Z' }), FIXTURE_PUBLIC_KEY_PEM)
    ).toBe(false)
    expect(verifyLicenseKey(validFixtureKey({ exp: 'not-a-date' }), FIXTURE_PUBLIC_KEY_PEM)).toBe(
      false
    )
  })

  it('accepts a future expiry and omits exp for lifetime-of-major', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    expect(verifyLicenseKey(validFixtureKey({ exp: future }), FIXTURE_PUBLIC_KEY_PEM)).toBe(true)
    expect(verifyLicenseKey(validFixtureKey(), FIXTURE_PUBLIC_KEY_PEM)).toBe(true)
  })

  it('rejects a payload that is not a JSON object', () => {
    const body = toBase64Url(Buffer.from('["diskheadroom"]', 'utf8'))
    const signature = validFixtureKey().split('.')[2]
    expect(verifyLicenseKey(`dh1.${body}.${signature}`, FIXTURE_PUBLIC_KEY_PEM)).toBe(false)
  })

  it('rejects invalid JSON and a public key that cannot verify', () => {
    const body = toBase64Url(Buffer.from('{', 'utf8'))
    const signature = validFixtureKey().split('.')[2]
    expect(verifyLicenseKey(`dh1.${body}.${signature}`, FIXTURE_PUBLIC_KEY_PEM)).toBe(false)
    expect(verifyLicenseKey(validFixtureKey(), 'not-a-pem')).toBe(false)
  })
})

describe('license persistence', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    vi.stubEnv('DISKHEADROOM_TEST_LICENSE_PUBLIC_KEY', FIXTURE_PUBLIC_KEY_PEM)
  })

  it('is not Pro until a valid key is stored, and ignores invalid keys', async () => {
    await expect(getLicenseStatus()).resolves.toEqual({ isPro: false })
    await expect(activateLicense('')).resolves.toEqual({ isPro: false })
    await expect(activateLicense('dh1.not-valid.sig')).resolves.toEqual({ isPro: false })
    expect(files.size).toBe(0)
  })

  it('stores a valid key via safeStorage and still counts as Pro after a reload', async () => {
    const key = validFixtureKey()
    await expect(activateLicense(key)).resolves.toEqual({ isPro: true })
    expect(mocks.encryptString).toHaveBeenCalledWith(key)
    expect(files.has('/tmp/diskheadroom/license.bin')).toBe(true)
    const settings = JSON.parse(String(files.get('/tmp/diskheadroom/settings.json')))
    expect(settings.licenseKey).toBeUndefined()
    await expect(getLicenseStatus()).resolves.toEqual({ isPro: true })
  })

  it('falls back to settings.json when Keychain encryption is unavailable', async () => {
    mocks.isEncryptionAvailable.mockReturnValue(false)
    const key = validFixtureKey()
    await expect(activateLicense(key)).resolves.toEqual({ isPro: true })
    const settings = JSON.parse(String(files.get('/tmp/diskheadroom/settings.json')))
    expect(settings.licenseKey).toBe(key)
    expect(files.has('/tmp/diskheadroom/license.bin')).toBe(false)
    await expect(getLicenseStatus()).resolves.toEqual({ isPro: true })
  })

  it('falls back to settings.json when encrypting throws', async () => {
    mocks.encryptString.mockImplementation(() => {
      throw new Error('Keychain unavailable')
    })
    const key = validFixtureKey()
    await expect(activateLicense(key)).resolves.toEqual({ isPro: true })
    const settings = JSON.parse(String(files.get('/tmp/diskheadroom/settings.json')))
    expect(settings.licenseKey).toBe(key)
    await expect(getLicenseStatus()).resolves.toEqual({ isPro: true })
  })

  it('still falls back when clearing the encrypted file fails', async () => {
    mocks.isEncryptionAvailable.mockReturnValue(false)
    mocks.rm.mockRejectedValueOnce(new Error('busy'))
    const key = validFixtureKey()
    await expect(activateLicense(key)).resolves.toEqual({ isPro: true })
  })

  it('reads a settings.json fallback after relaunch when the encrypted file is absent', async () => {
    const key = validFixtureKey()
    files.set(
      '/tmp/diskheadroom/settings.json',
      JSON.stringify({ locale: 'en', licenseKey: key }, null, 2)
    )
    await expect(getLicenseStatus()).resolves.toEqual({ isPro: true })
  })

  it('does not log the license key', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const key = validFixtureKey()
    await activateLicense(key)
    await getLicenseStatus()
    const dump = [...log.mock.calls, ...error.mock.calls].flat().map(String).join('\n')
    expect(dump).not.toContain(key)
    log.mockRestore()
    error.mockRestore()
  })
})
