---
status: accepted
date: 2026-09-02
scope: Codex 插件安装、分发与发现
supersedes: 无
superseded-by: 无
---

# ADR-0004：安装状态由 Codex 管理

## 背景与问题（Context and Problem）

用户确认仅服务 Codex，由 Agent 代装、用户只确认权限，随后按 Project 根目录打开资料。旧说明混淆源码位置、安装位置与业务项目，且依赖开发机路径。

## 决策驱动因素（Decision Drivers）

- 用户无需手敲命令；换 Project 不重复安装。
- 不直接修改用户信任、缓存或其他插件；新环境可以验证安装结果。

## 候选方案（Considered Options）

1. 预构建发布包，由脚本编排 Codex 官方安装命令。
2. 只给命令片段，让 Agent 自行组织安装。
3. 自建公共目录、启动命令和安装注册表。

## 决定结果（Decision Outcome）

采用方案 1。工具包位置可由用户指定，实际插件副本、启用和信任仍归 Codex。包内只读预检默认不写配置，安装必须显式执行。校验清单不替代来源信任。

## 后果（Consequences）

### 正向影响（Positive）

- 不需要 DMG/EXE 或按 Project 复制，Codex 可以按同一说明确定执行步骤。

### 负向影响与风险（Negative / Risks）

- 需要维护预构建包和两项 Skill 的发布输入；同名旧安装必须由用户明确选择迁移。
- 安装成功仍不等于 Hook 信任、新会话或 Windows 已验收。

## 验证遵循情况（Confirmation）

- 包迁移与完整性测试、冲突失败关闭、真实隔离 Codex 安装及统一工作台验证。

## 关联信息（More Information）

- Architecture Design：[安装设计](../architecture/designs/codex-plugin-installation.md)。
- RFC：不适用。
- 产品与技术依据：当前用户确认、scripts/build-plugin-bundle.mjs、Codex CLI plugin help。
- 重访条件：跨 Agent、自动更新、远程执行或信任模型改变。
