# 页面映射确认事实与运行时校验状态分离

## 原因

`spec-map.json` 表达用户已经确认的 `Spec 节点 → 页面上下文 + selector + fingerprint` 关系。工作台同时会依据当前 iframe 的路由和 DOM，临时计算 `confirmed / invalid / ambiguous / drifted / out-of-context`。此前自动保存直接写入带临时状态的展示 Map，导致用户在任一页面保存映射时，其他页面的已确认关系被批量写成 `out-of-context`；共享路由无法唯一识别逻辑页时，即使 selector 已在当前 DOM 唯一命中，也仍显示“待进入对应页面”。

## 决定

- 正式 `spec-map.json` 只持久化人工确认的关联事实。保存边界把每个现存 Annotation 的 `status` 规范为 `confirmed`。
- `invalid / ambiguous / drifted / out-of-context` 是当前浏览器、当前路由和当前 DOM 的派生校验结果，只用于显示、筛选和复核，不写回正式 Map。
- 读取旧 Map 时接受既有状态枚举并在内存中规范为 `confirmed`，但不静默改写磁盘文件；原文件 revision 仍按原始内容计算，下一次用户正常保存时再原子归正。
- 页面上下文 URL 不一致时暂停校验。URL 一致但多个逻辑页面共享路由时：selector 唯一命中则继续校验语义指纹；selector 缺失且无法可靠识别当前逻辑页时才显示 `out-of-context`；已可靠识别为同模块另一个逻辑页时也显示 `out-of-context`。
- 前端持久化只能读取原始 `specMap`，不能读取叠加了派生状态的展示 Map；服务端保存边界再次规范状态，避免其他客户端重新引入污染。

## 明确不改

- 不改变 Map 的 `schemaVersion`、Annotation ID、URL、selector、fingerprint、`confirmedAt` 或文件位置。
- 不给 Map 增加 `pageId`，不修改 Product Spec 页面归组，也不要求用户重新绑定。
- 不自动写入当前用户的 Map；只有用户原有保存动作才会按 revision 原子写入。
- 为兼容已有 Map 和只读评审包，Schema v0.1 继续接受旧状态枚举；本次不启动破坏性的 v0.2 迁移。

## 否决方案

- 只为 `#S052` 增加特例：其他共享路由仍会复发。
- 只调整页面识别分数：页面内容和状态会动态变化，不能保证始终产生唯一逻辑页。
- 只在前端阻止写入派生状态：其他客户端或 API 仍可把临时状态持久化。
- 立即收紧 Schema 只允许 `confirmed`：会让现有包含旧状态的 Map 无法读取，产生不必要的迁移和重绑风险。

## 回归检查

- 共享路由无法唯一识别逻辑页时，selector 唯一命中的旧映射恢复为已确认；同路由但目标尚未出现的映射保持待进入，不进入需复核。
- 明确进入同模块另一个页面时暂停校验；不同 URL 时暂停校验。
- 读取包含 `out-of-context` 的旧 Map 时工作台内存基线恢复为 `confirmed`，磁盘 revision 不变。
- 客户端提交任意派生状态时，服务端保存文件仍为 `confirmed`；并发 revision 冲突继续被拒绝。
- 切页、刷新、重新进入后重新计算当前 DOM 状态；已有映射不需要重新绑定。
