#!/usr/bin/env node
import { createPrivateKey, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function toBase64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function loadPrivateKeyPem() {
  if (process.env.DISKHEADROOM_LICENSE_PRIVATE_KEY_PEM) {
    return process.env.DISKHEADROOM_LICENSE_PRIVATE_KEY_PEM.replace(/\\n/g, '\n')
  }
  const file =
    process.env.DISKHEADROOM_LICENSE_PRIVATE_KEY_FILE ??
    join(process.cwd(), '.license-private.pem')
  return readFileSync(file, 'utf8')
}

const major = Number(process.argv[2] ?? '1')
const exp = process.argv[3] && process.argv[3] !== 'none' ? process.argv[3] : undefined
const payload = { product: 'diskheadroom', major, ...(exp ? { exp } : {}) }
const body = Buffer.from(JSON.stringify(payload), 'utf8')
const signature = sign(null, body, createPrivateKey(loadPrivateKeyPem()))
process.stdout.write(`dh1.${toBase64Url(body)}.${toBase64Url(signature)}\n`)
