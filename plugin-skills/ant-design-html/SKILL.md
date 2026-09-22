---
name: ant-design-html
description: 依据 PRD 和 Spec 生成或修订 PC 网页、APP 形态的可操作 HTML。新项目可使用 Ant Design 或 Ant Design Mobile 随包起步代码，无需竞品或个人 Skill；已有工程沿原组件体系接续。交付 HTML，不生成原生 APP 客户端。
---

# PC／APP HTML 页面生成

由用户当前 Agent 执行，工作台负责后续阅读、映射与评审。先确认目标 Project、PRD、Spec、目标端和本轮授权。目标端沿用户要求与项目事实确定，未明确且会影响页面结构时只问 PC 还是手机 APP 形态；不要让产品经理选择框架。

## 从需求接续

- 想法需要深入澄清时使用同包 [grilling](../grilling/SKILL.md)；需要流程或关系可视化时使用 [diagram-design](../diagram-design/SKILL.md)。已有充分决定直接复用，不重做访谈。
- 本批需求及交互说明按同包 [product-documentation](../product-documentation/SKILL.md) 的 PRD 与 Spec 方法 准备；必要工程决定由 [software-architecture-design](../software-architecture-design/SKILL.md) 归入原约定位置。只要求文档时不开发页面。
- 视觉方案使用 [ui-ux-pro-max](../ui-ux-pro-max/SKILL.md)。沿已有品牌、组件、样式与规范；没有竞品也可以按需求设计。页面布局提案给出功能线框，并依据已有授权接续实现。

## 选择实现基础

| 项目情况 | 路径 |
|---|---|
| 已有源码、组件库、构建或打开方式 | 在原工程实现，按目标端参考下面规范；不运行起步脚本，不因为本 Skill 而迁移到 React 或 Ant |
| 空项目的 PC 业务页面 | 读取 [PC 页面](references/pc.md)，采用 Ant Design 起步代码 |
| 空项目的手机 APP 形态 HTML | 读取 [APP 页面](references/app.md)，采用 Ant Design Mobile 起步代码；手机尺寸只是视口，不代表 APP 导航与交互完成 |

仅新工程使用：

```bash
node <本Skill绝对路径>/scripts/create-project.mjs --target pc --output <新工程绝对路径> --title "产品名称"
```

手机端使用 `--target app`。脚本拒绝非空目录，不自动安装依赖。Agent 按目标项目工具链安装；模板使用固定版本 React、Ant、esbuild，首次安装需要 npm 下载或已有缓存，成功后保存 lockfile。随后改写 `src/App.jsx` 和 `src/style.css` 以实现本批要求，再执行 `npm run build`。`dist/index.html` 内嵌本批 CSS 和 JS，可双击打开，默认不依赖 CDN。模板中的仿真待办只用于证明组件可运行，必须替换为实际产品内容，不能当作用户业务需求。

PC 与 APP 同时需要时按各端任务组织界面，业务含义保持一致；不要简单把 PC 表格缩进手机宽度。自定义组件可按需补充，不局限于模板样式。

## 交付验证

从最终 HTML 的实际打开方式检查本批用户主路径、返回和状态保持，以及空、错误、加载、禁用等适用状态。检查目标视口下的布局、长中文、滚动、弹层与主操作；截图核对视觉效果。双击交付时实际用 `file:` 打开，新增外部资源时检查断网可用性；原项目有其他打开方式则按其约定验证。

HTML 中涉及支付、硬件或后台业务时准确区分真实实现和仿真。完成后遵循插件当前 HTML 上报及 PRD／Spec 同轮同步协议，不另建确认或映射流程。检查通过只证明对应样例与环境，不宣称任意需求自动验收。
