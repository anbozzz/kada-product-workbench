# Beautiful UI / Prompt Bar

来源：https://www.beautifului.dev/#prompt-bar（官网 Copy code，2026-09-02）。
许可：https://www.beautifului.dev/license，版权声明见同目录 LICENSE。

本文件采用上游 tall / Rounded 输入栏的布局、引用标签、图标及自动增高，作为受控 React 组件接入现有 PRD 服务，并非安装整套示例站点。批次工作流将底部 Enter 改为换行，⌘ / Ctrl + Enter 或按钮才发送整批，避免逐句话自动提交。

产品适配：外部持有草稿、引用及异步发送状态；只有发送确认后由宿主清空。加入选区原文预览、整批预览、中文和输入法保护；使用项目现有色彩与 Radix 菜单。官网假数据、模拟模型选择、模拟语音、第三方连接和 glimm 装饰动画不进入产品。无新增运行依赖，不连接外部模型或发送产品内容到第三方。
