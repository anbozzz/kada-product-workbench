# 技术架构设计：<范围名称>

## 1. 结论与适用性
<!-- architecture-id: <scope-slug>-overview -->

| 字段 | 内容 |
|---|---|
| Status | proposed |
| Date | YYYY-MM-DD |
| Project | <当前 Project> |
| Scope | <本次设计边界> |
| Product source | <PRD需求ID与产品来源> |
| Technical evidence | <现有架构/源码/接口/数据/运行证据> |
| Related decisions | <ADR/RFC 链接或无> |

<为什么需要技术架构设计、当前主方案和状态。>

## 2. 目标、范围与依据
<!-- architecture-id: <scope-slug>-basis -->

### 2.1 必须实现的结果

<内容>

### 2.2 范围内

- <内容>

### 2.3 明确不改

- <内容>

### 2.4 当前事实与证据

- <事实及直接来源>

### 2.5 Unknown / TBD

- <未知项、当前处理和影响；没有则写“无”>

## 3. 架构驱动因素
<!-- architecture-id: <scope-slug>-drivers -->

### 3.1 业务不变量与硬约束

- <内容>

### 3.2 质量场景

| ID | 来源（Source） | 刺激（Stimulus） | 环境（Environment） | 对象（Artifact） | 响应（Response） | 响应指标（Response Measure） |
|---|---|---|---|---|---|---|
| QA-01 | <来源> | <刺激> | <环境> | <受影响对象> | <响应> | <可验证指标或TBD> |

## 4. 整体设计
<!-- architecture-id: <scope-slug>-mechanisms -->

### 4.1 领域与所有权

<核心对象、不变量、Bounded Context、状态/数据/规则所有者；不适用时写原因。>

### 4.2 静态结构

<最小 C4 或结构说明、依赖方向和事实源；不适用时写原因。>

### 4.3 运行交互

<主流程、失败、超时、重试、幂等、补偿和并发；不适用时写原因。>

### 4.4 状态与数据

<生命周期、身份、关系、一致性、事务和迁移；不适用时写原因。>

### 4.5 部署与运维

<配置、部署、回滚、观测、告警、容量和恢复责任；不适用时写原因。>

## 5. 候选方案与取舍
<!-- architecture-id: <scope-slug>-options -->

| 候选 | 收益 | 代价与风险 | 是否采用及原因 |
|---|---|---|---|
| <候选A> | <内容> | <内容> | <内容> |
| <更简单候选B或无第二可行方案的原因> | <内容> | <内容> | <内容> |

## 6. 实施、迁移与回滚
<!-- architecture-id: <scope-slug>-rollout -->

1. <实施顺序>

- 兼容与迁移：<内容或不适用原因>
- 回滚点：<内容或不适用原因>

## 7. 验证与可观测性
<!-- architecture-id: <scope-slug>-verification -->

| 驱动因素/风险 | 验证方式 | 通过条件 | 证据位置 |
|---|---|---|---|
| <内容> | <测试/检查/指标/日志/Review> | <内容> | <路径或TBD> |

## 8. 决定、风险与后续
<!-- architecture-id: <scope-slug>-risks -->

- ADR：<链接或无>
- RFC：<链接或不适用>
- 残余风险与技术债：<内容或无>
- 后续触发条件：<什么时候必须重访本设计>
