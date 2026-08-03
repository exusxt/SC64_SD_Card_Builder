import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { PreviewEntry } from '../../../shared/types'
import type { T } from '../i18n'
import { Button } from './ui'

const SCREEN_W = 640
const SCREEN_H = 480
const VISIBLE_X0 = 32
const VISIBLE_X1 = 608
const TAB_Y0 = 24
const TAB_H = 20
const SEPARATOR_Y = 400
const LIST_ENTRIES = 19
const ROW_H = 18
const TEXT_Y0 = 56
const BOXART_US = { x: 426, y: 264, w: 158, h: 112 }
const BOXART_JP = { x: 471, y: 218, w: 112, h: 158 }
const BOXART_DD = { x: 456, y: 264, w: 129, h: 112 }

const EMULATOR_EXTS = new Set(['.nes', '.smc', '.sfc', '.fig', '.gb', '.gbc', '.sms', '.gg', '.chf'])

const MONO = "'ui-monospace','SFMono-Regular','Menlo','Consolas',monospace"

function menuSize(size: number): string {
  if (size < 0) return 'unknown'
  if (size === 0) return 'empty'
  if (size < 8 * 1024) return `${size} B`
  if (size < 4 * 1024 * 1024) return `${Math.floor(size / 1024)} kB`
  if (size < 1024 * 1024 * 1024) return `${Math.floor(size / 1024 / 1024)} MB`
  return `${Math.floor(size / 1024 / 1024 / 1024)} GB`
}

function entryType(e: PreviewEntry): string {
  if (e.isDir) return 'Directory'
  if (e.kind === 'n64') return 'N64 ROM'
  if (e.kind === 'dd') return '64DD disk'
  const ext = e.name.slice(e.name.lastIndexOf('.')).toLowerCase()
  if (EMULATOR_EXTS.has(ext)) return 'Emulator ROM file'
  return 'File'
}

export function MenuPreview({ t, root, onClose }: { t: T; root: string; onClose: () => void }): React.JSX.Element {
  const [dirRel, setDirRel] = useState('')
  const [entries, setEntries] = useState<PreviewEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sel, setSel] = useState(0)
  const [boxart, setBoxart] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [bg, setBg] = useState<{ width: number; height: number } | null>(null)
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setBg(null)
    void window.api.loadPreviewBackground(root).then((b) => {
      if (!b || cancelled) return
      const canvas = bgCanvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      canvas.width = b.width
      canvas.height = b.height
      const bytes = Uint8Array.from(atob(b.data))
      ctx.putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer), b.width, b.height), 0, 0)
      if (!cancelled) setBg({ width: b.width, height: b.height })
    })
    return () => {
      cancelled = true
    }
  }, [root])

  const loadDir = useCallback(
    async (rel: string) => {
      setDirRel(rel)
      setEntries(null)
      setLoadError(null)
      try {
        const res = await window.api.listPreviewDir(root, rel)
        if (res) {
          setEntries(res)
          setSel(0)
        } else {
          setLoadError('unreadable')
        }
      } catch {
        setLoadError('unreadable')
      }
    },
    [root]
  )

  useEffect(() => {
    void loadDir('')
  }, [loadDir])

  const selected = entries && entries.length > 0 ? entries[Math.min(sel, entries.length - 1)] : null

  useEffect(() => {
    if (!selected?.boxart) {
      setBoxart(null)
      return
    }
    let cancelled = false
    void window.api.loadPreviewBoxart(root, selected.boxart).then((d) => {
      if (!cancelled) setBoxart(d)
    })
    return () => {
      cancelled = true
    }
  }, [root, selected?.boxart])

  const openDir = (name: string): void => {
    void loadDir(dirRel ? `${dirRel}/${name}` : name)
  }

  const goUp = (): void => {
    const idx = dirRel.lastIndexOf('/')
    void loadDir(idx === -1 ? '' : dirRel.slice(0, idx))
  }

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSel((s) => (entries ? Math.min(s + 1, entries.length - 1) : s))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSel((s) => Math.max(s - 1, 0))
          break
        case 'Enter':
        case 'ArrowRight':
          e.preventDefault()
          if (selected?.isDir) openDir(selected.name)
          break
        case 'ArrowLeft':
        case 'Backspace':
          e.preventDefault()
          if (dirRel) goUp()
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
        case 'Home':
          e.preventDefault()
          setSel(0)
          break
        case 'End':
          e.preventDefault()
          if (entries) setSel(entries.length - 1)
          break
      }
    },
    [entries, selected, dirRel, onClose, loadDir]
  )

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  useEffect(() => {
    const compute = (): void => {
      const pad = 96
      setScale(Math.min(1, (window.innerWidth - pad) / SCREEN_W, (window.innerHeight - pad) / SCREEN_H))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [])

  const start = useMemo(() => {
    if (!entries || entries.length <= LIST_ENTRIES) return 0
    let s = sel - Math.floor(LIST_ENTRIES / 2)
    if (s < 0) s = 0
    if (s > entries.length - LIST_ENTRIES) s = entries.length - LIST_ENTRIES
    return s
  }, [entries, sel])

  const visible = entries ? entries.slice(start, start + LIST_ENTRIES) : []
  const isPortrait = selected?.region === 'Japan' && selected.kind === 'n64'
  const box = selected?.kind === 'dd' ? BOXART_DD : isPortrait ? BOXART_JP : BOXART_US
  const rootPath = dirRel ? `SD:/${dirRel}/` : 'SD:/'

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/90 p-6">
      <div className="flex w-full max-w-5xl items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-sc64-muted">{t('preview.title')}</h2>
          <div className="truncate font-mono text-xs text-sc64-accent">{rootPath}</div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-xs text-sc64-muted sm:block">{t('preview.hint')}</span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" /> {t('preview.close')}
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg" style={{ width: SCREEN_W * scale, height: SCREEN_H * scale }}>
        <div
          className="relative bg-black"
          style={{ width: SCREEN_W, height: SCREEN_H, transform: `scale(${scale})`, transformOrigin: 'top left', fontFamily: MONO }}
        >
          {/* Background (menu/cache/background.data), centered and darkened like the console menu */}
          <canvas
            ref={bgCanvasRef}
            style={{
              position: 'absolute',
              left: bg ? (SCREEN_W - bg.width) / 2 : 0,
              top: bg ? (SCREEN_H - bg.height) / 2 : 0,
              display: bg ? 'block' : 'none',
              imageRendering: 'pixelated'
            }}
          />
          {bg ? (
            <div
              className="pointer-events-none"
              style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.37)', zIndex: 0 }}
            />
          ) : null}

          {/* Tabs */}
          <div style={{ position: 'absolute', left: VISIBLE_X0, top: TAB_Y0, right: SCREEN_W - VISIBLE_X1, height: TAB_H, display: 'flex', gap: 4 }}>
            {[
              { label: 'File Browser', active: true },
              { label: 'Favorites', active: false },
              { label: 'History', active: false }
            ].map((tab) => (
              <div
                key={tab.label}
                style={{
                  flex: 1,
                  maxWidth: 190,
                  border: tab.active ? '2px solid #fff' : '2px solid #5f5f5f',
                  background: tab.active ? '#6f6f6f' : '#3f3f3f',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 700,
                  lineHeight: `${TAB_H - 4}px`,
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden'
                }}
              >
                {tab.label}
              </div>
            ))}
          </div>

          {/* Content frame */}
          <div style={{ position: 'absolute', left: VISIBLE_X0, top: 48, right: VISIBLE_X0, bottom: SCREEN_H - SEPARATOR_Y, border: '4px solid #fff' }} />

          {/* File list */}
          <div style={{ position: 'absolute', left: 0, top: 0, width: SCREEN_W, height: SEPARATOR_Y }}>
            {visible.map((entry, i) => {
              const idx = start + i
              const isSel = idx === sel
              const rowY = TEXT_Y0 + i * ROW_H
              const isDir = entry.isDir
              return (
                <div
                  key={`${entry.name}-${i}`}
                  onClick={() => setSel(idx)}
                  onDoubleClick={() => (isDir ? openDir(entry.name) : undefined)}
                  style={{ position: 'absolute', left: 0, right: 0, top: rowY, height: ROW_H, cursor: 'pointer' }}
                >
                  {isSel ? (
                    <div style={{ position: 'absolute', left: VISIBLE_X0, top: 0, width: VISIBLE_X1 - VISIBLE_X0, height: ROW_H, background: '#7f7f7f' }} />
                  ) : null}
                  <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: 0, height: ROW_H, lineHeight: `${ROW_H}px`, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', color: isDir ? '#ffd866' : '#fff' }}>
                    {isDir ? '[DIR] ' : ''}
                    {entry.name}
                  </div>
                </div>
              )
            })}

            {entries === null && !loadError ? (
              <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: TEXT_Y0, fontSize: 13, color: '#8a8a8a' }}>** loading **</div>
            ) : null}
            {entries !== null && entries.length === 0 ? (
              <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: TEXT_Y0, fontSize: 13, color: '#8a8a8a' }}>** empty directory **</div>
            ) : null}
            {loadError ? (
              <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: TEXT_Y0, fontSize: 13, color: '#ff6b6b' }}>** cannot read directory **</div>
            ) : null}

            {/* Scrollbar */}
            {entries && entries.length > LIST_ENTRIES ? (
              <div style={{ position: 'absolute', left: VISIBLE_X1 - 12, top: 52, width: 12, height: SEPARATOR_Y - 52, background: '#3f3f3f' }}>
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    width: 12,
                    top: (start / entries.length) * (SEPARATOR_Y - 52 - 24),
                    height: Math.max(24, (LIST_ENTRIES / entries.length) * (SEPARATOR_Y - 52)),
                    background: '#7f7f7f'
                  }}
                />
              </div>
            ) : null}
          </div>

          {/* Boxart */}
          {selected && !selected.isDir ? (
            <div
              style={{
                position: 'absolute',
                left: box.x,
                top: box.y,
                width: box.w,
                height: box.h,
                border: '1px solid rgba(255,255,255,0.35)',
                background: '#000',
                overflow: 'hidden'
              }}
            >
              {boxart ? (
                <img src={boxart} alt="" style={{ width: box.w, height: box.h, objectFit: 'contain', imageRendering: 'pixelated' }} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#3f3f3f', fontSize: 12 }}>NO ART</div>
              )}
            </div>
          ) : null}

          {/* Description */}
          {selected && selected.description ? (
            <div
              style={{
                position: 'absolute',
                left: VISIBLE_X0 + 10,
                right: VISIBLE_X0 + 10,
                top: SEPARATOR_Y - 24,
                fontSize: 11,
                lineHeight: '16px',
                height: 20,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                color: '#a0a0a0'
              }}
            >
              {selected.description}
            </div>
          ) : null}

          {/* Footer / info bar */}
          <div style={{ position: 'absolute', left: 0, top: SEPARATOR_Y, width: SCREEN_W, height: SCREEN_H - SEPARATOR_Y }}>
            <div style={{ position: 'absolute', left: VISIBLE_X0, right: VISIBLE_X0, top: 0, height: 1, background: '#3f3f3f' }} />
            {selected ? (
              <>
                <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: 10, right: VISIBLE_X0 + 10, fontSize: 14, fontWeight: 700, color: selected.isDir ? '#ffd866' : '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {selected.name}
                  {selected.isDir ? '  (Directory)' : ''}
                </div>
                {!selected.isDir ? (
                  <>
                    <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: 34, right: VISIBLE_X0 + 10, fontSize: 12, color: '#cfcfcf', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {selected.kind === 'n64'
                        ? `Title: ${selected.title ?? '?'}   Code: ${selected.gameCode ?? '?'}   Region: ${selected.region ?? '?'}`
                        : `Type: ${entryType(selected)}`}
                    </div>
                    <div style={{ position: 'absolute', right: VISIBLE_X0 + 10, top: 10, fontSize: 12, color: '#8a8a8a' }}>{menuSize(selected.size)}</div>
                  </>
                ) : (
                  <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: 34, fontSize: 12, color: '#8a8a8a' }}>A / Enter: open</div>
                )}
              </>
            ) : (
              <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: 10, fontSize: 12, color: '#8a8a8a' }}>A / Enter: open   B / Backspace: up</div>
            )}
          </div>

          {/* CRT scanlines */}
          <div
            className="pointer-events-none"
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0 1px, transparent 1px 3px), radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.35) 100%)'
            }}
          />
        </div>
      </div>
    </div>
  )
}
