---
name: ui-ux-pro-max
description: 为页面设计和实现提供视觉方向、配色、字体、间距、组件状态和可用性检查。用于新界面、UI 改进及设计系统；PC 或 APP 形态的 HTML 实现可接续同包 ant-design-html。
---

# UI UX Pro Max

先读取当前需求、目标端、已有页面与项目设计规范。已有规范优先复用；缺少会改变设计方向的信息才问用户，不要求产品经理选择技术栈。APP 页面在本插件中的交付物是 HTML，不能因移动端而改成 SwiftUI、Compose 或 React Native。

根据任务提供必要的布局线框、视觉方向或设计规则，具体说明颜色、字体层级、间距、组件与状态。新项目可以无竞品起步；用户提供参考时保持其有效约束。已采纳的规则回到当前项目的 Spec 或既有设计规范，后续页面复用。

## 按需查询随包数据

下面路径都相对于本 Skill 的实际安装目录，先解析目录，再以绝对路径调用；不要假设目标 Project 有 `skills/`。

- 配色、风格、字体、图表和交互模式：`python3 <本Skill目录>/scripts/search.py "查询词" --domain color`，其他域与参数见 `--help`。
- 生成设计系统建议：`python3 <本Skill目录>/scripts/search.py "产品类型与目标" --design-system`。Python 为此查询助手的运行依赖；不可用时直接读取所需 `data/*.csv`，其余设计与 HTML 实现可继续。
- 原始方法与背景保存在 [上游说明](UPSTREAM-SKILL.md)，数据和脚本保留原始内容，不把推荐风格当作业务事实。

设计系统查询的 `PATTERN`／`Conversion` 可能推荐应用下载宣传页。当前任务是业务 APP 时，只采纳适用的配色、字体与样式；页面结构以 PRD／Spec 为准，不因查询结果改成下载页或编造评分、用户数。

## 实现与检查

需要生成 PC／APP HTML 时接续 [ant-design-html](../ant-design-html/SKILL.md)，沿 PRD、Spec 和当前工程实现。统一覆盖空、加载、错误、禁用、键盘焦点、对比度和目标端操作方式。布局或视觉提案附对应线框；最终检查实际渲染截图，不能仅凭代码或构建判断美观。
