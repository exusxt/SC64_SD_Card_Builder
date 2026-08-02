import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppEvent,
  AppSettings,
  DriveInfo,
  EmulatorsInfo,
  FormatResult,
  MenuReleaseInfo,
  MetadataReleaseInfo,
  PrepareMode,
  StepState
} from '../../shared/types'
import { DEFAULT_SETTINGS, applyTheme } from './lib'
import { useT } from './i18n'
import { Header } from './components/Header'
import { TitleBar } from './components/TitleBar'
import { Stepper } from './components/Stepper'
import { DestinationStep } from './components/DestinationStep'
import { OptionsStep } from './components/OptionsStep'
import { RunStep, LogEntry } from './components/RunStep'
import { UpdateToast, UpdateState } from './components/UpdateToast'
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
  const [maximized, setMaximized] = useState(false)
  const [preparedCount, setPreparedCount] = useState<{ files: number; bytes: number } | null>(null)
  const [running, setRunning] = useState<'prepare' | 'format' | null>(null)
  const [progress, setProgress] = useState<{ value: number; max: number; label?: string } | null>(null)
  const [steps, setSteps] = useState<StepState[]>([])
  const [log, setLog] = useState<LogEntry[]>([])
  const [result, setResult] = useState<{ kind: 'prepare' | 'format'; ok: boolean; message: string } | null>(null)
  const [formatResult, setFormatResult] = useState<FormatResult | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const updateTimer = useRef<number | null>(null)
  const loadedRef = useRef(false)

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

  const hasAnyAction =
    settings.downloadMenu ||
    settings.downloadMetadata ||
    settings.createFolders ||
    settings.downloadEmulators ||
    (settings.copyRoms && settings.romSources.length > 0 && (settings.copyAllTypes || Object.values(settings.romTypes).some(Boolean)))

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
      fullFormat: settings.formatOptions.fullFormat,
      mountpoint: selectedDrive.mountpoint,
      locale: settings.language
    })
    setFormatResult(res)
    setResult({ kind: 'format', ok: res.ok, message: res.message })
    setRunning(null)
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
      copyRoms: settings.copyRoms,
      romSources: settings.romSources,
      romTypes,
      createSaves: settings.createSaves,
      includeSubdirs: settings.includeSubdirs,
      overwrite: settings.overwrite,
      verify: settings.verify
    })
    setResult({ kind: 'prepare', ok: res.ok, message: res.summary })
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

  const choosePreparedFolder = async (): Promise<void> => {
    const dir = await window.api.chooseFolder()
    if (dir) setSettings((s) => ({ ...s, preparedSource: dir }))
  }

  const patchSettings = (patch: Partial<AppSettings>): void => {
    setSettings((s) => ({ ...s, ...patch }))
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TitleBar
        t={t}
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

      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-y-auto px-6 pb-6 pt-5">
        <Header t={t} menu={menu} metadata={metadata} isAdmin={isAdmin} />
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
              onSettingsChange={patchSettings}
              onAddSources={() => void addRomSources()}
              onRemoveSource={(p) => setSettings((s) => ({ ...s, romSources: s.romSources.filter((x) => x !== p) }))}
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
            />
          ) : null}
        </main>

        <footer className="mt-6 flex items-center justify-between border-t border-sc64-border pt-4">
          <div className="truncate text-[11px] text-sc64-muted">
            {t('run.destination')}:{' '}
            <span className="font-mono text-sc64-accent">{destination || t('dest.notSelected')}</span>
          </div>
          <div className="flex items-center gap-2">
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
    </div>
  )
}
