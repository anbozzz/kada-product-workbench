---
status: accepted
date: 2026-09-01
scope: Interactive Product Spec 本地服务的评审会话、Spec 写回与前端用例边界
supersedes: 无
superseded-by: 无
---

# ADR-0001：以评审基线和应用服务收敛产品工作闭环

## 背景与问题（Context and Problem）

项目已经从 Spec 查看与页面关联工具演化为覆盖 PRD、Markdown Spec、内部投影、两类页面关系、Codex 回流和只读交付的产品工作闭环。现有能力可以工作，但来源装配集中在 `src/server.mjs`，前端顶层组件直接组合多个 HTTP 用例，普通本地直写与 Codex gate 的提交差异仍由条件分支表达。

本项目将在本周开源。继续只增加功能会让新贡献者难以判断正式来源、活动基线和唯一写回路径，也会扩大混合 revision、第三条提交链及顶层编排器继续膨胀的风险。因此需要在不改变现有入口和用户结果的前提下，先形成可以由源码和测试约束的应用边界。

## 决策驱动因素（Decision Drivers）

- 保持项目中心、单工作台、绑定、评审、Codex gate 与只读导出的既有入口和结果。
- Markdown Spec 继续是唯一正式 Spec 正文；内部 JSON 只作为可重建投影。
- PRD、Spec、页面和两类 Map 必须能表达属于哪一次活动工作基线。
- 所有 Spec 修改共享 Schema、revision、Map 兼容性和冲突政策，只允许两个明确提交所有者。
- HTTP 路由和 React 顶层组件只负责编排用例，不继续拥有来源装配、提交策略或传输细节。
- 以可增量回滚的模块化重构完成开源前治理，不引入本周无法验证的新基础设施。

## 候选方案（Considered Options）

1. 保持本地模块化单体，新增 `ReviewBaseline` 会话聚合、显式 Spec 提交策略和前端应用 API 边界。
2. 只补充架构文档，保留当前顶层装配和条件式提交，等开源后再重构。
3. 按 PRD、Spec、映射、投影和交付拆分数据库与多个服务。

## 决定结果（Decision Outcome）

采用：候选 1。

原因：它直接治理当前已经存在的责任混合和一致性风险，同时不改变产品流程、项目文件 Schema、部署方式或来源权威。`ReviewBaseline` 第一阶段是服务装配出的逻辑版本向量，不新增持久化文件；Spec 提交保留 `DirectSourceCommit` 与 `CodexGateCommit` 两种策略；前端通过用例 API 模块调用现有接口。候选 2 无法给开源贡献建立可执行边界，候选 3 的分布式一致性、部署和运维成本与当前本地单用户产品事实不匹配。

## 后果（Consequences）

### 正向影响（Positive）

- `/api/config` 可以同时返回活动基线和能力集合，调用方不必从分散字段推断会话条件。
- 两种 Spec 提交共享同一验证入口，不允许新增隐藏写回路径。
- 服务端来源装配和前端 HTTP 传输从大型编排器中抽离，新增能力有明确落点。
- 旧的扁平配置字段和 HTTP 路由暂时保留，现有页面与外部调用无需同步迁移。
- 架构检查可阻止顶层组件重新持有持久化请求或模块反向依赖。

### 负向影响与风险（Negative / Risks）

- 兼容期同时存在扁平配置字段与 `reviewBaseline`、`capabilities`，需要在后续主版本中明确清理窗口。
- `ReviewBaseline` 当前只在打开会话时装配，不是跨进程可恢复的编辑会话，也不解决多人协作。
- 抽离模块会移动较多代码；必须通过定向测试和当前真实入口旅程证明行为未漂移。
- 本决定不解决路径派生 Project 身份的跨设备局限，远程协作进入范围时需要另立决定。

## 验证遵循情况（Confirmation）

- 架构制品校验器确认本 ADR 字段、状态和关联完整。
- `scripts/check-architecture.mjs` 检查服务端通过 Review Session 组合来源、策略模块不反向依赖服务端、顶层 React 组件不直接持有应用请求。
- Node 定向测试覆盖基线装配、普通直写、Codex gate、revision 冲突与 Map 不兼容。
- `npm run verify` 必须通过全部契约、构建、Node 测试与当前浏览器旅程。
- 从原项目中心和唯一来源直达入口复核绑定、评审、离开、提交与导出连续性。

## 关联信息（More Information）

- Architecture Design：[产品事实工作闭环](../architecture/designs/product-work-lifecycle.md)
- RFC：不适用；本次不新增外部接口或跨团队协议
- 产品与技术依据：[产品系统蓝图](../product-blueprint.md)、[产品需求文档草稿](../drafts-documents/Interactive%20Product%20Spec产品需求文档.md)、[当前架构契约](../ARCHITECTURE.md)
- 重访条件：需要持久恢复编辑会话、引入多人/跨设备协作、增加第三类提交所有者，或准备移除旧扁平配置字段时
