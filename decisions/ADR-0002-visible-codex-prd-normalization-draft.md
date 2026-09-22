---
status: accepted
date: 2026-09-01
scope: 项目中心中不合格 PRD 的标准化草稿生成与重新接入
supersedes: PRD 页面关系决定中“不为格式修复自动创建新的 Codex 任务”条款
superseded-by: 无
---

# ADR-0002：通过可见 Codex 任务生成 PRD 标准化草稿

## 背景与问题（Context and Problem）

项目中心已经能精确校验 `可映射PRD-v1`，但不合格 PRD 目前只显示错误并要求用户离开工作台手动调用 Product Documentation Skill。Markdown Spec 缺少内部 JSON 投影时，现有流程已经允许用户明确点击后创建可见 Codex 对话并在完成后继续；PRD 格式修复缺少同等的连续入口。

PRD 标准化会写入新的 Markdown 文件，权限和事实边界不同于只读 JSON 投影。如果直接复用投影任务的只读权限，任务无法落盘；如果让前端或 Codex 自行选择任意输出位置，又可能覆盖原 PRD 或制造不受校验的平行来源。

## 决策驱动因素（Decision Drivers）

- 原 PRD 必须保持字节不变，格式修复不能被表述为产品内容已确认。
- 只有用户明确点击后才能创建可见、可继续的 Codex 对话。
- Codex 写权限只覆盖当前 Project，网络关闭，不允许请求额外审批扩大范围。
- 输出必须固定在当前 Project 的 `drafts-documents/`，并在切换来源前重新通过 `可映射PRD-v1` 校验。
- 失败、中断或生成无效文件时继续保留原选择和精确错误，不创建 `prd-map.json`。
- 新能力进入现有项目中心的 PRD 区域，不新增页面、路由或平行工作台。

## 候选方案（Considered Options）

1. 新增独立 PRD 草稿任务：显式点击后创建可见 Codex 对话，限定写入目标和权限，完成后由服务端校验并回填草稿路径。
2. 继续只显示手动操作提示，让用户离开工作台另行调用 Skill。
3. 复用 JSON 投影任务并把它整体升级为可写任务。
4. 由前端直接在原 PRD 上补标记和章节。

## 决定结果（Decision Outcome）

采用：候选 1。

原因：它保持现有可见 Codex 会话体验，同时把 PRD 写入与 JSON 只读投影分成两个明确用例。服务端决定唯一草稿位置并执行来源 revision 与最终格式校验；Product Documentation Skill 拥有文档重组方法，Interactive Product Spec 只拥有接入门禁。候选 2 的流程不连续，候选 3 会扩大只读投影的权限，候选 4 会破坏原件和产品文档职责。

## 后果（Consequences）

### 正向影响（Positive）

- 用户可在当前 PRD 错误卡片内直接选择模型和推理强度，生成过程和结果在 Codex 任务列表可见。
- PRD 草稿与 JSON 投影共用一个非临时用户任务创建入口，并在任务卡保留可直接打开的 Codex 深链接，避免集成线程归类和侧栏刷新延迟造成重复创建。
- 原 PRD、`prd-map.json` 和 Spec 相关来源均不被后台任务改写。
- 只有通过正式 PRD 解析器的草稿才自动成为当前候选，避免“Codex 完成”等同于“文档可绑定”。
- JSON 投影继续保持只读，PRD 草稿任务的可写权限和持久化状态独立。

### 负向影响与风险（Negative / Risks）

- 本地服务需要维护第二类可恢复 Codex 任务状态，并在重启后提示用户打开既有对话或重试。
- 生成质量仍依赖 Codex 和来源信息；结构通过不代表产品事实已确认，用户仍需阅读草稿。
- 目标草稿已经存在时，Codex 会在同一个 Draft 文件上继续完善；revision 冲突必须失败，不能静默覆盖任务运行期间的外部修改。

## 验证遵循情况（Confirmation）

- 单元测试证明输出路径始终位于 `drafts-documents/`，源文件在成功、失败和取消路径中均保持不变。
- 服务测试覆盖显式启动、任务轮询、取消、服务重启恢复、生成结果校验和自动回填所需字段。
- UI 构建与项目中心测试证明入口只在已选择且格式不合格的 PRD 上出现，成功后切换到有效草稿并重新扫描。
- `npm run verify` 从原项目中心入口验证 PRD、Spec、映射、评审和导出能力没有被替换或降级。

## 关联信息（More Information）

- Architecture Design：[产品事实工作闭环](../architecture/designs/product-work-lifecycle.md)
- RFC：不适用；当前没有多个独立责任方需要异步承诺接口或运行责任
- 产品与技术依据：[产品文档格式与生命周期](../../skills/product-documentation/SKILL.md)、[Interactive Product Spec 门禁](../../skills/interactive-product-spec/SKILL.md)、[当前架构契约](../ARCHITECTURE.md)
- 重访条件：PRD 草稿需要跨设备协作、自动覆盖正式来源、批量处理多个文件，或 Codex App Server 不再支持受限的 Project 写入时
