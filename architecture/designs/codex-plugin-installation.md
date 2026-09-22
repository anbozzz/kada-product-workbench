# 技术架构设计：Codex 插件安装与分发

| 字段 | 内容 |
|---|---|
| Status | implemented |
| Date | 2026-09-02 |
| Project | Interactive Product Spec |
| Scope | 预构建安装包、Agent 安装入口与验证 |
| Product source | 用户确认：由 Codex 代装，使用 Codex 默认目录，再打开目标 Project |
| Technical evidence | scripts/build-plugin-bundle.mjs、src/plugin-readiness.mjs、Codex CLI plugin help |
| Related decisions | [ADR-0004](../../decisions/ADR-0004-codex-managed-installation.md) |

## 1. 结论与适用性

安装会写入用户的 Codex 配置并建立发布边界，需要设计。已实现预构建、带校验清单的本地 marketplace 包，由安装脚本调用官方 CLI；不直接写插件缓存或信任配置。完成 macOS 隔离 CLI、MCP 与工作台验证；不代表 Windows、新用户会话或公开发布完成。

## 2. 目标、范围与依据

### 2.1 必须实现的结果

用户将 INSTALL.md 交给 Codex，即可检查环境、取得正确发布包、安装并继续新任务验收，无需用户手敲命令。

### 2.2 范围内

- 安装说明、可迁移安装包、只读预检、显式安装、重复安装检查和发布校验。

### 2.3 明确不改

- 不修改工作台界面、项目扫描范围、PRD/Spec/Map 所有权、HTML 完成协议或现有用户安装。
- 不发布仓库、不自动信任 Hook、不自动安装 Node、不处理其他 Agent。

### 2.4 当前事实与证据

- 现有 builder 从上级 Workspace 取两项 Skill，生成的安装命令含开发机路径；改为显式打包输入和相对安装入口。
- Codex CLI 支持 marketplace add/list、plugin add/list；实际安装副本和启用状态由 Codex 管理。
- 原入口必须保留项目中心、PRD 阅读/绑定、Spec 绑定/编辑、评审、导出、提交 Codex 和离开。

### 2.5 Unknown / TBD

- 当前 Git 无远程仓库；公开下载地址与实际发布由维护者确定，不编造。
- Windows 原生安装与用户新会话 Hook 信任验收不能由 macOS 自动测试代替。

## 3. 架构驱动因素

### 3.1 业务不变量与硬约束

- 安装不读写业务 Project；来源目录与 Codex 安装缓存不是同一概念。
- 下载包必须来自用户确认的来源；哈希只证明一致性，不证明发布者身份。
- 预检失败不得修改安装；同名插件或 marketplace 冲突失败关闭，不自动卸载、覆盖或切换来源。

### 3.2 质量场景

| ID | 来源（Source） | 刺激（Stimulus） | 环境（Environment） | 对象（Artifact） | 响应（Response） | 响应指标（Response Measure） |
|---|---|---|---|---|---|---|
| QA-01 | 用户 | 在含中文空格的陌生目录解压安装 | 无开发 Workspace | 发布包 | 独立预检和启动 | 无绝对开发路径依赖 |
| QA-02 | 安全 | 修改一个包内文件或已有同名来源 | 用户配置 | 安装器 | 拒绝安装 | 不执行变更命令 |
| QA-03 | 用户 | 同版本重复安装 | 已安装环境 | 插件 | 验证实际副本后复用 | 不重复变更配置 |

## 4. 整体设计

### 4.1 领域与所有权

发布者拥有版本、预构建文件与校验清单；Codex 拥有用户安装、缓存与信任；Project 拥有业务资料。安装器只编排，不能成为第二个插件注册表。

### 4.2 静态结构

INSTALL.md 指导 Agent 获取发布包；包内 install.mjs 委托 plugin-install.mjs；builder 默认从仓库发行快照组装七项 Skill 和运行依赖，显式输入仅用于兼容重建；release 脚本生成归档与 SHA-256。运行副本不依赖源码仓库的位置。

### 4.3 运行交互

确认来源 → 下载并校验归档 → 解压 → 只读预检 → 用户授权 → 官方 CLI 注册与安装 → 核对实际安装副本 → 用户信任 Hook → 新任务打开目标项目。重复安装先查已装状态；部分安装失败保留现场并说明可重试，不回滚其他插件配置。

### 4.4 状态与数据

release.json 是发布清单，不是用户安装记录。安装结果区分 checked、installed、already-installed；三者都不宣称 Hook 已信任或新会话已加载。无业务数据迁移。

### 4.5 部署与运维

用户准备 Node 与支持插件命令的 Codex。安装来源保存在用户选择的稳定目录；最终副本交给 Codex。版本更换必须明确请求；旧来源保留，便于检查和恢复，不自动删除。发布包不携带源码中的临时产物、机器路径、账号配置。

## 5. 候选方案与取舍

| 候选 | 收益 | 代价与风险 | 是否采用及原因 |
|---|---|---|---|
| 预构建包＋官方 CLI | 无需用户构建，安装归 Codex 管理 | 需要发布包和环境预检 | 采用 |
| 只有两条安装命令 | 实现更少 | 环境、完整性、冲突和重试均依赖 Agent 猜测 | 不采用 |
| 自写全局安装目录和注册表 | 跨 Agent 灵活 | 与当前只服务 Codex 的目标无关，增加第二套状态 | 不采用 |

## 6. 实施、迁移与回滚

1. 修订 builder，明确 Skill 输入、复制正式说明与安装器、生成清单。
2. 实现安装预检和官方 CLI 编排，再增加发布归档命令。
3. 用隔离配置验证真实 CLI 安装、重复安装和包内工作台；运行统一验证。

- 兼容与迁移：既有安装保持不动；不自动从 personal 迁移到发布包来源。
- 回滚点：失败保留包和 CLI 错误；安装器不自动卸载。用户明确要求后可用 Codex 官方移除命令，仅移除指定插件/来源。

## 7. 验证与可观测性

| 驱动因素/风险 | 验证方式 | 通过条件 | 证据位置 |
|---|---|---|---|
| QA-01 | 发布包迁移、真实 CLI 和工作台冒烟 | 安装副本可从目标项目启动 | tests/plugin-install.test.mjs、scripts/verify-plugin-install.mjs |
| QA-02 | 损坏、链接、冲突与命令失败测试 | 非零退出且不越权修复 | tests/plugin-install.test.mjs |
| QA-03 | 同版本二次安装 | 复用且核对实际文件 | tests/plugin-install.test.mjs |
| 原功能 | npm run verify | 原工作台旅程通过 | scripts/verify.mjs |

## 8. 决定、风险与后续

### ARCH-PLUGIN-SKILL-SNAPSHOT-001：共享方法随源码与安装包交付

- 状态：implemented（2026-09-21）；用户要求自行维护的 Skill 纳入咔哒，客户下载到本地后可用。
- 原因：仅维护者能提供 `--skills-root` 时，独立 checkout 缺少 PRD、Spec 和架构方法，无法复现发布。
- 边界：共享目录仍是三项文档 Skill 的维护源；`plugin-skills/` 保存完整、可追溯的发行快照。维护者用显式 `sync:skills -- --source "共享 Skill 根目录"` 同步，`--check` 只比较；默认打包只读取仓库快照。客户安装和运行不读取共享目录、不联网追踪最新规则、不修改业务资料。
- 采用：同步完整 references、agents、scripts 和 assets，记录相对文件与 SHA-256，不记录开发机绝对路径。同步前检查跨 Skill 文件引用，发布前检查快照是否被局部修改。现有 `--skills-root` 保留为显式兼容输入，并校验其引用；发布清单记录实际出包文件。更新规则须随新插件版本分发，已安装客户沿原官方升级流程。
- 明确不改：工作台 UI、PRD/Spec/Map 的所有权、产品规则、普通/gate 写回及用户当前安装。七项 Skill 清单保持不变，不恢复已合并的独立 Spec Skill。
- 否决：源码 symlink 到维护者目录（不能迁移）；安装时下载浮动最新规则（版本不可复现）；只有 SKILL.md 没有依赖资源（无法执行）。
- 验证：共享源与发行快照 21 个文件一致；默认打包、显式输入兼容、缺失引用/快照漂移失败、移动后包内方法与 CLI、macOS 隔离真实安装/重复安装/MCP/工作台启动通过。统一验证通过（204 项 Node 测试及全部浏览器旅程）。目标项目未因安装改写。Windows/Linux 实机、客户新任务 Hook 信任与公开下载地址仍待发布阶段处理。

### ARCH-PLUGIN-SKILLS-001：随包提供想法澄清、图形与 HTML 页面生成能力

- 状态：implemented（2026-09-05）；用户授权将审问、流程图、UI 设计及 Ant Design／Ant Design Mobile 纳入工具。
- 原因：目标用户可能没有其他个人或 Project Skill；安装包需要独立提供从想法到 PC／APP 形态 HTML 的方法和必要资源。
- 边界：当时四项共享文档 Skill 以 `--skills-root` 显式提供（当前已合并为三项，发行来源由 ARCH-PLUGIN-SKILL-SNAPSHOT-001 替代）；新增能力在本仓库 `plugin-skills/` 固定来源和版本，打包到同一 `skills/`。Agent 负责调用与页面实现，工作台继续拥有原阅读、映射和评审能力。
- 采用：复用并记录已有 grilling、diagram-design、UI UX Pro Max 来源；新增 `ant-design-html` 负责终端选择、已有工程接续，以及空项目的 PC／APP HTML 起步代码。Ant Design 与 Ant Design Mobile 是目标页面依赖，不进入工作台 UI。模板使用固定依赖版本，经构建输出内嵌 CSS／JS 的单文件 HTML。
- 明确不改：原工作台页面、业务文档及 Map 所有权、HTML 完成协议、用户现有工程组件体系；不产出原生 APP 安装包，不为用户自动确认产品内容。
- 否决：依赖用户另装 Skill（无法保证能力齐全）；仅加名称或远程链接（离开开发机不能使用）；将 Ant 组件替换工作台本身 UI（与本轮目标无关）。
- 回归：缺失 Skill 资源必须拒绝就绪；移动安装包后验证方法和脚本可用；从包内入口在空目录创建 PC／APP 工程、构建并操作页面，随后通过原工作台入口加载。运行统一验证。结构检查、示例运行与真实用户 Agent 的效果验收分别报告。
- 结果：0.12.0 包含八项 Skill；统一验证、隔离安装及安装副本中的查询、图形校验、PC／APP 空目录生成与浏览器交互通过。已用官方命令更新本机 personal 插件，1,422 个安装文件与发布清单一致。细节及新任务验收边界见 [发布记录](../../RELEASE.md)。本轮能力归入安装与 Agent 使用方法，已核对现有 PRD／Spec 的文档和工作台职责，无需修订页面行为。

- ADR：[ADR-0004](../../decisions/ADR-0004-codex-managed-installation.md)。
- RFC：不适用，当前根 Agent 可完成取舍。
- 残余风险：公开来源、Windows 实机和新用户信任流程需发布前补齐；不把隔离 CLI 成功称为全部用户验收。
- 后续触发：接入其他 Agent、改变包来源或自动更新策略时重访。
