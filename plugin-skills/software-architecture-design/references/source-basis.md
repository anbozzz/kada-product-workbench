# 成熟方法来源与本 Skill 的采用边界

本文件只说明方法包从哪里来、采用了什么和明确没有照搬什么。正式使用时以当前 Project 事实和其他 reference 的本地规格为准；外部来源不能替代 Project 证据。

## 一手来源

| 来源 | 本 Skill 采用内容 | 明确不照搬 |
|---|---|---|
| [arc42 Documentation](https://docs.arc42.org/home/) | 以目标与约束、上下文、方案策略、构建块、运行、部署、跨切面、决策、质量、风险组织完整思考；按 lean/thorough 调节深度 | 不要求每次生成 arc42 全部 12 章，也不复制一套系统级大文档 |
| [C4 Diagrams](https://c4model.com/diagrams) | 使用 System Context、Container、Component 及 Dynamic、Deployment 作为分层表达；只选能回答当前问题的层级 | 不默认画四层；Code 图不是门禁；C4 不替代状态、数据和质量设计 |
| [MADR Template](https://github.com/adr/madr/blob/develop/template/adr-template.md) | 固定 Context、Decision Drivers、Considered Options、Decision Outcome、Consequences、Confirmation 等 ADR 语义 | 不照搬人员字段或目录；单 Agent 技术决定不伪造多方参与者 |
| [arc42 Quality Requirements](https://docs.arc42.org/section-10/) | 用 Source、Stimulus、Environment、Artifact、Response、Response Measure 把质量要求写成可验证场景 | 不把“高性能、稳定、安全”等形容词当成质量要求 |
| [Microsoft Domain Analysis](https://learn.microsoft.com/en-us/azure/architecture/microservices/model/domain-analysis) | 从业务能力、Bounded Context、实体、Aggregate、Domain Service 和上下文关系识别职责与事实所有权 | 不把 DDD 等同于微服务，也不从组织架构或技术分层直接推导领域边界 |
| [GitHub Spec Kit Plan Template](https://github.com/github/spec-kit/blob/main/templates/plan-template.md) 与 [Preset Resolution](https://github.com/github/spec-kit/blob/main/docs/reference/presets.md) | 借鉴“工作指令与产物模板分离”“稳定模板可由项目更具体规则覆盖”“未知项显式保留”的机制 | 不强制采用 `.specify/`、`spec.md → plan.md → tasks.md` 或其目录结构；它不是架构内容标准 |

## 本地组合原则

- arc42 提供覆盖面，避免遗漏质量、部署、风险等技术架构内容。
- C4、时序图、状态图和 ERD 只负责表达已经完成的判断，不各自形成独立流程。
- DDD 帮助确定业务模型和责任边界，但模块化单体、微服务或事件驱动仍需结合质量与运行约束取舍。
- MADR 提供长期决定需要保留的语义；默认把决定记入当前独立架构，实际需要长期单独追踪时才使用 ADR 模板。RFC 只解决决定前的多方征求意见，不能替代正式决定。
- Spec Kit 只证明模板化和项目覆盖机制可行，不证明每个 Project 都必须拥有 Plan、Change 或 Progress。

## 维护规则

- 本来源基线核对日期：2026-09-01。
- 当前本地适配：PRD 维护产品规则，独立架构维护技术决定，Spec 按明确来源程序派生；旧“决定默认留在 Spec”的组织方式已被替代。日常设计只读核心规范，ADR/RFC 按实际协作及 Project 既有管理方式选用。
- 2026-09-13 整理本地参考与派生衔接；未重新核验上列外部来源，来源基线日期仍按上项记录。
- 只有官方来源发生实质变化、当前模板无法表达真实项目，或实际使用暴露可复现缺陷时才修订。
- 修订时先说明是来源变化、本地适配变化还是 Project 特例；Project 特例留在 Project，不进入共享方法包。
