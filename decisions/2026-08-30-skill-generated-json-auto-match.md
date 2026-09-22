# Skill 生成 Spec 后连续生成 JSON 与自动匹配

> 历史说明：本决策中“在项目内生成并由用户选择同目录 JSON”的交付口径，已由 [`2026-08-31-prd-page-linking-and-internal-projection.md`](2026-08-31-prd-page-linking-and-internal-projection.md) 替代。Markdown 仍是正式 Spec，JSON 仅保留为工具侧可重建内部投影；本文关于候选匹配与人工确认的决定继续有效。

## 原因

用户直接在 Codex 中调用 `interactive-product-spec` 生成 Spec 时，当前任务已经具备来源、写入范围和 Skill 上下文。生成 Markdown 后再要求用户到项目中心创建另一条投影任务，会重复选择模型与触发动作，并把本应连续的“生成 → 映射”体验拆开。工作台已有页面识别、确定性候选和本页高置信批量确认能力，但没有成为直接 Skill 调用的默认后续步骤。

## 决定

- `generate` 的正常结果同时包含正式 Markdown Spec 和同目录、经校验的 `product.spec.json` 临时投影。
- 当前 Codex 任务已经直接调用 Skill 时，由同一任务派生、校验和写入 JSON，不再要求用户到项目中心创建第二条 Codex 投影任务。
- 有已确认 HTML 时，同一任务继续启动现有映射门禁；工作台在实时 DOM 中识别页面并计算 `ACTION` / `SURFACE` 候选。
- 唯一且高置信的当前页候选由用户一次批量确认；中低置信、冲突和无候选项才逐项处理。
- 独立项目中心没有正在执行的 Codex 任务时，仍保留明确创建用户可见投影任务的路径。

## 边界与明确不改

- Markdown 继续是唯一正式 Spec；JSON 继续是可重建投影。
- `spec-map.json` 继续单独保存经人确认的节点到 DOM 关联；JSON 不保存 selector、像素坐标或确认状态。
- 自动候选不静默写 Map，不把结构校验或高置信评分表述为产品确认。
- 不改变普通本地逐节点写回与 Codex gate 草稿回传的所有权。
- 没有 HTML 时仍生成 JSON，但不宣称已经完成页面匹配。

## 否决方案

- 否决“每次 generate 后都让用户到项目中心再次创建投影任务”：重复且割裂当前任务。
- 否决“把候选 selector 直接写进 product.spec.json”：混淆 Spec 投影与页面实现关联。
- 否决“高置信即自动 confirmed”：评分不是人工确认，也不能覆盖歧义和动态页面状态。

## 回归检查

- 直接 `generate` 的流程说明必须明确同任务生成并校验 JSON。
- Markdown revision 变化时不得复用过期 JSON。
- 示例页面的唯一高置信节点必须能在不逐项拖拽的情况下整页批量确认，重复控件保留人工复核。
- 批量确认后只写 `spec-map.json`，JSON 不出现 selector 或指纹。
- `npm run verify` 通过；Workspace 架构发布完成，核心审计不得出现本项新增失败。
