/**
 * Full-screen, faithful emulation of the N64FlashcartMenu file browser opened
 * from the run summary. Draws a 640x480 CRT-styled screen with cursor-key and
 * mouse-wheel navigation (wrap-around, centered scrolling), folder navigation
 * with selection history, boxart plus an N64 description in the footer, random
 * bundled backgrounds, and a scrollbar. Three tabs mirror the console menu:
 * File Browser, Favorites and History. Favorites/history keys are persisted in
 * settings as `<root>\u0000<relative path>`; entries are materialized back into
 * preview rows via window.api.resolvePreviewEntry. The card root is passed in as
 * `root` and all directory/boxart reads go through window.api.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { PreviewEntry } from '../../../shared/types'
import type { T } from '../i18n'
import { BACKGROUNDS } from '../backgrounds'
import { Button } from './ui'
import { moveSelection, restoreSelection, SelectionHistory, nextBackgroundIndex } from '../lib'

// Coordinates of the emulated 640x480 screen. SEPARATOR_Y splits the list area
// (file rows) from the footer (info bar); LIST_ENTRIES is how many rows fit in
// the list, so scrolling windows are sized against it; TEXT_Y0 is the y of the
// first row, and each following row steps down by ROW_H.
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

type PreviewTab = 'browser' | 'favorites' | 'history'

/** Favorites/history keys are `<root>\u0000<rel>`; splits them back apart. */
function parsePreviewKey(key: string): { root: string; rel: string } {
  const i = key.indexOf('\u0000')
  if (i === -1) return { root: '', rel: key }
  return { root: key.slice(0, i), rel: key.slice(i + 1) }
}

/** Formats a file size the way the console menu does: kB/MB/GB with floor division. */
function menuSize(size: number): string {
  if (size < 0) return 'unknown'
  if (size === 0) return 'empty'
  if (size < 8 * 1024) return `${size} B`
  if (size < 4 * 1024 * 1024) return `${Math.floor(size / 1024)} kB`
  if (size < 1024 * 1024 * 1024) return `${Math.floor(size / 1024 / 1024)} MB`
  return `${Math.floor(size / 1024 / 1024 / 1024)} GB`
}

/** Labels an entry for the footer info line: directories, recognized ROM kinds, or raw file. */
function entryType(e: PreviewEntry): string {
  if (e.isDir) return 'Directory'
  if (e.kind === 'n64') return 'N64 ROM'
  if (e.kind === 'dd') return '64DD disk'
  if (e.kind === 'gb' || e.kind === 'gbc') return 'Game Boy / Color ROM'
  if (e.kind === 'snes') return 'SNES ROM'
  if (e.kind === 'sms' || e.kind === 'gg') return 'Sega ROM'
  const ext = e.name.slice(e.name.lastIndexOf('.')).toLowerCase()
  if (EMULATOR_EXTS.has(ext)) return 'Emulator ROM file'
  return 'File'
}

/**
 * MenuPreview overlay. Owns the emulated screen state (current directory, entry
 * list, selection, boxart, scale) and forwards onClose to unmount itself. All
 * file-system access is delegated to the main process via the preload API.
 * Favorites/history are read from settings props and mutated through the
 * onToggleFavorite/onAddHistory/onRemoveFromList callbacks.
 */
export function MenuPreview({
  t,
  root,
  favorites,
  history,
  onToggleFavorite,
  onAddHistory,
  onRemoveFromList,
  onClose
}: {
  t: T
  root: string
  favorites: string[]
  history: string[]
  onToggleFavorite: (key: string) => void
  onAddHistory: (key: string) => void
  onRemoveFromList: (kind: 'favorites' | 'history', key: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [tab, setTab] = useState<PreviewTab>('browser')
  const [dirRel, setDirRel] = useState('')
  const [entries, setEntries] = useState<PreviewEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sel, setSel] = useState(0)
  const [boxart, setBoxart] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [bgUrl, setBgUrl] = useState<string | null>(null)
  const [resolvedSel, setResolvedSel] = useState<PreviewEntry | null>(null)
  const prevSelectedRef = useRef<string | null>(null)
  // Last background index drawn, so the next one is different (see nextBackgroundIndex).
  const bgIdxRef = useRef(-1)
  // Remembers which row was highlighted when each folder was entered, so going
  // back up restores the folder you came from rather than jumping to the top.
  const selStackRef = useRef(new SelectionHistory())
  // Cache of favorite/history keys resolved to entries for the current root,
  // so moving through the list does not re-query the main process each time.
  const resolvedMapRef = useRef(new Map<string, PreviewEntry | null>())

  const loadDir = useCallback(
    async (rel: string, restoreSel?: number) => {
      setDirRel(rel)
      setEntries(null)
      setLoadError(null)
      try {
        const res = await window.api.listPreviewDir(root, rel)
        if (res) {
          setEntries(res)
          setSel(restoreSelection(restoreSel, res.length))
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

  // Only favorites/history entries belonging to this card root are shown.
  const favKeys = useMemo(() => favorites.filter((k) => parsePreviewKey(k).root === root), [favorites, root])
  const histKeys = useMemo(() => history.filter((k) => parsePreviewKey(k).root === root), [history, root])
  const favRelSet = useMemo(
    () => new Set(favKeys.map((k) => parsePreviewKey(k).rel)),
    [favKeys]
  )

  const listKeys = tab === 'favorites' ? favKeys : tab === 'history' ? histKeys : null
  const listLen = tab === 'browser' ? (entries?.length ?? 0) : (listKeys?.length ?? 0)
  const selected = entries && entries.length > 0 ? entries[Math.min(sel, entries.length - 1)] : null
  const selectedKey = listKeys && listKeys.length > 0 ? listKeys[Math.min(sel, listKeys.length - 1)] : null
  const selectedRel = selectedKey ? parsePreviewKey(selectedKey).rel : null
  const selectedName = selectedRel ? (selectedRel.split('/').pop() ?? selectedRel) : ''

  const keyForEntry = (entry: PreviewEntry): string => `${root}\u0000${dirRel ? `${dirRel}/${entry.name}` : entry.name}`

  // Gallery background logic: show a fresh random bundled background whenever a
  // different entry (folder or ROM) gets selected. The key combines the folder
  // path, entry kind and name so selecting a different file in the same folder
  // (or the same file after navigating away and back) still triggers a change.
  const galleryKey =
    tab === 'browser'
      ? selected
        ? `${dirRel}\u0000${selected.isDir ? 'dir' : 'file'}\u0000${selected.name}`
        : null
      : selectedKey
  useEffect(() => {
    if (!galleryKey) {
      setBgUrl(null)
      prevSelectedRef.current = null
      bgIdxRef.current = -1
      return
    }
    if (prevSelectedRef.current === galleryKey) return
    prevSelectedRef.current = galleryKey
    const idx = nextBackgroundIndex(bgIdxRef.current, BACKGROUNDS.length)
    if (idx === null) {
      setBgUrl(null)
      bgIdxRef.current = -1
    } else {
      bgIdxRef.current = idx
      setBgUrl(BACKGROUNDS[idx])
    }
  }, [galleryKey])

  // The footer/boxart entry: the browser selection in File Browser, or the
  // materialized favorite/history row in the other tabs. activeMissing marks a
  // persisted key whose file is no longer present on the card.
  const activeEntry = tab === 'browser' ? selected : resolvedSel
  const activeMissing = tab !== 'browser' && listKeys !== null && listKeys.length > 0 && !resolvedSel

  // Load the boxart for the highlighted entry. The cancellation flag drops the
  // result when the selection changed before the read finished, avoiding a
  // flicker of stale art on fast cursor movement.
  useEffect(() => {
    if (!activeEntry?.boxart) {
      setBoxart(null)
      return
    }
    let cancelled = false
    void window.api.loadPreviewBoxart(root, activeEntry.boxart).then((d) => {
      if (!cancelled) setBoxart(d)
    })
    return () => {
      cancelled = true
    }
  }, [root, activeEntry?.boxart])

  // Materialize the selected favorite/history row. Resolved entries are cached
  // per key; a null result (missing file, or still resolving) renders as activeMissing.
  useEffect(() => {
    if (tab === 'browser' || !selectedKey) {
      setResolvedSel(null)
      return
    }
    const cached = resolvedMapRef.current.get(selectedKey)
    if (cached !== undefined) {
      setResolvedSel(cached)
      return
    }
    let cancelled = false
    void window.api.resolvePreviewEntry(root, selectedRel ?? '').then((e) => {
      if (cancelled) return
      resolvedMapRef.current.set(selectedKey, e)
      setResolvedSel(e)
    })
    return () => {
      cancelled = true
    }
  }, [tab, selectedKey, selectedRel, root])

  // Clamp the selection when a list shrinks (folder loaded, entry removed, tab
  // switched) so the cursor can never point past the last row.
  useEffect(() => {
    if (listLen === 0) setSel(0)
    else if (sel > listLen - 1) setSel(listLen - 1)
  }, [listLen, sel])

  const openDir = (name: string): void => {
    // Record the current selection before leaving so a later leave() can restore it.
    selStackRef.current.enter(sel)
    void loadDir(dirRel ? `${dirRel}/${name}` : name)
  }

  const goUp = (): void => {
    // Pop the selection remembered for this folder and jump the listing back to
    // the entry that was highlighted when the folder was originally entered.
    const restore = selStackRef.current.leave()
    const idx = dirRel.lastIndexOf('/')
    void loadDir(idx === -1 ? '' : dirRel.slice(0, idx), restore)
  }

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Tab':
          e.preventDefault()
          setSel(0)
          setTab((x) => (x === 'browser' ? 'favorites' : x === 'favorites' ? 'history' : 'browser'))
          return
        case 'ArrowDown':
          e.preventDefault()
          setSel((s) => moveSelection(s, listLen, 'down'))
          return
        case 'ArrowUp':
          e.preventDefault()
          setSel((s) => moveSelection(s, listLen, 'up'))
          return
        case 'Home':
          e.preventDefault()
          setSel(0)
          return
        case 'End':
          e.preventDefault()
          setSel(Math.max(0, listLen - 1))
          return
        case 'Escape':
          e.preventDefault()
          onClose()
          return
        default:
          break
      }
      if (tab === 'browser') {
        switch (e.key) {
          case 'Enter':
          case 'ArrowRight':
            e.preventDefault()
            if (selected?.isDir) openDir(selected.name)
            else if (selected) onAddHistory(keyForEntry(selected))
            return
          case 'ArrowLeft':
          case 'Backspace':
            e.preventDefault()
            if (dirRel) goUp()
            return
          case 'f':
          case 'F':
            e.preventDefault()
            if (selected && !selected.isDir) onToggleFavorite(keyForEntry(selected))
            return
        }
      } else {
        switch (e.key) {
          case 'Enter':
          case 'ArrowRight':
            e.preventDefault()
            if (selectedKey) {
              onAddHistory(selectedKey)
              // History moves the opened entry to the front; follow it there so
              // the highlight stays on the row just opened.
              if (tab === 'history') setSel(0)
            }
            return
          case 'ArrowLeft':
          case 'Backspace':
            e.preventDefault()
            setSel(0)
            setTab('browser')
            return
          case 'Delete':
            e.preventDefault()
            if (selectedKey) onRemoveFromList(tab, selectedKey)
            return
          case 'f':
          case 'F':
            e.preventDefault()
            if (selectedKey) {
              if (tab === 'favorites') onRemoveFromList('favorites', selectedKey)
              else onToggleFavorite(selectedKey)
            }
            return
        }
      }
    },
    [entries, selected, selectedKey, listLen, tab, dirRel, onClose, loadDir, onAddHistory, onToggleFavorite, onRemoveFromList]
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

  // Centered scrolling window: keep the selection in the middle of the visible
  // rows, clamping to 0 at the top and to the last full window at the bottom so
  // the list never scrolls past an end. Everything within LIST_ENTRIES rows
  // needs no window at all.
  const start = useMemo(() => {
    if (listLen <= LIST_ENTRIES) return 0
    let s = sel - Math.floor(LIST_ENTRIES / 2)
    if (s < 0) s = 0
    if (s > listLen - LIST_ENTRIES) s = listLen - LIST_ENTRIES
    return s
  }, [listLen, sel])

  const visible =
    tab === 'browser'
      ? entries
        ? entries.slice(start, start + LIST_ENTRIES)
        : []
      : (listKeys ?? []).slice(start, start + LIST_ENTRIES)

  // Unified row model for the emulated list: browser rows carry their full
  // PreviewEntry; favorite/history rows are keys whose materialized entry (if
  // any) is only needed for the footer/boxart.
  const rows = useMemo(() => {
    if (tab === 'browser') {
      return (visible as PreviewEntry[]).map((entry, i) => ({
        key: `${entry.name}-${i}`,
        idx: start + i,
        name: entry.name,
        sub: '',
        isDir: entry.isDir,
        entry
      }))
    }
    return (visible as string[]).map((key, i) => {
      const rel = parsePreviewKey(key).rel
      const slash = rel.lastIndexOf('/')
      return {
        key,
        idx: start + i,
        name: rel.slice(slash + 1) || rel,
        sub: slash >= 0 ? rel.slice(0, slash) : '',
        isDir: false,
        entry: null as PreviewEntry | null
      }
    })
  }, [tab, visible, start])

  // Mouse wheel maps to repeated key presses with wrap-around; fast wheels move
  // up to 3 rows per tick so long lists still scroll at a usable speed.
  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    if (listLen === 0) return
    const dir: 'up' | 'down' = e.deltaY > 0 ? 'down' : 'up'
    const steps = Math.min(3, Math.max(1, Math.abs(Math.round(e.deltaY) / 40)))
    for (let i = 0; i < steps; i++) setSel((s) => moveSelection(s, listLen, dir))
  }
  const isPortrait = activeEntry?.region === 'Japan' && activeEntry.kind === 'n64'
  const box = activeEntry?.kind === 'dd' ? BOXART_DD : isPortrait ? BOXART_JP : BOXART_US
  const rootPath = dirRel ? `SD:/${dirRel}/` : 'SD:/'
  const scrollVisible = listLen > LIST_ENTRIES
  const emptyLabel =
    tab === 'favorites' ? t('preview.favoritesEmpty') : tab === 'history' ? t('preview.historyEmpty') : null

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

      <div className="overflow-hidden rounded-lg" style={{ width: SCREEN_W * scale, height: SCREEN_H * scale }} onWheel={onWheel}>
        <div
          className="relative bg-black"
          style={{ width: SCREEN_W, height: SCREEN_H, transform: `scale(${scale})`, transformOrigin: 'top left', fontFamily: MONO }}
        >
          {/* Random bundled background while a ROM is selected, darkened like the console menu */}
          {bgUrl ? (
            <img
              src={bgUrl}
              alt=""
              className="pointer-events-none"
              style={{ position: 'absolute', left: 0, top: 0, width: SCREEN_W, height: SCREEN_H, objectFit: 'cover', zIndex: 0 }}
            />
          ) : null}
          {bgUrl ? (
            <div
              className="pointer-events-none"
              style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.37)', zIndex: 0 }}
            />
          ) : null}

          {/* Tabs */}
          <div style={{ position: 'absolute', left: VISIBLE_X0, top: TAB_Y0, right: SCREEN_W - VISIBLE_X1, height: TAB_H, display: 'flex', gap: 4 }}>
            {(
              [
                { id: 'browser', label: t('preview.tabBrowser') },
                { id: 'favorites', label: t('preview.tabFavorites') },
                { id: 'history', label: t('preview.tabHistory') }
              ] as Array<{ id: PreviewTab; label: string }>
            ).map((tabDef) => (
              <div
                key={tabDef.id}
                onClick={() => {
                  setSel(0)
                  setTab(tabDef.id)
                }}
                style={{
                  flex: 1,
                  maxWidth: 190,
                  border: tab === tabDef.id ? '2px solid #fff' : '2px solid #5f5f5f',
                  background: tab === tabDef.id ? '#6f6f6f' : '#3f3f3f',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 700,
                  lineHeight: `${TAB_H - 4}px`,
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  cursor: 'pointer'
                }}
              >
                {tabDef.label}
              </div>
            ))}
          </div>

          {/* Content frame */}
          <div style={{ position: 'absolute', left: VISIBLE_X0, top: 48, right: VISIBLE_X0, bottom: SCREEN_H - SEPARATOR_Y, border: '4px solid #fff' }} />

          {/* File list */}
          <div style={{ position: 'absolute', left: 0, top: 0, width: SCREEN_W, height: SEPARATOR_Y, overflow: 'hidden' }}>
            {rows.map((row) => {
              const isSel = row.idx === sel
              const rowY = TEXT_Y0 + (row.idx - start) * ROW_H
              const isFav = !row.isDir && favRelSet.has(dirRel ? `${dirRel}/${row.name}` : row.name)
              return (
                <div
                  key={row.key}
                  onClick={() => setSel(row.idx)}
                  onDoubleClick={() => {
                    if (tab === 'browser') {
                      if (row.isDir) openDir(row.name)
                      else if (row.entry) onAddHistory(keyForEntry(row.entry))
                    } else if (selectedKey) {
                      onAddHistory(selectedKey)
                      if (tab === 'history') setSel(0)
                    }
                  }}
                  style={{ position: 'absolute', left: 0, right: 0, top: rowY, height: ROW_H, cursor: 'pointer' }}
                >
                  {isSel ? (
                    <div style={{ position: 'absolute', left: VISIBLE_X0, top: 0, width: VISIBLE_X1 - VISIBLE_X0, height: ROW_H, background: '#7f7f7f' }} />
                  ) : null}
                  <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, right: 46, top: 0, height: ROW_H, lineHeight: `${ROW_H}px`, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: row.isDir ? '#ffd866' : '#fff' }}>
                    {row.isDir ? '[DIR] ' : ''}
                    {isFav ? '* ' : ''}
                    {row.name}
                    {row.sub ? <span style={{ color: '#9f9f9f' }}>  —  {row.sub}</span> : null}
                  </div>
                </div>
              )
            })}

            {tab === 'browser' && entries === null && !loadError ? (
              <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: TEXT_Y0, fontSize: 13, color: '#fff' }}>** loading **</div>
            ) : null}
            {tab === 'browser' && entries !== null && entries.length === 0 ? (
              <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: TEXT_Y0, fontSize: 13, color: '#fff' }}>** empty directory **</div>
            ) : null}
            {tab === 'browser' && loadError ? (
              <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: TEXT_Y0, fontSize: 13, color: '#ff6b6b' }}>** cannot read directory **</div>
            ) : null}
            {tab !== 'browser' && listKeys !== null && listKeys.length === 0 ? (
              <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: TEXT_Y0, right: VISIBLE_X0 + 10, fontSize: 13, color: '#fff' }}>{emptyLabel}</div>
            ) : null}

            {/* Scrollbar */}
            {scrollVisible ? (
              <div style={{ position: 'absolute', left: VISIBLE_X1 - 12, top: 52, width: 12, height: SEPARATOR_Y - 52, background: '#3f3f3f' }}>
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    width: 12,
                    top: (start / listLen) * (SEPARATOR_Y - 52 - 24),
                    height: Math.max(24, (LIST_ENTRIES / listLen) * (SEPARATOR_Y - 52)),
                    background: '#7f7f7f'
                  }}
                />
              </div>
            ) : null}
          </div>

          {/* Boxart */}
          {activeEntry && !activeEntry.isDir ? (
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#fff', fontSize: 12 }}>NO ART</div>
              )}
            </div>
          ) : null}

          {/* Footer / info bar. Stacked inside the 80px band below SEPARATOR_Y:
              filename (top 10), title/code/region line (top 34), size (right,
              top 10) and, when present, the N64 description (top 52). The
              description is positioned relative to this footer container, not
              after the title line, because it can run to two lines and would
              otherwise push into the fixed-height footer. */}
          <div style={{ position: 'absolute', left: 0, top: SEPARATOR_Y, width: SCREEN_W, height: SCREEN_H - SEPARATOR_Y }}>
            <div style={{ position: 'absolute', left: VISIBLE_X0, right: VISIBLE_X0, top: 0, height: 1, background: '#3f3f3f' }} />
            {activeEntry ? (
              <>
                <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: 10, right: activeEntry.isDir ? VISIBLE_X0 + 10 : VISIBLE_X0 + 96, fontSize: 14, fontWeight: 700, color: activeEntry.isDir ? '#ffd866' : '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {activeEntry.name}
                  {activeEntry.isDir ? '  (Directory)' : ''}
                </div>
                {!activeEntry.isDir ? (
                  <>
                    <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: 34, right: VISIBLE_X0 + 10, fontSize: 12, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {activeEntry.kind === 'n64'
                        ? `Title: ${activeEntry.title ?? '?'}   Code: ${activeEntry.gameCode ?? '?'}   Region: ${activeEntry.region ?? '?'}`
                        : activeEntry.title
                          ? `Title: ${activeEntry.title}${activeEntry.region ? `   Region: ${activeEntry.region}` : ''}`
                          : `Type: ${entryType(activeEntry)}`}
                    </div>
                    <div style={{ position: 'absolute', right: VISIBLE_X0 + 10, top: 10, fontSize: 12, color: '#fff' }}>{menuSize(activeEntry.size)}</div>
                    {activeEntry.description ? (
                      // Clamp to two 13px lines via -webkit-line-clamp; the box has a fixed
                      // 26px height so a long description cannot grow past the footer.
                      <div
                        style={{
                          position: 'absolute',
                          left: VISIBLE_X0 + 10,
                          right: VISIBLE_X0 + 10,
                          top: 52,
                          height: 26,
                          fontSize: 11,
                          lineHeight: '13px',
                          color: '#fff',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden'
                        }}
                      >
                        {activeEntry.description}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: 34, fontSize: 12, color: '#fff' }}>A / Enter: open</div>
                )}
              </>
            ) : activeMissing ? (
              <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: 10, fontSize: 14, fontWeight: 700, color: '#ff8c6b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selectedName} — {t('preview.missing')}
              </div>
            ) : (
              <div style={{ position: 'absolute', left: VISIBLE_X0 + 10, top: 10, fontSize: 12, color: '#fff' }}>A / Enter: open   B / Backspace: up</div>
            )}
          </div>

          {/* CRT scanline overlay. Two stacked effects simulate a CRT: repeating
              horizontal lines for the scanlines and a radial vignette that keeps
              the edges dim like an old tube. pointer-events-none so it never
              swallows clicks. */}
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
