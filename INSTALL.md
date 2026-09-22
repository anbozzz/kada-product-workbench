# 交给 Codex 的安装说明

用户不需要手敲命令。将本文件或它的链接交给 **Codex 桌面端或支持插件的 Codex CLI**，发送：

> 请按这份说明安装 Interactive Product Spec。先检查环境和已有安装，再完成安装；需要授权时告诉我。安装后引导我在新任务中打开当前项目。

这是 Codex 插件，不是 DMG/EXE 桌面安装程序。实际插件目录由 Codex 管理，不需要用户选择，也不需要每个 Project 复制一份。以下步骤由 Codex 执行。

包内已包含本版本的 PRD、Spec、架构等七项 Skill 及引用资源，无需维护者的共享目录或另装个人 Skill。后续规则更新随新版本升级，不自动下载浮动规则。本地工作台可运行不等于 AI 编写可离线使用，后者仍需可用的 Codex 账号和模型服务。

## 1. 确认来源与取得安装包

- 若本文件旁已有 `install.mjs`、`release.json`、`plugins/` 和 `.agents/`，这是解压后的发布包，直接进入环境检查。
- 若正在阅读源码仓库或远程说明，从**同一个、用户确认的仓库**取得维护者发布的 `interactive-product-spec-版本.tar.gz` 和 `SHA256SUMS`。不要把 GitHub 的 Source code 下载当成安装包，不要执行其他搜索结果里的同名包，也不默认执行 `npx interactive-product-spec`。
- 官方仓库：[anbozzz/kada-product-workbench](https://github.com/anbozzz/kada-product-workbench)，发布包入口：[Releases](https://github.com/anbozzz/kada-product-workbench/releases)。若暂无发布附件，停止下载步骤，不把源码压缩包当成安装包。
- 下载到临时目录；先用系统 SHA-256 工具校验归档与 `SHA256SUMS` 一致，再检查归档条目不含绝对路径、`..`、符号链接和特殊文件，解压到新的空目录。校验文件必须来自同一可信发布；哈希一致不等于身份可信。
- 默认把解压包保存在当前 Codex 用户目录的 `plugin-sources/interactive-product-spec/版本/`，不要要求用户先挑目录；该目录从当前 Codex 环境解析，不能照搬开发者路径。若用户指定 Workspace 内的目录，使用其指定的空目录。最终安装副本仍由 Codex 管理，来源目录保留供重装和检查，不要安装后立即删除。

## 2. 检查运行环境

1. 检查 Node.js，运行环境最低为 **20.11**。缺少时说明用途并按用户批准的方式从 Node.js 官方来源安装，不私自更换现有全局版本。发布包已经包含运行依赖和工作台，不需要用户安装 npm 依赖或编译 UI。
2. 找到当前 Codex 的原生可执行文件；优先使用已在 PATH 中的 `codex`，不假设安装位置。若桌面端未将 CLI 暴露到 PATH，可使用已核实的随应用附带可执行文件的绝对路径，通过下方 `--codex` 传入。Windows 只有 `.cmd` 启动器时先定位其实际原生 `codex.exe`，不要拼接未经转义的 shell 命令。
3. 阅读包内安装脚本及启动脚本后，在**解压包根目录**执行（参数路径含空格时作为独立参数传入）：

```bash
node install.mjs --check
```

需要显式指定 Codex 时，添加 `--codex "已核实的原生可执行文件绝对路径"`。预检会校验整个发布包、运行依赖、官方插件命令和已有安装；不启动工作台、不修改业务项目、不执行安装命令。Codex 自身可能维护运行缓存。

## 3. 让 Codex 安装

确认当前用户已经授权本次插件安装；若宿主仍要求目录、命令或网络权限，按其提示申请，不绕过。在同一目录执行：

```bash
node install.mjs --install
```

脚本只调用 Codex 官方 marketplace/plugin 命令，不手写用户配置、不复制进插件缓存、不设置信任。它会核对 Codex 实际安装副本的内容，不只看命令退出码。

- `checked`：只完成预检，尚未安装。
- `installed`：正确版本已安装并启用，文件与发布包一致；新会话验收仍待完成。
- `already-installed`：同版本、同来源且实际文件一致，无需重复安装；仍检查是否已完成下节。

同名插件来自其他来源、插件被用户禁用、同名来源指向其他目录或包被修改时，停止并解释，不自动卸载、启用、覆盖或迁移。版本变更只有用户明确要求后才用 `--upgrade`；它不会绕过来源冲突检查。同一版本内容变更必须重新发布新版本，不能靠篡改清单覆盖。

## 4. 用户确认信任，再新建任务

安装成功不等于启动脚本已获信任。请用户在 Codex 的 Hook 管理界面（支持时使用 `/hooks`）查看本插件的 **SessionStart** 脚本，决定是否信任；不得代替用户修改信任记录。该脚本只告诉 Agent 如何在交付 HTML 前接续 PRD 与统一 Spec 的同轮核对和必要修订，不询问文档选择，不扫描项目，也不在 Stop 时运行。

随后引导用户在目标 Project 中新建 Codex 任务；如仍看不到插件，按 Codex 提示重启。新任务中检查七项 Skill `product-documentation`、`software-architecture-design`、`prd-concise-cn`、`grilling`、`diagram-design`、`ui-ux-pro-max`、`ant-design-html` 和 `publish_html_ready` 是否可用，不能仅凭安装记录宣称已加载。无需把 Skill 复制进业务 Project。生成新 HTML 工程时由 Agent 安装页面依赖；UI 数据查询助手另需 Python，缺少时可直接读取随包数据。

## 5. 打开项目并确认可以使用

让用户在新任务发送：

> 用 Interactive Product Spec 打开当前项目，识别已有 HTML 和产品文档。先让我确认来源，不要自动改写文档。

从**已安装插件中的入口**启动，明确传入目标 Project 根目录；不要因为工具放在别处就扫描安装目录或整个用户目录。使用 CLI 实际返回的地址。验证工作台能打开、页面和文档候选来自正确项目、原有文件未因安装被改写。资料不符合格式时如实给出具体问题，不把它当成安装失败或自动生成新资料。

完成报告必须分别说明：插件版本与安装结果、Hook/新任务加载情况、目标项目打开情况。用户尚未完成信任或新任务检查时，报告“插件已安装，等待用户完成接入验证”，而不是“全部完成”。

## 失败恢复与卸载

保留错误消息和解压包，修复缺少环境或权限后重试。安装器不会自动清理其他来源、回滚整个 Codex 配置或删项目资料。来源已注册但安装失败可以重试。升级换目录时，先展示旧来源影响，取得明确授权后才用官方来源移除/重新注册流程；不要自动删除旧文件。仅在用户要求卸载时，使用当前 Codex `plugin remove --help` 确认命令，限定本插件标识操作。

官方参考：[插件包与安装](https://developers.openai.com/plugins/build/plugins)、[Hook 信任](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks)。
