import { useCallback, useEffect, useRef, useState } from 'react'
import { Shuffle } from 'lucide-react'
import type {
  AppEvent,
  AppSettings,
  CardInspection,
  DdIplValidation,
  DriveInfo,
  EmulatorsInfo,
  FormatResult,
  MenuReleaseInfo,
  MetadataReleaseInfo,
  PrepareMode,
  StepState
} from '../../shared/types'
import { DEFAULT_SETTINGS, applyTheme, isGalleryTheme, THEMES } from './lib'
import { BACKGROUNDS } from './backgrounds'
import { useT } from './i18n'
import { Header } from './components/Header'
import { TitleBar } from './components/TitleBar'
import { Stepper } from './components/Stepper'
import { DestinationStep } from './components/DestinationStep'
import { OptionsStep } from './components/OptionsStep'
import { RunStep, LogEntry } from './components/RunStep'
import { UpdateToast, UpdateState } from './components/UpdateToast'
import { MenuPreview } from './components/MenuPreview'
import { Button } from './components/ui'

let logId = 0

export default function App(): React.JSX.Element {
  const [step, setStep] = useState(1)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [drivesLoading, setDrivesLoading] = useState(false)
  const [menu, setMenu] = useState<MenuReleaseInfo | null>(null)
  const [metadata, setMetadata] = useState<MetadataReleaseInfo | null>(null)
  const [emulators, setEmulators] = useState<EmulatorsInfo | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminRequesting, setAdminRequesting] = useState(false)
  const [version, setVersion] = useState('')
  const [maximized, setMaximized] = useState(false)
  const [preparedCount, setPreparedCount] = useState<{ files: number; bytes: number } | null>(null)
  const [inspection, setInspection] = useState<CardInspection | null>(null)
  const [inspectionLoading, setInspectionLoading] = useState(false)
  const [inspectionNonce, setInspectionNonce] = useState(0)
  const [ddiplValidation, setDdiplValidation] = useState<DdIplValidation | null>(null)
  const [running, setRunning] = useState<'prepare' | 'format' | null>(null)
  const [progress, setProgress] = useState<{ value: number; max: number; label?: string } | null>(null)
  const [steps, setSteps] = useState<StepState[]>([])
  const [log, setLog] = useState<LogEntry[]>([])
  const [result, setResult] = useState<{ kind: 'prepare' | 'format'; ok: boolean; message: string; report?: { html: string; csv: string } | null } | null>(null)
  const [formatResult, setFormatResult] = useState<FormatResult | null>(null)
  const [previewRoot, setPreviewRoot] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const updateTimer = useRef<number | null>(null)
  const loadedRef = useRef(false)
  const [galleryBg, setGalleryBg] = useState<string | null>(null)

  const t = useT(settings.language)

  useEffect(() => {
    return () => {
      if (updateTimer.current !== null) window.clearTimeout(updateTimer.current)
    }
  }, [])

  const handleEvent = useCallback((ev: AppEvent): void => {
    if (ev.type === 'log') {
      setLog((l) => [...l.slice(-250), { id: ++logId, level: ev.level, message: ev.message }])
    } else if (ev.type === 'step') {
      setSteps((s) => {
        const idx = s.findIndex((x) => x.id === ev.step.id)
        if (idx === -1) return [...s, ev.step]
        const copy = [...s]
        copy[idx] = ev.step
        return copy
      })
    } else if (ev.type === 'progress') {
      setProgress({ value: ev.value, max: ev.max, label: ev.label })
    } else if (ev.type === 'done') {
      setResult({ kind: ev.scope, ok: true, message: ev.summary })
      if (ev.scope === 'format') setFormatResult({ ok: true, message: ev.summary })
      setRunning(null)
    } else if (ev.type === 'error') {
      setLog((l) => [...l.slice(-250), { id: ++logId, level: 'error', message: ev.message }])
      setResult({ kind: ev.scope, ok: false, message: ev.message })
      if (ev.scope === 'format') setFormatResult({ ok: false, message: ev.message })
      setRunning(null)
    } else if (ev.type === 'update') {
      if (updateTimer.current !== null) {
        window.clearTimeout(updateTimer.current)
        updateTimer.current = null
      }
      setUpdate({ state: ev.state, version: ev.version, percent: ev.percent, message: ev.message })
      if (ev.state === 'not-available') {
        updateTimer.current = window.setTimeout(() => setUpdate(null), 4000)
      }
    }
  }, [])

  useEffect(() => {
    let mounted = true
    void (async () => {
      const [s, admin, winMax] = await Promise.all([window.api.getSettings(), window.api.isAdmin(), window.api.windowIsMaximized()])
      if (!mounted) return
      setSettings({ ...DEFAULT_SETTINGS, ...s })
      setIsAdmin(admin)
      setMaximized(winMax)
      window.api.getVersion().then(setVersion).catch(() => undefined)
      loadedRef.current = true
    })()
    void refreshDrives()
    window.api.getMenuRelease().then(setMenu).catch(() => undefined)
    window.api.getMetadataRelease().then(setMetadata).catch(() => undefined)
    window.api.getEmulatorsInfo().then(setEmulators).catch(() => undefined)
    const offEvent = window.api.onEvent(handleEvent)
    const offMax = window.api.onWindowMaximized(setMaximized)
    return () => {
      mounted = false
      offEvent()
      offMax()
    }
  }, [handleEvent])

  useEffect(() => {
    applyTheme(settings.theme)
  }, [settings.theme])

  // Gallery themes: pick a fresh random background on startup and whenever the
  // theme is (re)selected.
  useEffect(() => {
    if (!isGalleryTheme(settings.theme)) {
      setGalleryBg(null)
      return
    }
    setGalleryBg(BACKGROUNDS.length > 0 ? BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)] : null)
  }, [settings.theme])

  useEffect(() => {
    if (!settings.preparedSource) {
      setPreparedCount(null)
      return
    }
    let mounted = true
    void window.api.countPreparedFolder(settings.preparedSource).then((res) => {
      if (mounted) setPreparedCount(res)
    })
    return () => {
      mounted = false
    }
  }, [settings.preparedSource])

  const refreshDrives = useCallback(async () => {
    setDrivesLoading(true)
    try {
      const d = await window.api.listDrives()
      setDrives(d)
      setInspectionNonce((n) => n + 1)
    } catch {
      setDrives([])
    } finally {
      setDrivesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!loadedRef.current) return
    void window.api.saveSettings(settings)
  }, [settings])

  const selectedDrive = drives.find((d) => d.id === settings.driveId) ?? null
  const destination = settings.destinationMode === 'drive' ? (selectedDrive?.mountpoint ?? '') : (settings.folder ?? '')

  useEffect(() => {
    if (!destination) {
      setInspection(null)
      setInspectionLoading(false)
      return
    }
    let mounted = true
    setInspectionLoading(true)
    void window.api
      .inspectCard(destination)
      .then((res) => {
        if (!mounted) return
        setInspection(res)
        setInspectionLoading(false)
      })
      .catch(() => {
        if (mounted) {
          setInspection(null)
          setInspectionLoading(false)
        }
      })
    return () => {
      mounted = false
    }
  }, [destination, inspectionNonce])

  useEffect(() => {
    if (!settings.ddiplSource) {
      setDdiplValidation(null)
      return
    }
    let mounted = true
    void window.api
      .validateDDIPL(settings.ddiplSource)
      .then((res) => {
        if (mounted) setDdiplValidation(res)
      })
      .catch(() => {
        if (mounted) setDdiplValidation(null)
      })
    return () => {
      mounted = false
    }
  }, [settings.ddiplSource])

  const hasAnyAction =
    settings.downloadMenu ||
    settings.downloadMetadata ||
    settings.createFolders ||
    settings.downloadEmulators ||
    (settings.installDDIPL && settings.ddiplSource !== null) ||
    (settings.copyRoms && settings.romSources.length > 0 && (settings.copyAllTypes || Object.values(settings.romTypes).some(Boolean))) ||
    (settings.copyRoms && settings.archiveSources.length > 0)

  const canProceedTo2 = destination.trim().length > 0
  const canProceedTo3 = hasAnyAction || settings.preparedSource !== null

  const runFormat = async (): Promise<void> => {
    if (!selectedDrive) return
    if (!isAdmin) {
      await window.api.relaunchAdmin()
      return
    }
    setRunning('format')
    setResult(null)
    setFormatResult(null)
    setLog([])
    setSteps([])
    setProgress(null)
    const res = await window.api.format({
      device: selectedDrive.device,
      size: selectedDrive.size,
      label: settings.volumeLabel || 'SUMMERCART',
      filesystem: settings.formatOptions.filesystem,
      fullFormat: settings.formatOptions.fullFormat,
      mountpoint: selectedDrive.mountpoint,
      locale: settings.language
    })
    setFormatResult(res)
    setResult({ kind: 'format', ok: res.ok, message: res.message })
    setRunning(null)
    await refreshDrives()
  }

  const requestAdmin = async (): Promise<void> => {
    if (isAdmin || adminRequesting) return
    setAdminRequesting(true)
    try {
      await window.api.relaunchAdmin()
    } finally {
      setAdminRequesting(false)
    }
  }

  const runPrepare = async (): Promise<void> => {
    if (!destination) return
    const mode: PrepareMode = settings.preparedSource ? 'fromPrepared' : settings.stage ? 'staged' : 'direct'
    setRunning('prepare')
    setResult(null)
    setLog([])
    setSteps([])
    setProgress(null)
    const romTypes = (Object.entries(settings.romTypes) as Array<[string, boolean]>)
      .filter(([, v]) => v)
      .map(([k]) => k)
    const res = await window.api.prepare({
      destination,
      locale: settings.language,
      mode,
      preparedSource: settings.preparedSource ?? undefined,
      downloadMenu: settings.downloadMenu,
      downloadMetadata: settings.downloadMetadata,
      createFolders: settings.createFolders,
      downloadEmulators: settings.downloadEmulators,
      emulators: settings.emulators,
      installDDIPL: settings.installDDIPL,
      ddiplSource: settings.ddiplSource ?? undefined,
      copyRoms: settings.copyRoms,
      romSources: settings.romSources,
      archiveSources: settings.archiveSources,
      romTypes,
      createSaves: settings.createSaves,
      includeSubdirs: settings.includeSubdirs,
      overwrite: settings.overwrite,
      verify: settings.verify,
      organizeRoms: settings.organizeRoms,
      copyCheats: settings.copyCheats
    })
    setResult({ kind: 'prepare', ok: res.ok, message: res.summary, report: res.report })
    setRunning(null)
  }

  const cancelRun = (): void => {
    if (running === 'prepare') window.api.cancelPrepare()
    else if (running === 'format') window.api.cancelFormat()
  }

  const addRomSources = async (): Promise<void> => {
    const dirs = await window.api.chooseFolders()
    if (dirs.length === 0) return
    setSettings((s) => ({
      ...s,
      romSources: Array.from(new Set([...s.romSources, ...dirs]))
    }))
  }

  const addArchiveSources = async (): Promise<void> => {
    const files = await window.api.chooseArchives()
    if (files.length === 0) return
    setSettings((s) => ({
      ...s,
      archiveSources: Array.from(new Set([...s.archiveSources, ...files]))
    }))
  }

  const addDropped = async (paths: string[]): Promise<void> => {
    const classified = await window.api.classifyDropped(paths)
    setSettings((s) => {
      const next = { ...s }
      if (classified.folders.length > 0) {
        next.romSources = Array.from(new Set([...s.romSources, ...classified.folders]))
      }
      if (classified.archives.length > 0) {
        next.archiveSources = Array.from(new Set([...s.archiveSources, ...classified.archives]))
      }
      return next
    })
  }

  const choosePreparedFolder = async (): Promise<void> => {
    const dir = await window.api.chooseFolder()
    if (dir) setSettings((s) => ({ ...s, preparedSource: dir }))
  }

  const chooseDDIPLFolder = async (): Promise<void> => {
    const dir = await window.api.chooseFolder()
    if (dir) setSettings((s) => ({ ...s, ddiplSource: dir }))
  }

  const patchSettings = (patch: Partial<AppSettings>): void => {
    setSettings((s) => ({ ...s, ...patch }))
  }

  const shuffleBg = (): void => {
    setGalleryBg((prev) => {
      if (BACKGROUNDS.length === 0) return prev
      if (BACKGROUNDS.length === 1) return BACKGROUNDS[0]
      let next = prev
      while (next === prev) {
        next = BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)]
      }
      return next
    })
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault()
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.api.getPathForFile(f))
      .filter((p): p is string => Boolean(p))
    if (paths.length === 0) return
    await addDropped(paths)
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden" onDragOver={(e) => e.preventDefault()} onDrop={(e) => void handleDrop(e)}>
      {isGalleryTheme(settings.theme) && galleryBg ? (
        <>
          <img
            src={galleryBg}
            alt=""
            className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
          />
          <div
            className="pointer-events-none absolute inset-0 z-0"
            style={{ background: THEMES[settings.theme].vars['--sc64-gallery-overlay'] }}
          />
        </>
      ) : null}

      <div className="relative z-40 shrink-0">
        <TitleBar
          t={t}
          version={version}
          theme={settings.theme}
          language={settings.language}
          maximized={maximized}
          updateState={update?.state ?? null}
          onThemeChange={(theme) => patchSettings({ theme })}
          onLanguageChange={(language) => patchSettings({ language })}
          onCheckForUpdates={() => void window.api.checkForUpdates()}
          onMinimize={() => void window.api.windowMinimize()}
          onToggleMaximize={() => void window.api.windowToggleMaximize().then(setMaximized)}
          onClose={() => void window.api.windowClose()}
        />
      </div>

      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-y-auto px-6 pb-6 pt-5">
        <Header t={t} menu={menu} metadata={metadata} isAdmin={isAdmin} onRequestAdmin={() => void requestAdmin()} adminRequesting={adminRequesting} onPreview={() => destination && setPreviewRoot(destination)} canPreview={destination.trim().length > 0} />
        <Stepper t={t} step={step} onNavigate={setStep} locked={running !== null} />

        <main className="flex-1">
          {step === 1 ? (
            <DestinationStep
              t={t}
              settings={settings}
              drives={drives}
              drivesLoading={drivesLoading}
              destination={destination}
              preparedCount={preparedCount}
              inspection={inspection}
              inspectionLoading={inspectionLoading}
              latestMenuTag={menu?.tag ?? null}
              onSettingsChange={patchSettings}
              onRefreshDrives={() => void refreshDrives()}
              onChoosePreparedFolder={() => void choosePreparedFolder()}
              formatBusy={running === 'format'}
              formatProgress={progress}
              formatResult={formatResult}
              onFormat={() => void runFormat()}
              onCancelFormat={cancelRun}
              onReveal={() => destination && void window.api.reveal(destination)}
            />
          ) : null}

          {step === 2 ? (
            <OptionsStep
              t={t}
              settings={settings}
              menu={menu}
              metadata={metadata}
              emulators={emulators}
              ddiplValidation={ddiplValidation}
              onSettingsChange={patchSettings}
              onAddSources={() => void addRomSources()}
              onRemoveSource={(p) => setSettings((s) => ({ ...s, romSources: s.romSources.filter((x) => x !== p) }))}
              onAddArchives={() => void addArchiveSources()}
              onRemoveArchive={(p) => setSettings((s) => ({ ...s, archiveSources: s.archiveSources.filter((x) => x !== p) }))}
              onChooseDDIPL={() => void chooseDDIPLFolder()}
            />
          ) : null}

          {step === 3 ? (
            <RunStep
              t={t}
              settings={settings}
              destination={destination}
              preparedCount={preparedCount}
              running={running}
              progress={progress}
              steps={steps}
              log={log}
              result={result}
              onRun={() => void runPrepare()}
              onCancel={cancelRun}
              onGoBack={() => setStep(2)}
              onPreview={() => destination && setPreviewRoot(destination)}
            />
          ) : null}
        </main>

        <footer className="mt-6 flex items-center justify-between border-t border-sc64-border pt-4">
          <div className="truncate text-[11px] text-sc64-muted">
            {t('run.destination')}:{' '}
            <span className="font-mono text-sc64-accent">{destination || t('dest.notSelected')}</span>
          </div>
          <div className="flex items-center gap-2">
            {isGalleryTheme(settings.theme) ? (
              <Button variant="outline" size="sm" onClick={shuffleBg} title={t('theme.shuffleBg')}>
                <Shuffle className="h-3.5 w-3.5" /> {t('theme.shuffleBg')}
              </Button>
            ) : null}
            {step === 2 ? (
              <Button variant="ghost" onClick={() => setStep(1)} disabled={running !== null}>
                ← {t('common.back')}
              </Button>
            ) : null}
            {step === 1 ? (
              <Button variant="primary" onClick={() => setStep(2)} disabled={!canProceedTo2}>
                {t('common.continue')} →
              </Button>
            ) : null}
            {step === 2 ? (
              <Button variant="primary" onClick={() => setStep(3)} disabled={!canProceedTo3}>
                {t('common.continue')} →
              </Button>
            ) : null}
          </div>
        </footer>
      </div>

      {update ? (
        <UpdateToast
          t={t}
          update={update}
          onDismiss={() => setUpdate(null)}
          onInstall={() => void window.api.installUpdate()}
        />
      ) : null}

      {previewRoot ? <MenuPreview t={t} root={previewRoot} onClose={() => setPreviewRoot(null)} /> : null}
    </div>
  )
}
