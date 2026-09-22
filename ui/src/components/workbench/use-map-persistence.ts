import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react"
import { toast } from "sonner"

import type { SpecMap, WorkbenchConfig } from "@/types"
import { saveSpecPageMap } from "./workbench-api"

type UseMapPersistenceOptions = {
  config: WorkbenchConfig | null
  specMap: SpecMap | null
  setConfig: Dispatch<SetStateAction<WorkbenchConfig | null>>
  setSpecMap: Dispatch<SetStateAction<SpecMap | null>>
}

type MapPersistence = {
  activeSaveRef: MutableRefObject<Promise<boolean> | null>
  dirty: boolean
  dirtyRef: MutableRefObject<boolean>
  markDirty: () => void
  resetPersistence: (config: WorkbenchConfig | null) => void
  saveError: string
  saveMap: (announce?: boolean) => Promise<boolean>
  saving: boolean
}

export function useMapPersistence({
  config,
  specMap,
  setConfig,
  setSpecMap,
}: UseMapPersistenceOptions): MapPersistence {
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const canSaveRef = useRef(false)
  const dirtyRef = useRef(false)
  const mapEditRevisionRef = useRef(0)
  const mapFileRevisionRef = useRef("")
  const specMapRef = useRef<SpecMap | null>(null)
  const activeSaveRef = useRef<Promise<boolean> | null>(null)

  useEffect(() => {
    specMapRef.current = specMap
  }, [specMap])

  useEffect(() => {
    canSaveRef.current = Boolean(config?.canSaveSpecMap)
    if (config?.mapRevision) mapFileRevisionRef.current = config.mapRevision
  }, [config?.canSaveSpecMap, config?.mapRevision])

  const resetPersistence = useCallback((nextConfig: WorkbenchConfig | null) => {
    canSaveRef.current = Boolean(nextConfig?.canSaveSpecMap)
    dirtyRef.current = false
    mapEditRevisionRef.current = 0
    mapFileRevisionRef.current = nextConfig?.mapRevision || ""
    specMapRef.current = nextConfig?.specMap || null
    activeSaveRef.current = null
    setDirty(false)
    setSaving(false)
    setSaveError("")
  }, [])

  const markDirty = useCallback(() => {
    mapEditRevisionRef.current += 1
    dirtyRef.current = true
    setDirty(true)
    setSaveError("")
  }, [])

  const saveMap = useCallback((announce = false): Promise<boolean> => {
    if (activeSaveRef.current) return activeSaveRef.current
    const snapshot = specMapRef.current
    if (!canSaveRef.current || !dirtyRef.current || !snapshot) {
      return Promise.resolve(true)
    }
    const savedRevision = mapEditRevisionRef.current
    const payload = { baseRevision: mapFileRevisionRef.current, specMap: snapshot }
    setSaving(true)
    setSaveError("")

    const task = (async () => {
      try {
        const result = await saveSpecPageMap(payload)
        mapFileRevisionRef.current = result.mapRevision
        setConfig((current) => current ? {
          ...current,
          mapRevision: result.mapRevision,
          reviewBaseline: result.reviewBaseline,
        } : current)
        if (mapEditRevisionRef.current === savedRevision) {
          const savedMap = { ...snapshot, updatedAt: result.updatedAt }
          specMapRef.current = savedMap
          dirtyRef.current = false
          setSpecMap(savedMap)
          setDirty(false)
        }
        if (announce) toast.success("映射已自动保存")
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : "保存失败"
        dirtyRef.current = true
        setDirty(true)
        setSaveError(message)
        toast.error(`自动保存失败：${message}`)
        return false
      } finally {
        activeSaveRef.current = null
        setSaving(false)
      }
    })()
    activeSaveRef.current = task
    return task
  }, [setConfig, setSpecMap])

  useEffect(() => {
    if (!dirty || !config?.canSaveSpecMap || saving || saveError) return
    const timeout = window.setTimeout(() => {
      void saveMap(false)
    }, 650)
    return () => window.clearTimeout(timeout)
  }, [config?.canSaveSpecMap, dirty, saveError, saveMap, saving, specMap])

  return {
    activeSaveRef,
    dirty,
    dirtyRef,
    markDirty,
    resetPersistence,
    saveError,
    saveMap,
    saving,
  }
}
