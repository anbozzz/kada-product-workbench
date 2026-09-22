# 独立决定、协商与既有多文档管理

仅在需要选择既有多文档入口、ADR 或 RFC 时读取。普通产品任务在一份独立架构设计维护技术决定，Spec 为其派生视图。

## 按信息选择产物

| 信息 | 落点与下一份参考 |
|---|---|
| 只服务当前讨论的技术候选 | 留在当前任务，不创建文件 |
| 需要指导实现的整体架构设计 | [独立设计标准](architecture-design-standard.md) 与 [设计模板](../assets/architecture-design-template.md) |
| 跨任务持续约束实现的重要决定 | 本文件第“ADR 与 RFC 规格”节；独立 ADR 使用 [ADR 模板](../assets/adr-template.md) |
| 决定前需要多方异步意见或承诺 | 本文件第“ADR 与 RFC 规格”节与 [RFC 模板](../assets/rfc-template.md) |
| 已实现并验证的当前架构事实 | Project 已采用的 `ARCHITECTURE.md` 或等价入口，依据源码和测试维护 |
| 当前进度和阻塞 | Project 已有 Progress 机制，只链接正式产物，不保存另一份设计 |

读取实际所选标准；只有采用模板时读取模板。沿用八章 Architecture Design 或独立 ADR、RFC 时，从本 Skill 目录运行 `python3 scripts/validate_architecture_artifact.py <文件路径>` 检查；整份 Spec 不送入该验证器。

## 路径

优先沿用 Project 的 `AGENTS.md`、README/索引或正式架构入口。符合独立文件条件但无既有路径时，首个真实产物使用：

- 设计：默认 `architecture/designs/product.md`；仅 Project 已按主题分文件时沿用其 `<scope-slug>.md` 入口，不为本次任务另建平行设计。
- ADR：`architecture/decisions/ADR-<NNNN>-<decision-slug>.md`
- RFC：`architecture/rfcs/RFC-<NNNN>-<topic-slug>.md`
- 当前架构总览：Project 根 `ARCHITECTURE.md`

不预建空目录，不为统一外观迁移已有 `docs/architecture/`、`adr/` 等路径。编号从已有最大值递增，空目录从 `0001` 开始；slug 沿 Project 命名惯例，无惯例时用简短英文 kebab-case。

## 引用与状态

- 设计可引用产品文档、源码、接口和 ADR，不复制其正文。状态为 `proposed → adopted → implemented → superseded`。
- ADR 保存决定原因与后果，设计说明决定怎样组合。ADR 状态为 `proposed → accepted/rejected → deprecated/superseded`。
- RFC 状态为 `draft → open → closed`；关闭记录 `adopted / rejected / withdrawn / replaced`。采纳且长期有效的决定回当前独立架构；Project 已采用 ADR 时进入 ADR，由 RFC 链接。
- 当前架构总览只保存已实现且验证的事实，不收录候选、讨论过程或未实现设计；技术方案采纳不等于产品确认。
- Spec 与独立产物不能各维护一套当前决定。迁移须有用户授权，先核对范围、ID、状态、版本、引用和历史；未授权迁移的入口继续有效。

## ADR 与 RFC 规格

### ADR：保存最终技术决定

使用 [`../assets/adr-template.md`](../assets/adr-template.md)。以下字段和章节语义固定：

- 元数据：`status、date、scope、supersedes、superseded-by`。
- Context and Problem：为什么现在必须决定、影响哪些结构或质量属性。
- Decision Drivers：真正影响选择的约束和可验证质量场景。
- Considered Options：真实可行候选，不为凑数制造选项。
- Decision Outcome：选了什么以及为什么。
- Consequences：收益、代价、风险和后续责任。
- Confirmation：怎样从源码、测试、运行指标或 Review 证明实现仍遵守决定。
- More Information：相关 Design、RFC、产品来源和证据链接。

状态只使用：`proposed、accepted、rejected、deprecated、superseded`。被新 ADR 替代时，旧 ADR 保留并双向链接，不覆盖历史原因。

一个架构变化可能只需要一个 ADR，也可能由多个独立决定组成；不要把完整设计文档拆成“一章节一个 ADR”。只有存在可替换方案、会长期约束实现并值得解释“为什么”的内容才是 ADR。

### RFC：决定前征求多方意见

使用 [`../assets/rfc-template.md`](../assets/rfc-template.md)。只有多个独立责任方必须异步提出意见、承诺接口或承担运行责任时才使用。根 Agent 可以自己完成的技术取舍直接写当前独立架构文档或已采用的 Architecture Design/ADR，不创建虚假的协商流程。

RFC 固定包含：状态和期限、问题与范围、约束、提案、接口和责任变化、候选取舍、迁移回滚、验证、明确问题、意见记录和关闭结果。

RFC 状态只使用：`draft、open、closed`。关闭结果只使用：`adopted、rejected、withdrawn、replaced`。`adopted` 只说明提案被采用；长期决定的原因和验证方式回到独立架构文档或该 Project 已采用的 ADR，不能产生第二个决定源。

### 决策责任

- 技术方案、方法选择和技术取舍由当前任务根 Agent 负责。
- 产品用户只回答产品、业务、临床、安全、成本或不可逆边界，不承担技术投票。
- 多方意见可以改变候选或约束，但最终文件必须明确谁拥有实现、接口、数据和运行责任。

两类文件交付前都运行 `python3 scripts/validate_architecture_artifact.py <文件路径>`。验证器只检查固定字段、章节顺序、状态值和未清理占位符，不替代技术 Review。

## 决定写法示例

以下是假设跨模块申请的独立 ADR 内容示意，不提供真实项目事实；仅在采用 ADR 时展开到模板章节。

- 问题：申请模块和下游都能改申请状态，需明确所有者。
- 驱动因素：唯一事实源、结果未知可恢复、模块可独立演进。
- 候选：申请模块统一维护、各下游直接写、独立全局状态服务。
- 候选采用：申请模块拥有生命周期，下游经明确合同返回结果；不新增无实际需要的状态服务。
- 后果：职责清楚，但需关联原申请、处理未知结果和既有所有权迁移。
- 验证：依赖检查证明写入口唯一；集成测试覆盖重复、拒绝、超时和恢复；日志可关联原操作。
- 状态：没有真实环境依据时保持 proposed；替代历史 ADR 时保留原因及双向链接。
