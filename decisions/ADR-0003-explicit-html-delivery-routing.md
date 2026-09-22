---
status: accepted
date: 2026-09-02
scope: Interactive Product Spec 插件的 HTML 完成触发与 PRD/Spec Skill 路由
supersedes: 无
superseded-by: ADR-0005 取代文档选择、跳过与决定去重；显式完成上报仍有效
---

# ADR-0003：以显式 HTML 完成上报替代 Stop 扫描

2026-09-03：本文保留原决定背景。当前文档同步行为以 [ADR-0005](ADR-0005-html-delivery-document-sync.md) 为准，不再使用下述选择弹窗和跳过路径。

## 背景与问题（Context and Problem）

旧插件在每轮 `UserPromptSubmit` 时递归扫描当前 cwd 的 HTML 建立 hash 基线，在每个 `Stop` 再次扫描并询问是否生成 Spec。插件全局启用时，任意项目停止、工作台自身构建、同步或 Git 切换都可能改写 HTML 并误触发；文件变化也不能证明用户要求的 HTML 已完成。产品现已同时包含 PRD 与补充型 Spec，插件在读取 Project 前更不能提前决定生成或更新哪类文档。

用户确认的新流程要求：即使没有预先调用 Skill，只要 Codex 完成任意用户要求交付的本地 HTML，也询问进入 PRD、Spec 或暂不处理；选择后才由对应 Skill 读取 Project 并判断生成或更新。

## 决策驱动因素（Decision Drivers）

- Stop 和 UserPromptSubmit 不得再触发用户确认。
- “随便生成一个 HTML”也必须覆盖，不要求用户知道插件或 Skill。
- HTML 完成必须是执行 Agent 的显式声明，不能从全目录 hash 推断。
- 插件只拥有路由，PRD/Spec 发现和生成/更新决定仍由既有 Skill 拥有。
- 同一批 HTML revision 只能询问一次，非法路径失败关闭。

## 候选方案（Considered Options）

1. `SessionStart` 注入完成协议，Agent 完成 HTML 后显式调用 MCP，MCP 校验并询问路由。
2. 保留 `UserPromptSubmit → Stop`，增加 Project 白名单或更窄扫描。
3. 在 `PostToolUse` 观察 HTML 写入后直接询问。

## 决定结果（Decision Outcome）

采用：候选 1。

原因：它把业务完成事实交还实际执行用户任务的 Agent，同时不要求用户预先调用 Skill。`SessionStart` 只提供窄范围规则，不弹窗；MCP 只在 Agent 明确上报后校验指定 HTML、去重并询问 PRD/Spec；对应 Skill 随后读取 Project，决定生成、更新、候选或失败关闭。候选 2 仍把生命周期停止与业务完成混为一谈，候选 3 会把中间写入或构建产物误当成交付完成。

2026-09-02 连续处理补充：仅 PRD 整理完成由 PRD Skill 给出本次页面跟进建议，不新增 Hook。用户同意后的页面完成仍显式上报；Agent 可声明本批 PRD 已处理、页面跟进已获授权且无新需求差异，MCP 据此记录已处理而不重复询问。新差异、独立批次或上下文缺失走普通选择。相比只追加“不要重复问”的自然语言，这个可选输入使无弹窗行为可验证；相比长期流程凭证或同步数据库，它不建立第二份产品状态。该声明不是插件独立验证的业务事实；不从历史 route、时间戳或文件变化推断，不增加旅程、定稿或合同门禁，不自动进入 Spec。

## 后果（Consequences）

### 正向影响（Positive）

- 任意用户要求交付的 HTML 都可覆盖，无需提前调用 Skill。
- 普通任务停止、图片生成、构建和同步不会因文件扫描自动弹窗。
- 插件对话只表达“进入哪条文档流程”，不提前假设生成或更新。
- PRD 与 Spec 继续由各自 Skill 管理，现有来源和写回边界不变。

### 负向影响与风险（Negative / Risks）

- Agent 若违反会话完成协议，可能漏报；本决定接受这一可见遗漏，不以 Stop 兜底换回全局误触发。
- Codex 外部进程生成的 HTML 不自动触发，因为插件无法证明其业务完成语义。
- 插件升级必须真正替换旧缓存；只修改工作区源码不会停止已安装的旧 Hook。

## 验证遵循情况（Confirmation）

- 插件 Hook 配置只允许 `SessionStart`，架构检查和就绪测试明确拒绝 `UserPromptSubmit` 与 `Stop`。
- 核心测试覆盖任意 HTML、多文件批次、PRD/Spec/跳过、相同 revision 去重、越界和非 HTML 失败关闭。
- MCP 协议测试证明原生 elicitation 返回结构化 route，不返回 Stop `decision:block`。
- `npm run verify` 证明既有项目中心、工作台、映射和交付路径未回归。
- 新插件安装后检查实际缓存，确认旧 baseline、Stop Hook 和 `offer_spec_review` 不再生效。

## 关联信息（More Information）

- Architecture Design：[HTML 交付后的产品文档路由](../architecture/designs/html-delivery-document-routing.md)
- RFC：不适用
- 产品与技术依据：[当前架构契约](../ARCHITECTURE.md)、[产品事实工作闭环](../architecture/designs/product-work-lifecycle.md)、[当前使用与产品边界](../README.md)
- 重访条件：Codex 提供原生交付物完成事件、MCP 可直接加载 Skill，或产品需要覆盖 Codex 外部 HTML 生成时
