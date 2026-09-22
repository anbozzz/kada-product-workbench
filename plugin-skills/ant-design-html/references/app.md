# APP 形态的 HTML

Ant Design Mobile 是移动网页组件库，产物仍在浏览器运行。起步样例采用 React 18.3.1、antd-mobile 5.42.3、esbuild 0.25.12；它提供手机应用式交互基础，不代表原生 iOS／Android 能力或平台认证。

- 按主任务决定底部标签、页面导航、列表进入详情、返回及底部操作；不把 PC 侧栏和数据表简单缩小。离开详情返回时保留必要列表状态。
- 页头、可滚动内容、底部操作和安全区域各自有位置，弹层不被底栏压住；使用动态视口与 `env(safe-area-inset-bottom)`，手机外框仅在展示需要时添加。
- 以触控为主，不依赖 hover 暴露关键操作；检查点击区域、长中文换行、输入聚焦后操作可达。输入使用适当类型，真实软键盘表现需在相应手机浏览器补验。
- 日期、筛选、选择和确认采用适合手机的组件和步骤；`Popup`、`Dialog`、`Toast`、`NavBar`、`TabBar` 可按业务需要使用，不强制每页都有标签栏或卡片。
- 主题通过 CSS 变量与组件配置统一设置；应用风格可保持跨平台中性，用户指定 iOS／Android 时再核对对应平台规则，不把组件库默认外观称为官方合规。
- 检查窄屏、较大手机视口，以及列表→详情→返回、弹层打开／关闭、输入校验和状态保持。浏览器触控模拟不代表真实设备验收。

来源：[Ant Design Mobile](https://mobile.ant.design/)、[源码与用法](https://github.com/ant-design/ant-design-mobile)。首次依赖安装由 Agent 执行，构建后的默认示例为本地单文件 HTML，无需用户安装 React Native、Flutter 或原生 SDK。
