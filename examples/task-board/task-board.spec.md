# 山径任务 Product Spec

> 状态：draft  
> 版本：0.1  
> 稳定产品 ID：`TRAIL-TASKS`

本文档是示例项目的可审阅 Spec 正文。`product.spec.json` 仅是工作台视图模型；节点 ID 用于把图形化修改准确交回本文档。

## 任务入口（`TASK-ENTRY`）

### SURFACE `TASK-SURFACE-ENTRY`：任务入口

- 状态：draft
- 来源：observed-ui
- 定义：用户查看任务概况并进入任务看板。

### ACTION `TASK-ACTION-OPEN-BOARD`：进入任务看板

- 状态：draft
- 来源：observed-ui
- 用户目标：打开任务看板。
- 前端反馈：切换到看板区域。

## 任务看板（`TASK-BOARD`）

### SURFACE `TASK-SURFACE-BOARD`：任务看板

- 状态：draft
- 来源：observed-ui
- 定义：按列展示任务，并提供新建任务入口。

### ACTION `TASK-ACTION-CREATE`：新建任务

- 状态：draft
- 来源：observed-ui
- 用户目标：创建一个新任务。
- 前端反馈：打开新建任务界面。

### RULE `TASK-RULE-NAME`：任务名称要求

- 状态：draft
- 来源：candidate
- 定义：任务名称的必填与长度规则仍需产品确认。
