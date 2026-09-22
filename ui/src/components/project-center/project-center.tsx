import { PublicationManager } from "@/components/publication/publication-manager"
import { reopenProject as reopenPublishedProject } from "./project-center-api"
import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  FileCode2,
  FileJson2,
  FileText,
  FolderKanban,
  FolderOpen,
  HardDrive,
  Link2,
  LoaderCircle,
  MessageSquareText,
  MonitorUp,
  Plus,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { AlertDialog } from "radix-ui"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"
import type {
  DiscoveryCandidate,
  LauncherData,
  ProjectDiscovery,
  ProjectDraft,
  ProjectSourceType,
  PrdDraftJob,
  WorkbenchConfig,
} from "@/types"
import { PathPickerSheet } from "./path-picker-sheet"
import {
  confirmProject,
  dismissProjectBootstrap,
  previewProjectRemoval,
  removeProject,
  reopenProject as reopenProjectRequest,
  saveProjectDraft,
  scanProject,
  type ProjectRemovalPreview,
} from "./project-center-api"
import { useProjectionConversation } from "./use-projection-conversation"
import { usePrdDraftConversation } from "./use-prd-draft-conversation"

interface ProjectCenterProps {
  launcher: LauncherData
  onEnter: (config: WorkbenchConfig) => void
}

type View = "home" | "wizard"
type WizardStep = 1 | 2 | 3
type PickerField = "projectPath" | "htmlPath" | "prdPath" | "sourceSpecPath" | "specPath" | "mapPath"
type PickerConfig = {
  field: PickerField
  kind: "directory" | "html" | "markdown" | "json"
  title: string
  description: string
} | null

const SOURCE_OPTIONS: {
  type: ProjectSourceType
  title: string
  description: string
  icon: typeof FolderKanban
}[] = [
  {
    type: "directory",
    title: "扫描项目目录",
    description: "从一个本地项目中推荐页面、Spec 与映射文件",
    icon: FolderKanban,
  },
  {
    type: "html",
    title: "打开单个 HTML",
    description: "直接选择已经导出的页面联看包",
    icon: FileCode2,
  },
]

const WIZARD_STEPS: {
  id: WizardStep
  title: string
  description: string
}[] = [
  { id: 1, title: "选择来源", description: "告诉工具从哪里读取页面" },
  { id: 2, title: "处理扫描结果", description: "确认页面与 Spec 来源及缺失项" },
  { id: 3, title: "进入前确认", description: "选择模式并核对写入边界" },
]

const REASONING_LABELS: Record<string, string> = {
  minimal: "最少",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "最大",
  ultra: "极致",
}

const freshDraft = (
  launcher: LauncherData,
  sourceType: ProjectSourceType = "directory",
): ProjectDraft => ({
  name: "",
  projectPath: "",
  sourceType,
  htmlPath: "",
  devUrl: "",
  specPath: "",
  sourceSpecPath: "",
  prdPath: "",
  prdMapPath: "",
  mapPath: "",
  mapPolicy: launcher.defaults.mapPolicy || "tool",
  mode: launcher.defaults.mode || "map",
  initialRoute: "",
  confirmMapCreate: false,
  confirmPrdMapCreate: false,
  confirmTargetWrite: false,
})

const restoreDraft = (
  value: Partial<ProjectDraft>,
  launcher: LauncherData,
): ProjectDraft => ({
  ...freshDraft(launcher, value.sourceType || launcher.defaults.sourceType),
  ...value,
  sourceType: value.sourceType || launcher.defaults.sourceType,
  mapPolicy: value.mapPolicy || launcher.defaults.mapPolicy,
  mode: value.mode || launcher.defaults.mode,
  confirmMapCreate: false,
  confirmPrdMapCreate: false,
  confirmTargetWrite: false,
})

const concisePath = (path: string) => {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length > 4 ? `…/${parts.slice(-4).join("/")}` : path
}

const parentPath = (path: string) => {
  const normalized = path.replace(/[\\/]+$/, "")
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"))
  return index > 0 ? normalized.slice(0, index) : normalized
}

const comparableDevUrl = (value: string) =>
  value.trim().replace(/\/+$/, "").toLowerCase()

const candidateByPath = (
  candidates: DiscoveryCandidate[] | undefined,
  path: string,
) => candidates?.find((candidate) => candidate.path === path)

function CandidateSelect({
  value,
  candidates,
  placeholder,
  onChange,
}: {
  value: string
  candidates: DiscoveryCandidate[]
  placeholder: string
  onChange: (path: string) => void
}) {
  if (!candidates.length) return null
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className="h-10 w-full border border-white/8 bg-white/[0.035]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-w-[min(660px,92vw)]">
        {candidates.map((candidate) => (
          <SelectItem key={candidate.path} value={candidate.path}>
            <span className="flex min-w-0 items-center gap-2">
              {candidate.valid ? (
                <CheckCircle2 className="size-3.5 text-emerald-400" />
              ) : (
                <AlertTriangle className="size-3.5 text-amber-400" />
              )}
              <span className="truncate">{candidate.relativePath}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function StatusBadge({
  ready,
  busy = false,
  readyLabel = "已就绪",
  waitingLabel = "需要处理",
  busyLabel = "正在生成",
}: {
  ready: boolean
  busy?: boolean
  readyLabel?: string
  waitingLabel?: string
  busyLabel?: string
}) {
  return (
    <Badge
      className={cn(
        "rounded-full border px-2.5 py-1 text-[10px]",
        busy
          ? "border-sky-400/20 bg-sky-400/10 text-sky-300"
          : ready
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
          : "border-amber-400/20 bg-amber-400/10 text-amber-300",
      )}
    >
      {busy ? (
        <LoaderCircle className="mr-1 size-3 animate-spin" />
      ) : ready ? (
        <CheckCircle2 className="mr-1 size-3" />
      ) : (
        <AlertTriangle className="mr-1 size-3" />
      )}
      {busy ? busyLabel : ready ? readyLabel : waitingLabel}
    </Badge>
  )
}

function CodexThreadLink({ threadId }: { threadId: string }) {
  return (
    <Button asChild variant="outline" size="xs">
      <a href={`codex://threads/${encodeURIComponent(threadId)}`}>
        <MessageSquareText />
        在 Codex 中打开
      </a>
    </Button>
  )
}

function ResolutionPanel({
  icon,
  title,
  description,
  ready,
  busy = false,
  children,
}: {
  icon: ReactNode
  title: string
  description: string
  ready: boolean
  busy?: boolean
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-white/8 bg-white/[0.025] p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/8 bg-white/[0.04] text-emerald-300">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            <StatusBadge ready={ready} busy={busy} />
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function StepRail({
  step,
  discovery,
  ready,
  onStep,
}: {
  step: WizardStep
  discovery: ProjectDiscovery | null
  ready: boolean
  onStep: (step: WizardStep) => void
}) {
  return (
    <ol className="grid grid-cols-3 gap-2 md:grid-cols-1 md:gap-1">
      {WIZARD_STEPS.map((item) => {
        const accessible =
          item.id === 1 ||
          (item.id === 2 && Boolean(discovery)) ||
          (item.id === 3 && Boolean(discovery) && ready)
        const complete =
          item.id < step ||
          (item.id === 1 && Boolean(discovery)) ||
          (item.id === 2 && ready && step === 3)
        const active = item.id === step
        return (
          <li key={item.id}>
            <button
              type="button"
              disabled={!accessible}
              onClick={() => accessible && onStep(item.id)}
              className={cn(
                "group flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition",
                active
                  ? "border-emerald-400/25 bg-emerald-400/8"
                  : "border-transparent hover:border-white/8 hover:bg-white/[0.025]",
                !accessible && "cursor-not-allowed opacity-40",
              )}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border text-[11px] font-semibold",
                  active
                    ? "border-emerald-300 bg-emerald-300 text-slate-950"
                    : complete
                      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                      : "border-white/12 bg-white/[0.035] text-muted-foreground",
                )}
              >
                {complete && !active ? <Check className="size-3.5" /> : item.id}
              </span>
              <span className="hidden min-w-0 md:block">
                <span className={cn("block text-xs font-semibold", active && "text-emerald-200")}>
                  {item.title}
                </span>
                <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
                  {item.description}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function SourceTypeSelector({
  value,
  onChange,
}: {
  value: ProjectSourceType
  onChange: (value: ProjectSourceType) => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {SOURCE_OPTIONS.map((option) => {
        const Icon = option.icon
        const selected = option.type === value
        return (
          <button
            key={option.type}
            type="button"
            onClick={() => onChange(option.type)}
            className={cn(
              "rounded-2xl border p-4 text-left transition",
              selected
                ? "border-emerald-400/35 bg-emerald-400/8"
                : "border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]",
            )}
          >
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  "grid size-9 place-items-center rounded-xl border",
                  selected
                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                    : "border-white/8 bg-white/[0.035] text-muted-foreground",
                )}
              >
                <Icon className="size-4" />
              </span>
              {selected ? <CheckCircle2 className="size-4 text-emerald-300" /> : null}
            </div>
            <p className="mt-3 text-xs font-semibold">{option.title}</p>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              {option.description}
            </p>
          </button>
        )
      })}
    </div>
  )
}

function SummaryRow({
  icon,
  title,
  value,
  detail,
}: {
  icon: ReactNode
  title: string
  value: string
  detail: string
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl border border-white/8 bg-white/[0.025] p-3">
      <span className="grid size-9 place-items-center rounded-lg bg-white/[0.04] text-emerald-300">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {title}
        </p>
        <p className="mt-1 truncate font-mono text-xs text-foreground">{value}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

export function ProjectCenter({ launcher, onEnter }: ProjectCenterProps) {
  const bootstrap = launcher.bootstrap
  const [view, setView] = useState<View>(bootstrap ? "wizard" : "home")
  const [step, setStep] = useState<WizardStep>(bootstrap?.step || 1)
  const [draft, setDraft] = useState<ProjectDraft>(() =>
    launcher.gateSession
      ? {
          ...(bootstrap?.draft
            ? restoreDraft(bootstrap.draft, launcher)
            : launcher.lastProject
              ? restoreDraft(launcher.lastProject, launcher)
              : freshDraft(launcher)),
          mode: "map",
        }
      : bootstrap?.draft
      ? restoreDraft(bootstrap.draft, launcher)
      : launcher.lastProject
      ? restoreDraft(launcher.lastProject, launcher)
      : freshDraft(launcher),
  )
  const [recents, setRecents] = useState(launcher.recentProjects)
  const [lastProject, setLastProject] = useState(launcher.lastProject)
  const [removalPendingId, setRemovalPendingId] = useState("")
  const [removingProjectId, setRemovingProjectId] = useState("")
  const [removalPreview, setRemovalPreview] = useState<ProjectRemovalPreview | null>(null)
  const [discovery, setDiscovery] = useState<ProjectDiscovery | null>(
    bootstrap?.discovery || null,
  )
  const [picker, setPicker] = useState<PickerConfig>(null)
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [entering, setEntering] = useState(false)
  const [reopeningId, setReopeningId] = useState("")
  const [notice, setNotice] = useState(bootstrap?.notice || "")

  const devVerified =
    Boolean(discovery?.devCheck?.reachable) &&
    comparableDevUrl(discovery?.devCheck?.url || "") === comparableDevUrl(draft.devUrl)
  const targetCandidate = candidateByPath(discovery?.html, draft.htmlPath)
  const targetReady = draft.sourceType === "dev"
    ? Boolean(draft.devUrl.trim()) && devVerified
    : Boolean(draft.htmlPath.trim()) && targetCandidate?.valid !== false
  const specCandidate = candidateByPath(discovery?.spec, draft.specPath)
  const specReady = Boolean(draft.specPath.trim()) && specCandidate?.valid !== false
  const sourceSpecCandidate = candidateByPath(discovery?.specSource, draft.sourceSpecPath)
  const sourceSpecReady =
    Boolean(draft.sourceSpecPath.trim()) && sourceSpecCandidate?.valid !== false
  const prdCandidate = candidateByPath(discovery?.prd, draft.prdPath)
  const prdReady = Boolean(draft.prdPath.trim()) && prdCandidate?.valid === true
  const prdMapCandidate = candidateByPath(discovery?.prdMap, draft.prdMapPath)
  const prdMapReady = !prdReady || (
    Boolean(draft.prdMapPath.trim()) && prdMapCandidate?.valid !== false
  ) || Boolean(draft.confirmPrdMapCreate)
  const mapCandidate = candidateByPath(discovery?.map, draft.mapPath)
  const invalidMapCandidates = discovery?.map.filter((candidate) => !candidate.valid) || []
  const hasInvalidMapOnly =
    invalidMapCandidates.length > 0 &&
    !discovery?.map.some((candidate) => candidate.valid)
  const mapReady =
    (draft.mapPolicy === "tool" && specReady && Boolean(draft.confirmMapCreate)) ||
    (draft.mapPolicy === "existing" && Boolean(draft.mapPath.trim()) && mapCandidate?.valid !== false) ||
    (draft.mapPolicy === "project" && Boolean(draft.confirmTargetWrite))
  const sourcesReady = targetReady && (prdReady || specReady) && (!sourceSpecReady || specReady) && (!specReady || mapReady) && prdMapReady
  const needsPrdDraft = Boolean(prdCandidate && !prdCandidate.valid)

  const handlePrdDraftCompleted = useCallback(async (job: PrdDraftJob) => {
    const nextDraft = {
      ...draft,
      prdPath: job.draftPath,
      prdMapPath: "",
      confirmPrdMapCreate: false,
    }
    const nextDiscovery = await scanProject(nextDraft)
    const generatedCandidate = candidateByPath(nextDiscovery.prd, job.draftPath)
    if (!generatedCandidate?.valid) {
      throw new Error("草稿任务已完成，但重新扫描没有识别到可绑定的 PRD")
    }
    setDiscovery(nextDiscovery)
    setDraft((current) => ({
      ...current,
      prdPath: job.draftPath,
      prdMapPath: "",
      confirmPrdMapCreate: false,
    }))
    setNotice("Codex 已生成并校验标准化 PRD 草稿；请阅读草稿后确认是否创建页面映射。")
  }, [draft])

  const {
    cancelProjection,
    codexEffort,
    codexModel,
    codexModels,
    codexModelsError,
    codexModelsLoading,
    loadCodexModels,
    projectionBusy,
    projectionJob,
    resetProjection,
    selectCodexModel,
    selectedCodexModel,
    setCodexEffort,
    startProjection,
  } = useProjectionConversation({
    codexRequired: sourceSpecReady || needsPrdDraft,
    draft,
    mapReady,
    setDraft,
    setNotice,
    setStep,
    step,
    targetReady,
  })

  const {
    busy: prdDraftBusy,
    cancel: cancelPrdDraft,
    job: prdDraftJob,
    reset: resetPrdDraft,
    start: startPrdDraft,
  } = usePrdDraftConversation({
    draft,
    effort: codexEffort,
    model: codexModel,
    onCompleted: handlePrdDraftCompleted,
    setNotice,
  })

  const updateDraft = <K extends keyof ProjectDraft>(
    key: K,
    value: ProjectDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const selectSourceSpec = (path: string) => {
    setDraft((current) => ({
      ...current,
      sourceSpecPath: path,
    }))
    resetProjection()
  }

  const selectPrd = (path: string, prdMapPath = "") => {
    setDraft((current) => ({
      ...current,
      prdPath: path,
      prdMapPath,
      confirmPrdMapCreate: false,
    }))
    resetPrdDraft()
  }

  const startNew = (sourceType: ProjectSourceType) => {
    setDraft({
      ...freshDraft(launcher, sourceType),
      mode: launcher.gateSession ? "map" : freshDraft(launcher, sourceType).mode,
    })
    setDiscovery(null)
    resetProjection()
    resetPrdDraft()
    setStep(1)
    setNotice("")
    setView("wizard")
  }

  const continueProject = (project: ProjectDraft) => {
    setDraft({
      ...restoreDraft(project, launcher),
      mode: launcher.gateSession ? "map" : restoreDraft(project, launcher).mode,
    })
    setDiscovery(null)
    resetProjection()
    resetPrdDraft()
    setStep(1)
    setNotice("已恢复配置。请重新执行扫描，确认文件仍然有效。")
    setView("wizard")
  }

  const reopenProject = async (project: ProjectDraft) => {
    if (!project.id || reopeningId) return
    setReopeningId(project.id)
    try {
      const result = await reopenProjectRequest(project.id)
      onEnter(result)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "无法恢复 Spec 绑定工作台"
      continueProject(project)
      setNotice(`${message}。已打开来源配置，请修正后重新进入。`)
      toast.error(message)
    } finally {
      setReopeningId("")
    }
  }

  const requestProjectRemoval = async (project: ProjectDraft) => {
    if (!project.id || removalPendingId || removingProjectId) return
    setRemovalPendingId(project.id)
    try {
      setRemovalPreview(await previewProjectRemoval(project.id))
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "无法检查项目删除范围")
    } finally {
      setRemovalPendingId("")
    }
  }

  const confirmProjectRemoval = async () => {
    if (!removalPreview || removingProjectId) return
    setRemovingProjectId(removalPreview.id)
    try {
      const result = await removeProject(removalPreview.id)
      setRecents(result.recentProjects)
      setLastProject(result.lastProject || null)
      setRemovalPreview(null)
      toast.success(
        result.deletedToolMaps
          ? `项目已移除，并删除 ${result.deletedMappings} 条工具侧映射`
          : "项目已从最近项目中移除",
      )
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "项目移除失败")
    } finally {
      setRemovingProjectId("")
    }
  }

  const openPicker = (field: PickerField) => {
    const configs: Record<PickerField, Exclude<PickerConfig, null>> = {
      projectPath: {
        field,
        kind: "directory",
        title: "选择项目目录",
        description: "工具只读扫描此目录；默认不会向项目写入任何内容。",
      },
      htmlPath: {
        field,
        kind: "html",
        title: "选择 HTML 入口",
        description: "选择一个可在浏览器中打开的 .html 或 .htm 页面包。",
      },
      specPath: {
        field,
        kind: "json",
        title: "选择兼容工作台投影",
        description: "仅用于继续打开已有项目的内部 JSON 投影；新的 PRD 流程不要求研发选择此文件。",
      },
      sourceSpecPath: {
        field,
        kind: "markdown",
        title: "选择原始 Spec 文档",
        description: "这是 Codex 接收工作台差异后唯一允许修订的 Markdown 文档。",
      },
      prdPath: {
        field,
        kind: "markdown",
        title: "选择产品需求文档",
        description: "只有符合可映射 PRD 格式合同的 Markdown 才能建立页面关联。",
      },
      mapPath: {
        field,
        kind: "json",
        title: "选择 Spec 映射",
        description: "选择已有 spec-map.json，并在进入前校验 productSpecId。",
      },
    }
    setPicker(configs[field])
  }

  const runScan = useCallback(
    async (source: ProjectDraft = draft) => {
      if (!source.projectPath.trim()) {
        toast.error("请先选择项目目录")
        return false
      }
      if (source.sourceType === "html" && !source.htmlPath.trim()) {
        toast.error("请选择单个 HTML 入口")
        return false
      }
      if (source.sourceType === "dev" && !source.devUrl.trim()) {
        toast.error("请填写本地开发地址")
        return false
      }
      setScanning(true)
      setNotice("")
      try {
        const next = await scanProject(source)
        const validMaps = next.map.filter((candidate) => candidate.valid)
        const currentMapStillValid = validMaps.some(
          (candidate) => candidate.path === source.mapPath,
        )
        const nextMapPolicy = validMaps.length > 0 ? "existing" : "tool"
        const nextMapPath = validMaps.length === 1
          ? validMaps[0].path
          : currentMapStillValid
            ? source.mapPath
            : ""
        setDiscovery(next)
        setDraft((current) => ({
          ...current,
          projectPath: next.projectPath,
          htmlPath:
            current.sourceType === "dev"
              ? ""
              : current.htmlPath || next.recommended.htmlPath,
          specPath: current.specPath || next.recommended.specPath,
          sourceSpecPath: current.sourceSpecPath || next.recommended.sourceSpecPath,
          prdPath: current.prdPath || next.recommended.prdPath,
          prdMapPath: current.prdMapPath || next.recommended.prdMapPath,
          mapPath: nextMapPath,
          mapPolicy: nextMapPolicy,
          confirmMapCreate: false,
          confirmPrdMapCreate: false,
          confirmTargetWrite: false,
        }))
        setNotice(
          `扫描完成：检查了 ${next.scannedFiles} 个 HTML、PRD、Spec 与映射候选，请逐项确认。`,
        )
        setStep(2)
        return true
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "项目扫描失败"
        setNotice(message)
        toast.error(message)
        return false
      } finally {
        setScanning(false)
      }
    },
    [draft],
  )

  const saveDraft = async (
    reason: "draft" | "later" = "draft",
  ) => {
    if (!draft.projectPath.trim()) {
      toast.error("请先选择项目目录")
      return
    }
    setSaving(true)
    try {
      const result = await saveProjectDraft(draft)
      const saved = result.project
      setDraft((current) => ({ ...current, id: saved.id }))
      setLastProject(saved)
      setRecents((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ].slice(0, 20))
      if (reason === "later") {
        setNotice("项目配置已保存；你可以稍后从最近项目继续。")
        setView("home")
        toast.success("已保存配置，未进入工作台")
      } else {
        toast.success("配置已保存到工具侧")
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "配置保存失败")
    } finally {
      setSaving(false)
    }
  }

  const sourceTitle =
    SOURCE_OPTIONS.find((item) => item.type === draft.sourceType)?.title ||
    "页面来源"

  const mapSummary = useMemo(() => {
    if (draft.mapPolicy === "tool") return "创建新的工具侧映射"
    if (draft.mapPolicy === "project") return "项目内 spec-map.json"
    return draft.mapPath || "尚未选择映射文件"
  }, [draft.mapPath, draft.mapPolicy])

  const enter = async () => {
    if (!sourcesReady) {
      setStep(2)
      toast.error("请先处理扫描结果中的缺失项")
      return
    }
    setEntering(true)
    try {
      onEnter(await confirmProject(draft))
    } catch (caught) {
      setStep(2)
      toast.error(caught instanceof Error ? caught.message : "项目来源确认失败")
    } finally {
      setEntering(false)
    }
  }

  const returnHome = async () => {
    try {
      await dismissProjectBootstrap()
    } finally {
      setView("home")
      setStep(1)
      setDiscovery(null)
    }
  }

  const renderHome = () => (
    <ScrollArea className="min-h-0 flex-1">
      <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 lg:py-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
          <section>
            <Badge className="border border-emerald-400/20 bg-emerald-400/8 text-emerald-300">
              <MonitorUp className="mr-1 size-3.5" />
              产品工作台
            </Badge>
            <h2 className="mt-5 max-w-2xl text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              一块块搭起，
              <span className="block text-muted-foreground">一步步完成。</span>
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
              连接页面与产品文档，查看需求、关联 Spec、修订细节，再把评审成果交给下一步工作。
            </p>

            {lastProject ? (
              <button
                type="button"
                disabled={Boolean(reopeningId)}
                onClick={() => void reopenProject(lastProject)}
                className="mt-8 flex w-full max-w-2xl items-center gap-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-left transition hover:border-emerald-400/40 hover:bg-emerald-400/[0.09] disabled:cursor-wait disabled:opacity-70"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-300 text-slate-950">
                  {reopeningId === lastProject.id ? (
                    <LoaderCircle className="size-5 animate-spin" />
                  ) : (
                    <Link2 className="size-5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-[10px] font-semibold tracking-[0.12em] text-emerald-300 uppercase">
                    {reopeningId === lastProject.id ? "正在恢复" : "继续 Spec 绑定"}
                  </span>
                  <span className="mt-1 block truncate text-sm font-semibold">
                    {lastProject.name || "未命名项目"}
                  </span>
                  <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                    {lastProject.projectPath}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-emerald-300" />
              </button>
            ) : null}
          </section>

          <section className="rounded-3xl border border-white/8 bg-[#10141a] p-5 shadow-2xl shadow-black/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">添加项目</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  选择后进入三步来源向导
                </p>
              </div>
              <Plus className="size-5 text-emerald-300" />
            </div>
            <div className="mt-5 space-y-2">
              {SOURCE_OPTIONS.map((option) => {
                const Icon = option.icon
                return (
                  <button
                    key={option.type}
                    type="button"
                    onClick={() => startNew(option.type)}
                    className="group flex w-full items-center gap-3 rounded-xl border border-white/8 bg-white/[0.025] px-3 py-3 text-left transition hover:border-emerald-400/25 hover:bg-emerald-400/[0.055]"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.045] text-muted-foreground transition group-hover:text-emerald-300">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold">{option.title}</span>
                      <span className="mt-1 block text-[10px] text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-emerald-300" />
                  </button>
                )
              })}
            </div>
          </section>
        </div>

        <div className="mt-8"><PublicationManager onManage={async record => {
          const config = await reopenPublishedProject(record.project.id)
          sessionStorage.setItem("ips-open-publication", "1")
          onEnter(config)
        }} /></div>

        {notice ? (
          <div className="mt-6 flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" />
            {notice}
          </div>
        ) : null}

        <section className="mt-10">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">最近项目</p>
              <p className="mt-1 text-xs text-muted-foreground">
                点击最近项目可重新检查或调整来源配置
              </p>
            </div>
            <Badge variant="secondary" className="rounded-full">
              {recents.length} / 20
            </Badge>
          </div>

          {recents.length ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {recents.map((project) => (
                <div
                  key={project.id}
                  className="group relative overflow-hidden rounded-2xl border border-white/8 bg-white/[0.018] transition hover:border-white/15 hover:bg-white/[0.04]"
                >
                  <button
                    type="button"
                    onClick={() => continueProject(project)}
                    className="flex w-full items-start gap-3 p-4 pr-12 text-left"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/8 bg-white/[0.035] text-muted-foreground group-hover:text-emerald-300">
                      {project.sourceType === "dev" ? (
                        <Code2 className="size-4" />
                      ) : (
                        <FolderKanban className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">
                        {project.name || "未命名项目"}
                      </span>
                      <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                        {concisePath(project.projectPath)}
                      </span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={Boolean(removalPendingId || removingProjectId)}
                    aria-label={`移除项目 ${project.name || "未命名项目"}`}
                    title="从最近项目中移除"
                    onClick={() => void requestProjectRemoval(project)}
                    className="absolute top-3 right-3 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                  >
                    {removalPendingId === project.id ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-5 py-8 text-center text-xs text-muted-foreground">
              尚无最近项目。请从右上方“添加项目”开始。
            </div>
          )}
        </section>
      </main>
    </ScrollArea>
  )

  const renderStepOne = () => (
    <div>
      <div>
        <p className="text-[10px] font-semibold tracking-[0.14em] text-emerald-300 uppercase">
          第 1 步，共 3 步
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">选择页面来源</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          选择来源并执行扫描。这是进入文件推荐与缺失项处理的必要操作。
        </p>
      </div>

      <div className="mt-6">
        <SourceTypeSelector
          value={draft.sourceType}
          onChange={(value) => {
            setDraft((current) => ({
              ...current,
              sourceType: value,
              confirmPrdMapCreate: false,
              confirmTargetWrite: false,
            }))
            setDiscovery(null)
          }}
        />
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <label>
          <span className="mb-2 block text-xs font-semibold">项目名称</span>
          <Input
            value={draft.name}
            onChange={(event) => updateDraft("name", event.target.value)}
            placeholder="未填写时使用目录名"
            className="h-10 border border-white/8 bg-white/[0.035]"
          />
        </label>
        <div>
          <span className="mb-2 block text-xs font-semibold">项目目录</span>
          <div className="flex gap-2">
            <Input
              value={draft.projectPath}
              onChange={(event) => {
                updateDraft("projectPath", event.target.value)
                setDiscovery(null)
              }}
              placeholder="/Users/name/projects/example"
              className="h-10 border border-white/8 bg-white/[0.035] font-mono text-xs"
            />
            <Button variant="outline" size="lg" onClick={() => openPicker("projectPath")}>
              <FolderOpen />
              浏览
            </Button>
          </div>
        </div>
      </div>

      {draft.sourceType === "html" ? (
        <div className="mt-5">
          <span className="mb-2 block text-xs font-semibold">单个 HTML 入口</span>
          <div className="flex gap-2">
            <Input
              value={draft.htmlPath}
              onChange={(event) => updateDraft("htmlPath", event.target.value)}
              placeholder="选择 .html 或 .htm 文件"
              className="h-10 border border-white/8 bg-white/[0.035] font-mono text-xs"
            />
            <Button variant="outline" size="lg" onClick={() => openPicker("htmlPath")}>
              <FileCode2 />
              选择文件
            </Button>
          </div>
        </div>
      ) : null}

      {draft.sourceType === "directory" ? (
        <div className="mt-5 rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3 text-xs leading-5 text-muted-foreground">
          <ScanSearch className="mr-2 inline size-4 text-emerald-300" />
          工具会在项目目录中只读查找 HTML、标准化 PRD、Markdown Spec 与两类映射文件；没有匹配项时会在下一步明确列出。
        </div>
      ) : null}

      {notice ? (
        <div className="mt-5 rounded-xl border border-amber-400/15 bg-amber-400/[0.06] px-4 py-3 text-xs text-amber-200">
          {notice}
        </div>
      ) : null}
    </div>
  )

  const renderStepTwo = () => (
    <div>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.14em] text-emerald-300 uppercase">
            第 2 步，共 3 步
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">处理扫描结果</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            逐项确认页面、PRD、可选 Spec 与映射文件；缺失项不会被静默补全。
          </p>
        </div>
        <Button variant="outline" onClick={() => void runScan()} disabled={scanning}>
          {scanning ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          重新扫描
        </Button>
      </div>

      {notice ? (
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3 text-xs text-muted-foreground">
          <ScanSearch className="mt-0.5 size-4 shrink-0 text-emerald-300" />
          {notice}
          {discovery?.truncated ? " 扫描已达到文件数量上限。" : ""}
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        <ResolutionPanel
          icon={draft.sourceType === "dev" ? <Code2 className="size-4" /> : <FileCode2 className="size-4" />}
          title="页面来源"
          description="选择真正用于联看的 HTML 入口"
          ready={targetReady}
        >
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="space-y-2">
                <Input
                  value={draft.htmlPath}
                  onChange={(event) => updateDraft("htmlPath", event.target.value)}
                  placeholder="扫描未找到时可手动填写"
                  className="h-10 border border-white/8 bg-white/[0.035] font-mono text-xs"
                />
                <CandidateSelect
                  value={draft.htmlPath}
                  candidates={discovery?.html || []}
                  placeholder="从扫描结果选择 HTML"
                  onChange={(path) => updateDraft("htmlPath", path)}
                />
              </div>
              <Button variant="outline" size="lg" onClick={() => openPicker("htmlPath")}>
                <FolderOpen />
                {targetReady ? "替换文件" : "选择文件"}
              </Button>
            </div>
        </ResolutionPanel>

        <ResolutionPanel
          icon={<FileText className="size-4" />}
          title="产品需求文档（PRD）"
          description="PRD 可独立进入工作台；格式校验通过后才能绑定到页面"
          ready={prdReady && prdMapReady}
          busy={prdDraftBusy}
        >
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-2">
              <Input
                value={draft.prdPath}
                onChange={(event) => selectPrd(event.target.value)}
                placeholder="选择符合格式的产品需求文档.md"
                className="h-10 border border-white/8 bg-white/[0.035] font-mono text-xs"
              />
              <CandidateSelect
                value={draft.prdPath}
                candidates={discovery?.prd || []}
                placeholder="从扫描结果选择 PRD"
                onChange={(path) => selectPrd(path, discovery?.recommended.prdMapPath || "")}
              />
            </div>
            <Button variant="outline" size="lg" onClick={() => openPicker("prdPath")}>
              <FolderOpen />
              {prdReady ? "替换文档" : "选择文档"}
            </Button>
          </div>

          {prdCandidate && !prdCandidate.valid ? (
            <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/8 px-3 py-3 text-[10px] leading-5 text-destructive">
              <p className="font-semibold">当前 PRD 不能建立页面绑定</p>
              <div className="mt-1 space-y-1">
                {prdCandidate.errors.map((error) => <p key={error}>- {error}</p>)}
              </div>
              <p className="mt-2 text-muted-foreground">
                原文件会保留；页面绑定和 prd-map.json 仍保持关闭。
              </p>
            </div>
          ) : null}

          {needsPrdDraft ? (
            prdDraftBusy ? (
              <div className="mt-4 rounded-xl border border-sky-400/20 bg-sky-400/[0.06] p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sky-400/10 text-sky-300">
                    <LoaderCircle className="size-4 animate-spin" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-sky-100">
                      {prdDraftJob?.message || "正在创建 Codex PRD 草稿任务"}
                    </p>
                    <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
                      对话会保留在 Codex 左侧任务列表；完成后仍可打开查看过程或继续追问。
                    </p>
                  </div>
                  {prdDraftJob?.id ? (
                    <Button variant="ghost" size="sm" onClick={() => void cancelPrdDraft()}>
                      取消
                    </Button>
                  ) : null}
                </div>
                {prdDraftJob?.threadId ? (
                  <div className="mt-3 rounded-lg border border-white/8 bg-black/15 px-3 py-2 text-[10px] leading-5">
                    <p className="font-semibold text-sky-100">
                      {prdDraftJob.threadTitle || "PRD 标准化草稿"}
                    </p>
                    <p className="break-all text-muted-foreground">
                      {prdDraftJob.model} · {REASONING_LABELS[prdDraftJob.effort] || prdDraftJob.effort}推理 · {prdDraftJob.threadId}
                    </p>
                    <div className="mt-2">
                      <CodexThreadLink threadId={prdDraftJob.threadId} />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : prdDraftJob?.status === "failed" ? (
              <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/8 p-3">
                <div className="flex items-start gap-2 text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold">Codex 未能生成标准化 PRD 草稿</p>
                    <p className="mt-1 text-[10px] leading-5">
                      {prdDraftJob.error || prdDraftJob.message}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => void startPrdDraft()}
                    disabled={!codexModel || !codexEffort || projectionBusy}
                  >
                    <RefreshCw />
                    重新尝试
                  </Button>
                  {prdDraftJob.threadId ? <CodexThreadLink threadId={prdDraftJob.threadId} /> : null}
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.025] p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/8 bg-white/[0.04] text-emerald-300">
                    <Bot className="size-4" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold">新建一条可见的 Codex 对话</p>
                    <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
                      你明确点击后才会创建。对话会出现在 Codex 左侧任务列表，并调用 Product Documentation Skill，只在当前 Project 的 drafts-documents/ 生成标准化草稿，不会覆盖当前 PRD。
                    </p>
                  </div>
                </div>

                {codexModelsLoading ? (
                  <div className="mt-4 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <LoaderCircle className="size-3.5 animate-spin" />
                    正在读取当前 Codex 账号可用模型…
                  </div>
                ) : codexModelsError ? (
                  <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/8 p-3">
                    <p className="text-[10px] leading-5 text-destructive">{codexModelsError}</p>
                    <Button className="mt-2" variant="secondary" size="sm" onClick={() => void loadCodexModels()}>
                      <RefreshCw />
                      重新读取模型
                    </Button>
                  </div>
                ) : codexModels.length ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label>
                      <span className="mb-2 block text-[10px] font-semibold text-muted-foreground">模型</span>
                      <Select value={codexModel} onValueChange={selectCodexModel}>
                        <SelectTrigger className="h-10 border border-white/8 bg-white/[0.035]">
                          <SelectValue placeholder="选择 Codex 模型" />
                        </SelectTrigger>
                        <SelectContent>
                          {codexModels.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <label>
                      <span className="mb-2 block text-[10px] font-semibold text-muted-foreground">推理强度</span>
                      <Select value={codexEffort} onValueChange={setCodexEffort}>
                        <SelectTrigger className="h-10 border border-white/8 bg-white/[0.035]">
                          <SelectValue placeholder="选择推理强度" />
                        </SelectTrigger>
                        <SelectContent>
                          {(selectedCodexModel?.supportedReasoningEfforts || []).map((effort) => (
                            <SelectItem key={effort.id} value={effort.id}>
                              {REASONING_LABELS[effort.id] || effort.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <p className="sm:col-span-2 text-[10px] leading-5 text-muted-foreground">
                      {selectedCodexModel?.description}
                    </p>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    onClick={() => void startPrdDraft()}
                    disabled={!codexModel || !codexEffort || codexModelsLoading || projectionBusy}
                  >
                    <MessageSquareText />
                    创建 Codex 对话并生成
                  </Button>
                </div>
              </div>
            )
          ) : null}

          {prdReady ? (
            draft.prdMapPath && prdMapCandidate?.valid !== false ? (
              <div className="mt-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.045] px-3 py-3 text-[10px] text-emerald-300">
                已识别同目录 prd-map.json；进入后会保留并校验现有页面关系。
              </div>
            ) : (
              <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-4">
                <input
                  type="checkbox"
                  checked={Boolean(draft.confirmPrdMapCreate)}
                  onChange={(event) => updateDraft("confirmPrdMapCreate", event.target.checked)}
                  className="mt-0.5 size-4 accent-emerald-400"
                />
                <span>
                  <span className="block text-xs font-semibold leading-5 text-amber-100">
                    在 PRD 同目录创建 prd-map.json
                  </span>
                  <span className="mt-1 block text-[10px] leading-5 text-amber-200/75">
                    只保存页面与中文 PRD 章节 ID 的关系，不复制正文；与 PRD 一起冻结。
                  </span>
                </span>
              </label>
            )
          ) : null}
        </ResolutionPanel>

        <ResolutionPanel
          icon={<FileText className="size-4" />}
          title="Spec 输入"
          description="可选。Spec 用于关键行为与具体 DOM 的精确关联；不再是查看 PRD 的前提"
          ready={specReady || (prdReady && !sourceSpecReady)}
          busy={projectionBusy}
        >
          <div className="mb-4 rounded-xl border border-white/8 bg-white/[0.025] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">原始 Spec 文档（Markdown）</span>
              <StatusBadge
                ready={sourceSpecReady}
                readyLabel="已识别"
                waitingLabel="未绑定"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="space-y-2">
                <Input
                  value={draft.sourceSpecPath}
                  onChange={(event) => selectSourceSpec(event.target.value)}
                  placeholder="选择 product.spec.md"
                  className="h-10 border border-white/8 bg-white/[0.035] font-mono text-xs"
                />
                <CandidateSelect
                  value={draft.sourceSpecPath}
                  candidates={discovery?.specSource || []}
                  placeholder="从扫描结果选择原始 Spec"
                  onChange={selectSourceSpec}
                />
              </div>
              <Button variant="outline" size="lg" onClick={() => openPicker("sourceSpecPath")}>
                <FolderOpen />
                {sourceSpecReady ? "替换文档" : "选择文档"}
              </Button>
            </div>
            <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
              项目中心只记录此路径。普通映射模式中的“操作定义”可直接原子写入这个本地原文件，不要求连接 Codex。
            </p>
          </div>

          {prdReady && !sourceSpecReady && !specReady ? (
            <div className="rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3 text-[10px] leading-5 text-muted-foreground">
              当前没有绑定 Spec，PRD 可以直接接入现有页面工作台。若选择 Markdown Spec，必须先准备其内部投影，原有 Spec 绑定与评审能力不会被降级或替换。
            </div>
          ) : <>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
            <FileJson2 className="size-4 text-emerald-300" />工作台视图模型（JSON）
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-2">
              <Input
                value={draft.specPath}
                onChange={(event) => updateDraft("specPath", event.target.value)}
                placeholder="选择临时 product.spec.json 视图"
                className="h-10 border border-white/8 bg-white/[0.035] font-mono text-xs"
              />
              <CandidateSelect
                value={draft.specPath}
                candidates={discovery?.spec || []}
                placeholder="从扫描结果选择工作台视图"
                onChange={(path) => updateDraft("specPath", path)}
              />
            </div>
            <Button variant="outline" size="lg" onClick={() => openPicker("specPath")}>
              <FolderOpen />
              {specReady ? "替换视图" : "选择视图"}
            </Button>
          </div>

          {specCandidate?.errors.length ? (
            <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/8 px-3 py-2 text-[10px] leading-5 text-destructive">
              {specCandidate.errors.join("；")}
            </div>
          ) : null}

          {projectionBusy ? (
            <div className="mt-4 rounded-xl border border-sky-400/20 bg-sky-400/[0.06] p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sky-400/10 text-sky-300">
                  <LoaderCircle className="size-4 animate-spin" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-sky-100">
                    {projectionJob?.message || "正在创建 Codex 对话"}
                  </p>
                  <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
                    对话会保留在 Codex 左侧任务列表；完成后仍可打开查看过程或继续追问。
                  </p>
                </div>
                {projectionJob?.id ? (
                  <Button variant="ghost" size="sm" onClick={() => void cancelProjection()}>
                    取消
                  </Button>
                ) : null}
              </div>
              {projectionJob?.threadId ? (
                <div className="mt-3 rounded-lg border border-white/8 bg-black/15 px-3 py-2 text-[10px] leading-5">
                  <p className="font-semibold text-sky-100">
                    {projectionJob.threadTitle || "Interactive Product Spec"}
                  </p>
                  <p className="text-muted-foreground">
                    {projectionJob.model} · {REASONING_LABELS[projectionJob.effort] || projectionJob.effort}推理 · {projectionJob.threadId}
                  </p>
                  <div className="mt-2">
                    <CodexThreadLink threadId={projectionJob.threadId} />
                  </div>
                </div>
              ) : null}
            </div>
          ) : specReady ? (
            <div className="mt-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.045] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] text-emerald-300">
                  已选择工作台视图；进入前还会执行服务端契约校验。
                </p>
              </div>
              {sourceSpecReady ? (
                <div className="mt-3 border-t border-white/8 pt-3">
                  {codexModelsLoading ? (
                    <p className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <LoaderCircle className="size-3.5 animate-spin" />
                      正在读取当前 Codex 账号可用模型…
                    </p>
                  ) : codexModelsError ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[10px] text-destructive">{codexModelsError}</p>
                      <Button variant="secondary" size="xs" onClick={() => void loadCodexModels()}>
                        <RefreshCw />
                        重试
                      </Button>
                    </div>
                  ) : codexModels.length ? (
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-end">
                      <label>
                        <span className="mb-1 block text-[9px] text-muted-foreground">新对话模型</span>
                        <Select value={codexModel} onValueChange={selectCodexModel}>
                          <SelectTrigger className="h-9 border border-white/8 bg-white/[0.035]">
                            <SelectValue placeholder="选择模型" />
                          </SelectTrigger>
                          <SelectContent>
                            {codexModels.map((model) => (
                              <SelectItem key={model.id} value={model.id}>{model.displayName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <label>
                        <span className="mb-1 block text-[9px] text-muted-foreground">推理强度</span>
                        <Select value={codexEffort} onValueChange={setCodexEffort}>
                          <SelectTrigger className="h-9 border border-white/8 bg-white/[0.035]">
                            <SelectValue placeholder="选择强度" />
                          </SelectTrigger>
                          <SelectContent>
                            {(selectedCodexModel?.supportedReasoningEfforts || []).map((effort) => (
                              <SelectItem key={effort.id} value={effort.id}>
                                {REASONING_LABELS[effort.id] || effort.id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void startProjection(true)}
                        disabled={!codexModel || !codexEffort || prdDraftBusy}
                      >
                        <MessageSquareText />
                        新建对话并重新生成
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {projectionJob?.threadId ? (
                <div className="mt-3 flex items-start gap-2 border-t border-white/8 pt-3">
                  <MessageSquareText className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">
                      {projectionJob.threadTitle || "Interactive Product Spec"}
                    </p>
                    <p className="mt-1 break-all font-mono text-[9px] text-muted-foreground">
                      {projectionJob.model} · {REASONING_LABELS[projectionJob.effort] || projectionJob.effort}推理 · {projectionJob.threadId}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      已保留在 Codex 左侧任务列表，可打开查看或继续。
                    </p>
                    <div className="mt-2">
                      <CodexThreadLink threadId={projectionJob.threadId} />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : projectionJob?.status === "failed" ? (
            <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/8 p-3">
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="text-xs font-semibold">Codex 未能生成工作台视图</p>
                  <p className="mt-1 text-[10px] leading-5">
                    {projectionJob.error || projectionJob.message}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void startProjection(true)} disabled={prdDraftBusy}>
                  <RefreshCw />
                  重新尝试
                </Button>
                <Button variant="outline" onClick={() => openPicker("specPath")}>
                  <FolderOpen />
                  选择已有视图
                </Button>
                <Button variant="ghost" onClick={() => void saveDraft("later")} disabled={saving}>
                  <Clock3 />
                  稍后处理
                </Button>
                {projectionJob.threadId ? <CodexThreadLink threadId={projectionJob.threadId} /> : null}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.025] p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/8 bg-white/[0.04] text-emerald-300">
                  <Bot className="size-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold">新建一条可见的 Codex 对话</p>
                  <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
                    你明确点击后才会创建。对话会出现在 Codex 左侧任务列表，并只读调用 Interactive Product Spec Skill 生成临时 JSON。
                  </p>
                </div>
              </div>

              {codexModelsLoading ? (
                <div className="mt-4 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  正在读取当前 Codex 账号可用模型…
                </div>
              ) : codexModelsError ? (
                <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/8 p-3">
                  <p className="text-[10px] leading-5 text-destructive">{codexModelsError}</p>
                  <Button className="mt-2" variant="secondary" size="sm" onClick={() => void loadCodexModels()}>
                    <RefreshCw />
                    重新读取模型
                  </Button>
                </div>
              ) : codexModels.length ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className="mb-2 block text-[10px] font-semibold text-muted-foreground">模型</span>
                    <Select value={codexModel} onValueChange={selectCodexModel}>
                      <SelectTrigger className="h-10 border border-white/8 bg-white/[0.035]">
                        <SelectValue placeholder="选择 Codex 模型" />
                      </SelectTrigger>
                      <SelectContent>
                        {codexModels.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label>
                    <span className="mb-2 block text-[10px] font-semibold text-muted-foreground">推理强度</span>
                    <Select value={codexEffort} onValueChange={setCodexEffort}>
                      <SelectTrigger className="h-10 border border-white/8 bg-white/[0.035]">
                        <SelectValue placeholder="选择推理强度" />
                      </SelectTrigger>
                      <SelectContent>
                        {(selectedCodexModel?.supportedReasoningEfforts || []).map((effort) => (
                          <SelectItem key={effort.id} value={effort.id}>
                            {REASONING_LABELS[effort.id] || effort.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <p className="sm:col-span-2 text-[10px] leading-5 text-muted-foreground">
                    {selectedCodexModel?.description}
                  </p>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={() => void startProjection()}
                  disabled={!sourceSpecReady || !codexModel || !codexEffort || codexModelsLoading || prdDraftBusy}
                >
                  <MessageSquareText />
                  创建 Codex 对话并生成
                </Button>
                <Button variant="outline" onClick={() => openPicker("specPath")}>
                  <FolderOpen />
                  选择已有视图
                </Button>
                <Button variant="ghost" onClick={() => void saveDraft("later")} disabled={saving}>
                  <Clock3 />
                  稍后处理
                </Button>
              </div>
            </div>
          )}
          </>}
        </ResolutionPanel>

        <ResolutionPanel
          icon={<HardDrive className="size-4" />}
          title="Spec 映射"
          description="只保存页面元素与 Spec 节点的对应关系，不保存业务规则"
          ready={mapReady}
        >
          {!specReady ? (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
              <p className="text-xs font-semibold text-amber-100">{sourceSpecReady ? "Spec 工作台视图尚未准备" : prdReady ? "当前未绑定 Spec" : "请先准备 Spec"}</p>
              <p className="mt-1 text-[10px] leading-5 text-amber-200/75">
                {sourceSpecReady
                  ? "已选择 Markdown Spec，必须先恢复或生成内部投影，不能降级进入仅含 PRD 的工作台。"
                  : prdReady
                  ? "这不影响进入页面阅读和关联 PRD；只有需要把 Spec 节点定位到具体页面元素时，才建立独立的 spec-map.json。"
                  : "Spec 节点到页面元素的映射依赖经过校验的内部投影；准备完成后才能处理 spec-map.json。"}
              </p>
            </div>
          ) : draft.mapPolicy === "existing" ? (
            <div className="mt-3">
              <div className="mb-3 flex items-start gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                <span>
                  <span className="block text-xs font-semibold text-emerald-100">
                    {discovery?.map.filter((candidate) => candidate.valid).length === 1
                      ? "已自动载入已有映射"
                      : "请选择要继续维护的已有映射"}
                  </span>
                  <span className="mt-1 block text-[10px] leading-5 text-muted-foreground">
                    后续确认和调整会保存到所选 spec-map.json。
                  </span>
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="space-y-2">
                <Input
                  value={draft.mapPath}
                  onChange={(event) => updateDraft("mapPath", event.target.value)}
                  placeholder="选择 spec-map.json"
                  className="h-10 border border-white/8 bg-white/[0.035] font-mono text-xs"
                />
                <CandidateSelect
                  value={draft.mapPath}
                  candidates={discovery?.map || []}
                  placeholder="从扫描结果选择映射"
                  onChange={(path) => updateDraft("mapPath", path)}
                />
                </div>
                <Button variant="outline" size="lg" onClick={() => openPicker("mapPath")}>
                  <FolderOpen />
                  选择文件
                </Button>
              </div>
              {mapCandidate?.errors.length ? (
                <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/8 px-3 py-2 text-[10px] leading-5 text-destructive">
                  {mapCandidate.errors.join("；")}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              {hasInvalidMapOnly ? (
                <div className="rounded-xl border border-destructive/20 bg-destructive/8 px-4 py-3">
                  <p className="text-xs font-semibold text-destructive">
                    已有映射与当前 Spec 不兼容
                  </p>
                  <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
                    旧映射会原样保留，不会覆盖或自动迁移。请为新 Spec 创建独立的工具侧映射。
                  </p>
                  <div className="mt-2 space-y-1 text-[10px] leading-5 text-destructive/90">
                    {invalidMapCandidates.map((candidate) => (
                      <p key={candidate.path}>
                        {candidate.relativePath}：{candidate.errors.join("；")}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-4">
                <input
                  type="checkbox"
                  checked={Boolean(draft.confirmMapCreate)}
                  onChange={(event) =>
                    updateDraft("confirmMapCreate", event.target.checked)
                  }
                  className="mt-0.5 size-4 accent-emerald-400"
                />
                <span>
                  <span className="block text-xs font-semibold leading-5 text-amber-100">
                    {hasInvalidMapOnly
                      ? "创建适用于新 Spec 的工具侧映射"
                      : "未发现已有映射，创建新的工具侧映射"}
                  </span>
                  <span className="mt-1 block text-[10px] leading-5 text-amber-200/75">
                    勾选后，进入工作台时才会创建；文件保存在工具配置目录，不修改当前项目。
                  </span>
                </span>
              </label>
            </div>
          )}
        </ResolutionPanel>
      </div>
    </div>
  )

  const renderStepThree = () => (
    <div>
      <p className="text-[10px] font-semibold tracking-[0.14em] text-emerald-300 uppercase">
        第 3 步，共 3 步
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">进入前确认</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        这一步只确认来源、工作模式与写入边界，不会改写 PRD 或重新生成 Spec。
      </p>

      <div className="mt-6 grid gap-3">
        <SummaryRow
          icon={draft.sourceType === "dev" ? <Code2 className="size-4" /> : <FileCode2 className="size-4" />}
          title="页面来源"
          value={draft.sourceType === "dev" ? draft.devUrl : draft.htmlPath}
          detail={sourceTitle}
        />
        <SummaryRow
          icon={<FileText className="size-4" />}
          title="产品需求文档"
          value={draft.prdPath || "未绑定"}
          detail={draft.prdPath ? "可独立预览，并通过同目录 prd-map.json 关联页面" : "当前项目只使用 Spec"}
        />
        <SummaryRow
          icon={<FileText className="size-4" />}
          title="原始 Spec 文档"
          value={draft.sourceSpecPath || "未绑定（仅可查看/映射）"}
          detail="普通操作定义可直接编辑；Codex 对话只负责复杂投影或协作任务"
        />
        {draft.specPath ? (
          <SummaryRow
            icon={<FileJson2 className="size-4" />}
            title="内部 Spec 投影"
            value="已准备"
            detail="工具内部校验和使用，不作为项目正式文档"
          />
        ) : null}
        <SummaryRow
          icon={<HardDrive className="size-4" />}
          title="Spec 映射"
          value={specReady ? mapSummary : "当前没有 Spec，不创建 spec-map.json"}
          detail={
            draft.mapPolicy === "tool"
              ? "保存到工具侧"
              : draft.mapPolicy === "project"
                ? "已明确授权项目写入"
                : "保存到已选择文件"
          }
        />
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <span className="mb-2 block text-xs font-semibold">进入模式</span>
          <Tabs
            value={draft.mode}
            onValueChange={(value) => {
              if (launcher.gateSession) return
              updateDraft("mode", value as "map" | "review")
            }}
          >
            <TabsList className="grid h-10 w-full grid-cols-2 border border-white/8 bg-white/[0.035]">
              <TabsTrigger value="map">可编辑映射</TabsTrigger>
              <TabsTrigger value="review" disabled={Boolean(launcher.gateSession)}>只读查看</TabsTrigger>
            </TabsList>
          </Tabs>
          {launcher.gateSession ? (
            <p className="mt-2 text-[10px] leading-5 text-emerald-300">
              当前由 Codex 发起；确认来源后可编辑 Spec 修订草稿并提交回同一任务。
            </p>
          ) : null}
        </div>
        <label>
          <span className="mb-2 flex items-center justify-between text-xs font-semibold">
            页面初始路由
            <span className="font-normal text-muted-foreground">可选</span>
          </span>
          <Input
            value={draft.initialRoute}
            onChange={(event) => updateDraft("initialRoute", event.target.value)}
            placeholder="#S007 或 ?screen=S007"
            className="h-10 border border-white/8 bg-white/[0.035] font-mono text-xs"
          />
        </label>
      </div>

      <div className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.055] p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-300" />
        <div>
          <p className="text-xs font-semibold text-emerald-100">来源已齐全</p>
          <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
            项目配置默认保存在工具侧，页面始终只读，JSON 视图不会作为正式文档返写。映射只写入你选择的位置；普通操作定义可直接保存到本地 Markdown，复杂生成或门禁协作才进入 Codex 对话。
          </p>
        </div>
      </div>
    </div>
  )

  const renderWizard = () => (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[238px_minmax(0,1fr)] md:grid-rows-1">
      <aside className="border-b border-white/8 bg-[#0d1015] p-4 md:border-r md:border-b-0 md:p-5">
        <Button variant="ghost" size="sm" onClick={returnHome}>
          <ArrowLeft />
          返回项目中心
        </Button>
        <div className="mt-4 hidden md:block">
          <p className="truncate text-xs font-semibold">
            {draft.name || "新项目"}
          </p>
          <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">
            {draft.projectPath || "尚未选择目录"}
          </p>
        </div>
        <div className="mt-3 md:mt-6">
          <StepRail
            step={step}
            discovery={discovery}
            ready={sourcesReady}
            onStep={setStep}
          />
        </div>
        <div className="mt-6 hidden rounded-xl border border-white/8 bg-white/[0.02] p-3 text-[10px] leading-5 text-muted-foreground md:block">
          <ShieldCheck className="mb-2 size-4 text-emerald-300" />
          扫描与最近项目配置都保存在工具侧。缺少 Markdown Spec 或工作台视图时不会自动生成规则。
        </div>
      </aside>

      <div className="min-h-0 bg-[#090c10]">
        <ScrollArea className="h-full">
          <main className="mx-auto w-full max-w-4xl px-5 py-7 sm:px-8 md:py-10">
            <div className="rounded-3xl border border-white/8 bg-[#10141a] p-5 shadow-2xl shadow-black/25 sm:p-7">
              {step === 1
                ? renderStepOne()
                : step === 2
                  ? renderStepTwo()
                  : renderStepThree()}

              <div className="mt-8 flex flex-col-reverse gap-3 border-t border-white/8 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-2">
                  {step > 1 ? (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setStep((step - 1) as WizardStep)
                      }
                    >
                      <ArrowLeft />
                      上一步
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => void saveDraft("draft")}
                      disabled={saving || !draft.projectPath.trim()}
                    >
                      {saving ? <LoaderCircle className="animate-spin" /> : <Clock3 />}
                      保存草稿
                    </Button>
                  )}
                </div>

                {step === 1 ? (
                  <Button
                    size="lg"
                    onClick={() => void runScan()}
                    disabled={
                      scanning ||
                      !draft.projectPath.trim() ||
                      (draft.sourceType === "html" && !draft.htmlPath.trim()) ||
                      (draft.sourceType === "dev" && !draft.devUrl.trim())
                    }
                  >
                    {scanning ? <LoaderCircle className="animate-spin" /> : <ScanSearch />}
                    {scanning ? "正在扫描" : "扫描来源并继续"}
                  </Button>
                ) : step === 2 ? (
                  <Button
                    size="lg"
                    disabled={!sourcesReady}
                    onClick={() => setStep(3)}
                  >
                    确认页面与 Spec 来源
                    <ArrowRight />
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    disabled={!sourcesReady || entering}
                    onClick={() => void enter()}
                  >
                    {entering ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
                    {entering ? "正在校验" : "进入映射工作台"}
                  </Button>
                )}
              </div>
            </div>
          </main>
        </ScrollArea>
      </div>
    </div>
  )

  return (
    <div className="dark grid h-dvh min-h-0 grid-rows-[64px_minmax(0,1fr)] overflow-hidden bg-[#090c10] text-foreground">
      <header className="flex items-center justify-between border-b border-white/8 bg-[#0b0e12]/95 px-5 backdrop-blur-xl">
        <button
          type="button"
          onClick={returnHome}
          className="flex min-w-0 items-center gap-3 text-left"
        >
          <BrandMark className="size-10" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-emerald-300">
              咔哒
              <span className="ml-2 text-[10px] font-normal text-muted-foreground">产品工作台</span>
            </span>
            <span className="mt-0.5 block truncate text-xs font-semibold">
              {view === "home" ? "项目中心" : "来源确认向导"}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-2">
          <div id="runtime-status-slot" />
          <Badge variant="secondary" className="hidden rounded-full sm:inline-flex">
            本地优先
          </Badge>
          {view === "home" ? (
            <Button size="sm" onClick={() => startNew("directory")}>
              <Plus />
              添加项目
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void saveDraft("draft")}
              disabled={saving || !draft.projectPath.trim()}
            >
              {saving ? <LoaderCircle className="animate-spin" /> : <Clock3 />}
              保存配置
            </Button>
          )}
        </div>
      </header>

      {view === "home" ? renderHome() : renderWizard()}

      {picker ? (
        <PathPickerSheet
          open
          onOpenChange={(open) => {
            if (!open) setPicker(null)
          }}
          kind={picker.kind}
          initialPath={
            draft[picker.field] ||
            draft.projectPath ||
            launcher.defaults.projectPath
          }
          title={picker.title}
          description={picker.description}
          onSelect={(path) => {
            if (picker.field === "sourceSpecPath") {
              selectSourceSpec(path)
              return
            }
            setDraft((current) => ({
              ...current,
              [picker.field]: path,
              ...(picker.field === "htmlPath" && !current.projectPath
                ? { projectPath: parentPath(path) }
                : {}),
            }))
            if (picker.field === "projectPath") setDiscovery(null)
          }}
        />
      ) : null}

      <AlertDialog.Root
        open={Boolean(removalPreview)}
        onOpenChange={(open) => {
          if (!open && !removingProjectId) setRemovalPreview(null)
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[71] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#11161c] p-5 shadow-2xl shadow-black/50 outline-none">
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
              移除「{removalPreview?.name || "未命名项目"}」？
            </AlertDialog.Title>
            <AlertDialog.Description asChild>
              <div className="mt-3 space-y-3 text-xs leading-6 text-muted-foreground">
                <p>
                  {removalPreview?.deleteToolMaps
                    ? `将从最近项目中移除，并删除工具侧保存的 ${removalPreview.mappingCount} 条页面映射（${removalPreview.mappingFileCount} 个文件）。`
                    : "将从最近项目中移除。已有或项目内的 spec-map.json 不会被删除。"}
                </p>
                <p className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2.5">
                  不会删除 HTML、Markdown Spec 或 product.spec.json。
                </p>
              </div>
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={Boolean(removingProjectId)}>
                  取消
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button
                  variant="destructive"
                  disabled={Boolean(removingProjectId)}
                  onClick={(event) => {
                    event.preventDefault()
                    void confirmProjectRemoval()
                  }}
                >
                  {removingProjectId ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                  {removingProjectId
                    ? "正在移除"
                    : removalPreview?.deleteToolMaps
                      ? "移除项目并删除映射"
                      : "移除项目"}
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <Toaster position="bottom-center" richColors theme="dark" />
    </div>
  )
}
