import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeBytes, normalizeN64ToFile, verifyNormalized } from '../src/main/normalize'

let roots: string[] = []

afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
  roots = []
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sc64-normalize-'))
  roots.push(root)
  return root
}

describe('normalizeBytes', () => {
  it('returns big-endian buffers untouched', () => {
    const buf = Buffer.from([0x12, 0x34, 0x56, 0x78])
    expect(normalizeBytes(buf, 'z64')).toBe(buf)
    expect([...buf]).toEqual([0x12, 0x34, 0x56, 0x78])
  })

  it('swaps each 16-bit word for v64', () => {
    const buf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06])
    normalizeBytes(buf, 'v64')
    expect([...buf]).toEqual([0x02, 0x01, 0x04, 0x03, 0x06, 0x05])
  })

  it('reverses each 32-bit word for n64', () => {
    const buf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])
    normalizeBytes(buf, 'n64')
    expect([...buf]).toEqual([0x04, 0x03, 0x02, 0x01, 0x08, 0x07, 0x06, 0x05])
  })

  it('leaves trailing bytes shorter than a word untouched', () => {
    const buf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06])
    normalizeBytes(buf, 'n64')
    expect([...buf]).toEqual([0x04, 0x03, 0x02, 0x01, 0x05, 0x06])
  })

  it('normalizing a swap back yields the original bytes', () => {
    const original = Buffer.from([0x80, 0x37, 0x12, 0x40, 0xaa, 0xbb, 0xcc, 0xdd])
    const v64Swapped = Buffer.from([0x37, 0x80, 0x40, 0x12, 0xbb, 0xaa, 0xdd, 0xcc])
    const n64Swapped = Buffer.from([0x40, 0x12, 0x37, 0x80, 0xdd, 0xcc, 0xbb, 0xaa])
    expect([...normalizeBytes(v64Swapped, 'v64')]).toEqual([...original])
    expect([...normalizeBytes(n64Swapped, 'n64')]).toEqual([...original])
  })
})

describe('normalizeN64ToFile + verifyNormalized', () => {
  it('writes a v64 file byte-swapped to big-endian and verifies it', async () => {
    const root = makeRoot()
    const src = join(root, 'rom.v64')
    const dst = join(root, 'rom.z64')
    const srcData = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])
    writeFileSync(src, srcData)

    await normalizeN64ToFile(src, dst, 'v64')
    expect([...readFileSync(dst)]).toEqual([0x02, 0x01, 0x04, 0x03, 0x06, 0x05, 0x08, 0x07])

    expect(await verifyNormalized(src, dst, 'v64')).toBe(true)
    expect(await verifyNormalized(src, dst, 'n64')).toBe(false)
  })

  it('writes an n64 file and verifies it', async () => {
    const root = makeRoot()
    const src = join(root, 'rom.n64')
    const dst = join(root, 'rom.z64')
    const srcData = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])
    writeFileSync(src, srcData)

    await normalizeN64ToFile(src, dst, 'n64')
    expect([...readFileSync(dst)]).toEqual([0x04, 0x03, 0x02, 0x01, 0x08, 0x07, 0x06, 0x05])
    expect(await verifyNormalized(src, dst, 'n64')).toBe(true)
  })

  it('fails verification on size mismatch or wrong bytes', async () => {
    const root = makeRoot()
    const src = join(root, 'rom.v64')
    writeFileSync(src, Buffer.from([0x01, 0x02, 0x03, 0x04]))

    const tooBig = join(root, 'big.z64')
    writeFileSync(tooBig, Buffer.alloc(8))
    expect(await verifyNormalized(src, tooBig, 'v64')).toBe(false)

    const wrong = join(root, 'wrong.z64')
    writeFileSync(wrong, Buffer.from([0xff, 0xff, 0xff, 0xff]))
    expect(await verifyNormalized(src, wrong, 'v64')).toBe(false)
  })
})
