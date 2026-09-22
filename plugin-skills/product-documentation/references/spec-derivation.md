# Spec 程序派生与手改同步

只在派生或同步已采用本合同的 Spec 时读取。普通映射、PRD 批注和旧 Spec 保存沿原流程；历史文档先明确迁移绑定，不能直接覆盖。程序在插件 src/spec-derivation.mjs，入口为随包 scripts/cli.mjs；Workspace 使用 apps/interactive-product-spec/cli.mjs。

## 来源合同

PRD 拥有产品规则，架构拥有技术设计。源章节使用稳定 ID，紧随所属标题：PRD 沿用 `<!-- prd-section-id: 需求-… -->`；整体说明或操作子章节需要单独引用时可使用 `<!-- spec-source-id: … -->`；架构使用 `<!-- architecture-id: … -->`。引用取该标题到下一个同级或更高级标题前的完整原文，不按关键词截取，不由程序新增设计。文档首个一级标题及只组织已标记后代的分组标题可不单独标记；直接承载规则或决定的标题也必须被来源覆盖，不能因没有段落正文而静默省略。

PRD 中仅维护一个以下 JSON 注释。它登记输出身份和明确关联，不重复业务正文；节点来自源文档中已明确的操作或区域，已有 ID 必须复用。程序不会从一个功能段落自行推导多个按钮节点。架构仍按系统、模块与共同机制组织，不按这些输出节点拆成多个设计。

```markdown
<!-- spec-view
{
  "version": 1,
  "product": {"id":"HELP","title":"帮助产品 Spec","version":"v1","status":"draft"},
  "modules": [{"id":"HELP","title":"帮助"}],
  "pages": [],
  "nodes": [{
    "id":"HELP-OPEN","type":"ACTION","title":"查看说明","moduleId":"HELP",
    "status":"draft","sourceKind":"product-decision",
    "prd":["需求-帮助-说明"],"architecture":["HELP-STATE"]
  }],
  "context":{"prd":[],"architecture":[]},
  "excluded":{"prd":{},"architecture":{}}
}
-->
```

- 节点类型、状态和来源枚举沿现有工作台合同。`prd`、`architecture` 为精确来源 ID；`relations` 为可选节点 ID 数组，`pageId` 为可选已登记页面 ID。不通过同模块或名称相似补关联。
- `context` 引用整体产品定义、公共规则或共同技术设计，完整展示一次；`excluded` 用“ID: 本批范围外原因”明确不纳入部分。所有已标记来源须引用或明确排除；未标记正文会拒绝生成，但该检查不能证明关联语义已经完整，首次标记及实质变更仍按源文档方法复核。
- 页面项为 `id/title/htmlPath`，可选 `routeHints/anchorHints/parentPageId`。`htmlPath` 必须指向当前 Project 中实际存在的 HTML；文件存在仅证明有页面来源，不证明页面行为或路由已经验证。拟定页面留在架构，不放入 pages。没有页面不阻断派生。
- 来源身份与确认状态不因派生升级；Spec 总体保持草稿，源节点的状态来自明确声明。

## 正常派生

`node <cli.mjs> derive-spec --project <Project> --prd <PRD.md> --architecture <架构.md> --output <Spec.md>`

输出目录可按需创建。程序取出完整来源，将相对图片和链接地址换算到输出位置，保留其语义，生成可供现有工作台读取的 Markdown；不写 PRD、架构、HTML 或 Map。工具数据沿现有 IPS_HOME/工具目录保存基线；可使用 `--state <工具状态路径>` 指定同一隔离工具目录。基线是同步恢复数据，不能随意清理；遗失时保留 Spec，不能假定它没有手改。

首次不能覆盖已有目标；迁移须先明确现有来源和节点对应，候选输出核对后再按 Project 约定切换唯一当前入口，保护旧文件和人工 Map。普通派生不运行 Agent 内容自审和 Spec Reviewer；程序校验通过只证明转换合同成立。

## 手改与 Agent 同步

1. 正常保存 Spec，包括工作台直接写回、gate 原流程应用补丁或外部编辑器保存。原来源文档和人工 Map 不随之自动改变，也不立即启动 Agent。
2. 执行 `node <cli.mjs> spec-changes --project <Project> --spec <Spec.md>`。返回本次 Spec revision、源文件路径和版本、每项 changeId/nodeId/before/after 及来源关系。程序用当前文件和持久基线恢复差异，不需要截获每次保存。
3. 当前任务 Agent 读取差异及对应完整功能/技术设计和必要依赖。产品变化修订 PRD，技术变化修订架构；新内容或混合变化先明确归属。只有显示编排变化时修订来源声明或派生器的适用规则，不能把业务规则塞进声明。保护冻结版；需按原生命周期派生新来源文件时，本版须明确迁移，不能沿旧基线自动换源。原确认语义不扩大。
4. 按源文档方法仅复核受影响范围。执行同一 derive-spec 命令加 `--preview`，读取候选 text 与变化，核对用户改动是否已由来源承接；缺失、不采纳或发生冲突的修改保持待同步，不擅自当成已解决。
5. 再次读取 spec-changes，基于最新版本形成临时同步回执，随后用 `derive-spec … --receipt <回执.json>` 发布。回执结构如下，每项都必须有具体承接依据；它是任务的同步记录，不是审批表或产品确认。

```json
{
  "specRevision":"当前手改Spec的SHA256",
  "candidateRevision":"预览返回的candidateRevision",
  "sourceRevisions":{"prd":"修订后PRD的SHA256","architecture":"当前架构的SHA256"},
  "resolutions":[{"changeId":"差异的changeId","updatedSources":[{"kind":"prd","id":"需求-帮助-说明"}],"reason":"已在对应功能修订该条件，预览保持本次用户结果"}]
}
```

Spec、PRD 或架构版本变化、回执漏项、候选未核对或声称修改的具体来源块未变时，拒绝覆盖。同步过程中新增的手改仍保留；源文档部分修订成功而后续失败时报告各自状态，保留差异后继续。程序不能证明 reason 的语义正确，Agent 须实际核对预览；不重新评审未变化全文。

没有待同步手改时源更新可直接重新派生。有待同步手改时不提供强制覆盖；来源丢失、无基线、ID 不明确或发布中断且出现额外修改时停止受影响写入并说明恢复所需依据。工具不扫描未选文件，不在 Stop 或目录变化时猜测交付。

发布时保留一个 `.derivation-previous` 恢复副本，并在工具状态中记录其版本；它不作为产品文档入口。外部同时保存时不覆盖新文件，保留差异或恢复副本并报告冲突。处理冲突后再继续；不得自行清除遗留锁或恢复副本来绕过保护。
