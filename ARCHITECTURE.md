# 架构契约

本文件只约束已经实现的代码职责、架构变化触发和验证入口。[产品系统蓝图](product-blueprint.md)拥有跨能力产品骨架，[产品需求文档草稿](drafts-documents/Interactive%20Product%20Spec产品需求文档.md)拥有详细产品行为，[目标技术架构](architecture/designs/product-work-lifecycle.md)记录已采用架构及分阶段实施状态；[README.md](README.md)只维护安装、启动、使用和当前能力概览。本文件不复制这些产物的正文，也不把尚未完成的阶段表述为当前实现。

## 职责边界

- `spec-derivation.mjs` 仅根据 PRD 的明确来源声明和独立架构生成 Markdown Spec；保存持久派生基线，报告当前净差异，核对逐项回执后发布。它不写 PRD、架构或 Map，不调用模型，不改普通/gate 保存策略；旧非派生文档不自动覆盖。来源边界、并发恢复与验证见[派生设计](architecture/designs/spec-derivation.md)。

- `schemas/` 是结构契约；`scripts/generate-contract-types.mjs` 生成前端类型，禁止手工维护平行类型。
- `src/contracts.mjs` 只补充 Schema 无法表达的跨引用和语义校验。
- `spec-projection-integrity.mjs` 比对标准 Markdown 节点标题与内部投影的 ID、类型；`projection-service.mjs` 在新生成和缓存复用时执行，防止普通操作被过滤。统一 Spec 的工程章节保留在原 Markdown，不伪装成业务节点；bundle 是页面与节点视图，不能反向重建整份正文。它不判断 PRD 产品语义是否完整，也不改写来源或 Map。
- `html-delivery-session.mjs` 只在 `SessionStart` 提供 HTML 完成协议；`html-delivery.mjs` 只校验 Agent 显式上报的 Project 内 HTML 并计算 revision，固定返回 PRD 与统一 Spec 的待同步任务；`html-delivery-mcp.mjs` 只负责 MCP。HTML 完成上报本身不弹窗、不持久化选择、不扫描目录，不用 `UserPromptSubmit` 或 `Stop` 推断完成，不读写 PRD/Spec。
- HTML 上报不证明文档已同步。当前 Agent 使用 product-documentation，先核对 PRD 再核对 Spec，核对当前文件并完成必要局部修订后才报告本轮完成；相同 revision 重试和旧 `prdFollowup` 均不免除同步，旧选择状态不读取或删除。仅 PRD 修订不上报 HTML，不新增同步数据库或全产品验收门槛。见 [ADR-0005](decisions/ADR-0005-html-delivery-document-sync.md)。
- `src/server.mjs` 只负责 HTTP 与服务生命周期编排；本地来源装配、`ReviewBaseline` 和工作台能力集合归 `review-session.mjs`，映射写入、只读 Spec 投影任务、PRD 标准化草稿任务、Spec 写回分别归 `map-store.mjs`、`projection-service.mjs`、`prd-draft-service.mjs`、`spec-service.mjs`。
- `ReviewBaseline` 是当前活动工作上下文的逻辑版本向量，由 `/api/config` 返回，不是新的项目文件或审批状态。它包含页面来源身份及 PRD、Markdown Spec、内部投影和两类 Map revision；兼容期继续保留原扁平配置字段。
- `spec-service.mjs` 统一执行 Spec Schema、草稿 revision 和 Map 兼容性校验，之后只能选择 `DirectSourceCommit` 或 `CodexGateCommit`。HTTP 路由和前端不得新增第三种写回策略。
- `src/review-package.mjs` 负责可移植 ZIP 评审包、只读配置脱敏与包内本机查看器；`runtime/windows-x64/open-review.exe` 是由 `scripts/windows-review-launcher/main.c` 生成的 Windows x64 免安装只读启动器。`server.mjs` 只负责准备和流式下载，不得把现有工作台写接口带入评审包。
- PRD 结构解析只归 `prd-service.mjs`；页面到 PRD 章节关系只归 `prd-map-store.mjs`，不得与 DOM 级 `spec-map.json` 合并。2026-09-06 按用户确认解除功能内固定四小节要求：校验保留文档身份、章节边界、稳定 ID 和非空正文，功能内标题按内容组织，完整 Markdown 仍是阅读来源。原因是格式合同不应把业务分支强制装入通用小节；否决新增一套固定异常模板或第二种 PRD。既有四节正文和 Map 格式不改，回归覆盖自由分支、简单正文、旧格式与原阅读/绑定路径。
- `prd-review-service.mjs` 只拥有选区批注、revision、反馈批次、评审会话及确认请求的工具侧记录，不写 PRD、HTML 或 Map。`prd-review-mcp.mjs` 在原 MCP 连接内持有工作台服务，把显式提交或确认请求返回同一等待任务；修订发布和确认完成都只读取并验证原任务更新后的 PRD。正式文档状态归产品文档流程，评审会话与反馈批次不能替代它。`prepareStudioProject` 的内部批注装配选项不创建 Map 或最近项目记录。正常绑定和 Spec gate 不使用此选项。详见 [ADR-0006](decisions/ADR-0006-prd-annotation-return.md) 与 [ADR-0008](decisions/ADR-0008-prd-review-document-status.md)。
- `prd-review-entry.mjs` 仅处理生成后评审时机，按 Project/PRD 真实路径及 revision 将选择原子保存到工具侧；共享 MCP 传输在支持表单的客户端请求选择，此能力不接入 HTML 上报用例。稍后不启动服务，原任务保留文档与继续入口；开始复用原 open/wait 链。仅显式 PRD 批注允许无 HTML 的 document 目标，复用同一全宽 PRD 阅读器，普通来源向导与映射不变。详见统一 Spec 的 `ARCH-PRD-REVIEW-ENTRY-001`。
- `prd-images.mjs` 只读取 PRD 实际引用且 realpath 仍在所选 Project 内的相对路径位图；按类型签名和单图/文档限额生成只读快照，由 `review-session.mjs` 装配到 PRD 视图。图片快照及引用定义随评审包保留，不开放通用文件接口、不改写 PRD/图片/Map；前端缩放仅为运行态。详见[PRD 图片设计](architecture/designs/prd-inline-images.md)。
- 用户从项目中心明确发起的 PRD 草稿和 JSON 投影都必须经 `codex-app-server.mjs` 的 `startVisibleCodexThread` 创建为非临时的用户任务、设置稳定标题，并提供 `codex://threads/{id}` 直接打开入口；两个用例不得各自拼装会话可见性参数。`codex-prd-draft.mjs` 另把写权限限制到当前 Project，`prd-draft-service.mjs` 预定 `drafts-documents/` 目标、保护原 PRD revision，并在回填前调用 `prd-service.mjs` 重新校验。它不得复用只读投影任务、覆盖原 PRD、创建 `prd-map.json` 或改变两种 Spec 提交策略。
- `ui/src/App.tsx` 编排工作台；映射保存状态归 `use-map-persistence.ts`，项目中心的 Codex 投影会话与 PRD 草稿会话分别归 `use-projection-conversation.ts`、`use-prd-draft-conversation.ts`。HTTP 传输只允许进入 `lib/api-client.ts` 及工作台、项目中心各自的 `*-api.ts` 用例模块，顶层组件和任务 hook 不直接 `fetch`。工作台不复制 HTML 页面运行态；页面地址只负责尽力导航，不决定人工关联是否有效。
- 页面明确地址由 `candidate-discovery.ts` 完整解析并导航，不依赖子组件 Map。节点定位先恢复人工目标（唯一目标、类型及指纹校验），失败时可导航所属页但不冒充组件命中；未绑定节点先导航再做页内匹配。未知路径不探查，浏览和评审预览不执行业务动作、不写 Map。新选择取消旧定位，见 [ADR-0009](decisions/ADR-0009-page-first-spec-navigation.md)。
- 只读评审包必须把 `ReviewBaseline` 的本机页面路径改写为包内相对来源，并把 `capabilities` 全部关闭；不得因新增配置字段重新泄露本机路径或开放写能力。
- PRD 评审令牌、批注和轮次不进入只读包。批注 HTTP 接口仅在明确 PRD 会话可用，限制 loopback Host/Origin、JSON 和会话令牌；提交/保存校验来源 revision，发布校验当前批次和磁盘 revision。前端批注请求归 `prd-review-api.ts`，轮询归 `use-prd-review.ts`；未变化时只返回连接状态，不重复传输正文和图片。
- PRD 批注复用普通 PRD 的可拖宽抽屉；仅显式批注会话为抽屉预留画布宽度，保留同一个 `CanvasWorkbench` 及完整底栏，不改变普通绑定/评审的布局。`prd-selection-popover.tsx` 用 Radix 虚拟锚点呈现就地评价，Range 只在内存中，恢复仅按原引文与源行定位；`prd-review-panel.tsx` 仍拥有标签页草稿、待发评价与提交，底部 Beautiful UI Prompt Bar 只负责汇总输入。未完成评价扩展同一草稿，兼容旧选区草稿，不新增服务状态。提交携带完整批注在服务内一次校验落盘；旧 save/submit 调用兼容。批次 ID 在重试时复用，避免响应丢失造成重复发送。
- [ADR-0007](decisions/ADR-0007-prd-batch-queue-and-stop.md) 将批次与会话状态解耦：v2 支持排队/领取/撤回/请求停止/确认停止/发布/旧版核对，旧 submitted 缺乏领取证据，恢复为待核对而非自动执行。队列由 `prd-review-service.mjs` 串行持久化，`prd-review-queue.tsx` 只呈现动作；草稿按 session 暂存，不因 revision 重挂载。提交按源 revision、撤回/停止按批次状态冲突，不能因别批领取误拒新草稿。`wait_prd_feedback` 原子领取；`get_prd_feedback_status` 和 `acknowledge_prd_stop` 形成合作停止协议，未确认不开始下一批、不允许发布、不得宣称原生任务中断。正文写入与回滚均不归队列服务。
- [ADR-0008](decisions/ADR-0008-prd-review-document-status.md) 将正式 PRD 的 `草稿 / 评审中 / 已确认 / 已替代` 与评审会话、反馈批次分离。工作台只能提出确认请求；原任务使用产品文档流程完成正式文件确认后，`complete_prd_confirmation` 才按用户请求源 revision、正式文件状态、产品身份、稳定需求 ID、除状态外正文一致性和最终 revision 闭合会话。
- PRD 已发送队列在本会话发布后保持顺序，提交快照与当前处理基线分开；发布 MCP 通过 `nextFeedback` 直接返回下一批，外部改动及旧协议待核对仍阻断。详见统一 Spec `ARCH-PRD-QUEUE-CONTINUE-001`。
- PRD 空闲等待在服务内部按持久化状态事件唤醒；MCP 默认长等待、按请求取消与会话单等待保护，超时不得诱导模型续询。详见统一 Spec `ARCH-PRD-IDLE-WAIT-001`。
- `progress/_index.md` 只记录需要恢复的当前工作，不是架构事实源。
- 插件打包必须同时带出 `product-documentation`、`software-architecture-design` 与 `prd-concise-cn`，保证统一 Spec 及工程方法的同级引用可用。文档现状和生成/修订决定仍归 Skill；HTML 完成不选择 PRD 类型，保真压缩仅用于明确的压缩请求。
- 插件发布默认使用仓库 `plugin-skills/` 的完整发行快照和自包含校验包；三项共享方法用 `sync-plugin-skills.mjs` 从显式维护源同步，记录相对文件哈希并检查引用，默认打包拒绝快照漂移。兼容显式 `--skills-root`，但客户不需要维护者目录；`plugin-install.mjs` 只编排 Codex 官方命令，实际安装、启用和信任状态归 Codex。不得新增安装注册表、手写用户配置、自动信任 Hook 或因安装改写业务 Project。安装成功与新会话验收分别报告。见 [ADR-0004](decisions/ADR-0004-codex-managed-installation.md) 与 [安装设计](architecture/designs/codex-plugin-installation.md)。

- `review-session.mjs` 保留已载入 Markdown 原文快照，`spec-document-reader.tsx` 复用现有渲染器只读全文与章节导航；直接写回成功时同步，gate 草稿不替换原文，导出沿现有配置冻结。`document-update-service.mjs` 检查当前已选来源并原子装配新版内存快照；`markdown-spec-reader.mjs` 只读取标准 Markdown 节点、原始字段和明确页面，不调用模型或写回正式文档。普通工作台的更新提示由 `use-document-updates.ts` 轮询，显式加载时保留画布、选择及阅读位置；节点编辑、未保存章节选择与 gate 草稿受保护。PRD 批注和冻结包继续沿原生命周期。人工 Map 中已删除节点的引用保留，更新不会清空 Map。 节点顶层命名小节与旧式命名列表均须投影为原名字段；标题字段编辑按原标题层级写回，保留子标题、列表、表格与代码，页面匹配元数据不得被并入字段正文。

## 本项目的架构变化边界

通用触发和风险分级继承用户级 `~/.codex/AGENTS.md`。在本项目中，改变 Markdown、JSON 投影、HTML 或 `spec-map.json` 的所有权和写回方向，或合并、删除、改写“普通本地直写”与“Codex gate 草稿回传”任一路径，均属于事实源或核心流程变化，必须按上游架构变化规则处理。

## 统一验证

- `npm run check:architecture`：职责和依赖边界。
- `npm test`：契约漂移、UI 构建与 Node 行为测试。
- `npm run verify`：在上述检查后，用本机 Chromium 浏览器验证从 Spec 列表进入页面映射、节点选择后的辅助定位、无精确路由的动态场景关联、手动进入后恢复定位、关联约束分组与展开、保存状态、iframe 触控板缩放、模式切换、只读 ZIP 导出和离开入口。
- 同一验证入口还运行 `prd-review.browser.mjs`：无 Spec/Map 的完整 PRD、选区评论、保存后刷新、同一等待连接回传、两轮发布、全文/差异、收起恢复和结束。文件修订由测试中的原任务模拟，不能把这项测试称作真实模型语义修订验收。

自动验证只能证明代码和可见交互回归，不代表业务验收或人工评审已经完成。

## 局域网发布实现边界

`publication-service.mjs` 承接本机管理 API，`publication-client.mjs` 连接独立 `publication-daemon.mjs`；后者独占注册表写入、对外快照读取和项目会话。`publication-store.mjs` 负责原子持久化，`publication-lock.mjs` 负责操作系统单实例锁。ZIP 与发布共用 `collectReviewSnapshot`；工作台与项目中心复用 PublicationManager，不开放编辑服务至局域网。合同与平台验收边界见 [LAN-PUBLISH-001](architecture/designs/product-work-lifecycle.md#46-多项目局域网发布lan-publish-001)。统一验证包含 publication Node 测试和原入口双项目浏览器旅程。

## 工作台运行管理

`workbench-runtime.mjs` 拥有私有实例登记、逐实例身份探活、普通启动互斥与兼容复用、关闭握手；`server.mjs` 提供实时项目/任务状态并仅关闭本实例。`RuntimeManager` 沿原顶部入口展示连接状态并汇报当前标签页未保存状态，通信失败不能自行解除关闭冻结。CLI `open` 提供经核实的后台启动与复用入口。独立 Codex/PRD 接收会话不合并。决定与回归范围见 [WORKBENCH-RUNTIME-001](architecture/designs/product-work-lifecycle.md#工作台实例与可用状态workbench-runtime-001)。
