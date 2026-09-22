# 首页功能介绍图

用于《咔哒GitHub介绍草稿》。PNG 以相对路径嵌入 GitHub Markdown，自适应正文宽度；画幅约 16:9。以工作台截图为参考重新生成界面示意，不作为原始截图或真实会话验收证据。

## 素材与边界

- PRD 持续评审：output/playwright/prd-review-selection-popover.png、prd-review-diff.png；对应 browser-tests/prd-review.browser.mjs。测试消费者模拟修订，不证明真人 Codex 会话始终在线；说明原任务需持续参与。
- 页面与 Spec：output/playwright/candidate-spec-locates-dom.png；对应 browser-tests/workbench.browser.mjs。示意页面操作与说明关联，不把自动候选当成人工确认结果。
- 只读交付：output/playwright/publication-viewer.png；对应 browser-tests/publication.browser.mjs。不宣称公网托管或无需任何运行环境。
- 原始截图不改写；用户自行修改的首页正文保留。只在介绍草稿增补特色展示，未替换仓库的工程 README。

## 生成与修改

使用内置 image_gen，参考图先目视检查。生成后检查中文、能力边界、品牌配色与窄幅可读性。
spec 图定向修订任务状态为“TODO / 2”；delivery 图去掉重复字并简化示意窗口的细字。
完整提示词如下，后续可用对应图片作为引用继续调整。

### prd

```text
Create ONE polished Chinese product introduction slide for GitHub README, wide 16:9, ideally 1600x900. Brand 咔哒, local product workbench. Near-black navy #0B1018 canvas, mint green #58E0AA accent, off-white typography, restrained slate borders. Editorial slide layout, generous spacing, no neon glow, no 3D, no stock photos. At GitHub display width 850px headline and captions must be very legible: large Chinese sans serif headline, only short copy, diagram and screenshot-inspired UI occupy center. Reference screenshots are visual references; compose a simplified illustrative UI, not a purported exact screenshot. Do not invent capabilities. Small footer '咔哒 · 产品工作台    界面示意'. Slide 01. Exact headline '选中原文，接续下一轮修改' and subheading 'PRD 批注与原 Codex 任务持续衔接'. Create left large dark document window referencing image1 with short selected text '支持创建任务', annotation bubble '请补充批量创建的规则'; center small mint arrow and understated '原 Codex 任务' process connector; right smaller revision window referencing image2 with red old line '创建任务', green new line '支持批量创建任务'. These are schematic product examples. Bottom 4 step ribbon '选中原文 → 汇总意见 → Codex 修订 → 查看新版'. Small readable qualification '需原任务持续参与；确认由人完成'. Preserve visual fidelity to dark workbench, no readiness status indicators from reference. Minimal paragraphs.
```

### spec

```text
Create ONE polished Chinese product introduction slide for GitHub README, wide 16:9, ideally 1600x900. Brand 咔哒, local product workbench. Near-black navy #0B1018 canvas, mint green #58E0AA accent, off-white typography, restrained slate borders. Editorial slide layout, generous spacing, no neon glow, no 3D, no stock photos. At GitHub display width 850px headline and captions must be very legible: large Chinese sans serif headline, only short copy, diagram and screenshot-inspired UI occupy center. Reference screenshots are visual references; compose a simplified illustrative UI, not a purported exact screenshot. Do not invent capabilities. Small footer '咔哒 · 产品工作台    界面示意'. Slide 02. Exact headline '点到哪里，就看哪里的产品说明' subheading '把页面操作与 Spec 关联起来'. Center wide simplified workbench based on reference: left small tree '任务看板 / 新建任务 / 标记完成'; middle simple light task board with new task button, mint outlined marker labeled '新建任务'; right clear dark definition panel '新建任务' and three short sections '操作前提 / 预期结果 / 异常处理'. Thin mint connector from button marker to definition panel. Do NOT reproduce warning banners, path text or toasts in reference. This is an illustrative example, not fabricated screenshot. Bottom exact takeaway '页面可操作 · 说明可查阅 · 关联由人确认'. No other long text.
```

### delivery

```text
Create ONE polished Chinese product introduction slide for GitHub README, wide 16:9, ideally 1600x900. Brand 咔哒, local product workbench. Near-black navy #0B1018 canvas, mint green #58E0AA accent, off-white typography, restrained slate borders. Editorial slide layout, generous spacing, no neon glow, no 3D, no stock photos. At GitHub display width 850px headline and captions must be very legible: large Chinese sans serif headline, only short copy, diagram and screenshot-inspired UI occupy center. Reference screenshots are visual references; compose a simplified illustrative UI, not a purported exact screenshot. Do not invent capabilities. Small footer '咔哒 · 产品工作台    界面示意'. Slide 03. Exact headline '把页面和说明，一起交给研发' subheading '冻结当前版本，沿页面回看需求'. Left a composed stack of three clean document cards labelled 'HTML 页面', 'PRD / Spec', '页面关联'. An arrow leads into a large dark read-only review window inspired by reference with light task board pane and dark corresponding specification pane, clear top pill '只读评审'. Under left show two restrained outputs '只读 ZIP' and '局域网分享'. Bottom exact takeaway '接收者仅查看评审包，无需安装创作插件'. Small qualification '按包内说明启动；真实后端需另行接入'. No cloud hosting claims, no fake downloads or approval statuses.
```

