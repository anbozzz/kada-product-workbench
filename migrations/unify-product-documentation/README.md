# 统一产品文档 Skill 的共享源迁移

> 历史迁移记录：2026-09-21 起共享 Skill 以发行快照纳入 `plugin-skills/`，当前同步与打包方式以 [RELEASE.md](../../RELEASE.md) 为准。下文保留迁移时的来源边界。

本分支将 PRD／Spec 编写、复核、文档同步和工作台接入统一到 `product-documentation`，移除独立 `interactive-product-spec` Skill。插件、应用与协议标识不改。正文格式、节点、人工映射、普通保存、gate、PRD 批注及 HTML 同步顺序保持原样。

## 为什么用补丁

应用是独立 Git，Workspace 的共享 `skills/` 和架构模型不属于该 Git。本目录仅保存本次跨边界差异及前后 SHA256，不建立第二份长期 Skill 内容源。`workspace.patch` 是与应用代码共同评审的迁移制品；测试和打包使用应用补丁后的显式 Skill 输入。分支开发不修改当前共享源或已安装插件。

`manifest.json` 列出每个受影响文件的前后 SHA256，null 表示该版本不存在。发布前重新核对当前源；若基线已变化，应合并新修改并重新验证，不强制覆盖。补丁不包含无关项目资料或已确认业务文档。

## 应用与发布顺序

1. 在合并发布时，从 Workspace 根运行 `git apply --check <本目录绝对路径>/workspace.patch`，核对 manifest 的 before 哈希。检查通过才应用同一补丁。当前已安装缓存不手工修改。
2. 应用后，按现有 Workspace 入口重新生成与核对：
   - `python3 scripts/update_skills_index.py`
   - `python3 system-architecture/scripts/update_architecture.py --check`
   - `python3 system-architecture/scripts/update_architecture.py`
   - `python3 scripts/audit_workspace.py`
   - `python3 -m unittest scripts.tests.test_audit_workspace`
   图谱由现有脚本原子生成，不把开发隔离副本的路径或来源 hash 发布到正式图谱。
3. 在本应用按 `RELEASE.md`，用更新后的 Workspace `skills/` 作为显式 `--skills-root` 打包。包内为七项 Skill，必须有产品文档的 Spec 方法、转换与工作台参考、PRD/Spec 复核资源及 CLI wrapper。
4. 按 `INSTALL.md` 使用官方安装入口部署；新任务验证 Skill 发现、无 HTML 的 Spec 编写、旧 Spec 转换及 HTML 后同步。已经运行的任务保留原注入协议，不据安装成功声称旧任务已热更新。

应用前 `git apply --check` 不写文件；应用后可用 `git apply --reverse --check` 核对补丁回退条件。已有后续修改时不要强行反向覆盖，先按当前文件合并。

## 验证范围

规则保真和可执行性用原方法对照及独立只读前向检查；应用使用 `npm run verify`。自包含包检查确认不存在旧 Skill，转换任务从包内定位产品文档 Skill，保留只读 sandbox；缺少 Spec 方法时拒绝就绪。补丁在隔离原始副本应用、逐文件核对 after 哈希并检查可反向应用。

纯转换不进入 PRD/Spec 设计或内容评审。普通节点直写和 gate 草稿仍是原两条策略。本次不修改业务项目正文、HTML 或人工映射，不借统一职责增加审批。

具体执行结果见本分支提交说明与 `verification.md`。分支验证不等于已安装、新任务实测或用户确认。
