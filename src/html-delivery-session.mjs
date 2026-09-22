#!/usr/bin/env node
import { HTML_DELIVERY_SCOPE } from './html-delivery.mjs';
export const HTML_DELIVERY_AGENT_CONTEXT = [
  'Interactive Product Spec 插件的 HTML 完成协议：',
  HTML_DELIVERY_SCOPE,
  '如果当前任务实际创建或实质修改了一个或多个用户要求交付的本地 .html/.htm 文件，在上述适用范围内，无论用户是否调用过任何 Skill，都必须先按 product-documentation 所引用的统一 Spec 标准完成本批最终交付文件的适用检查，并在向用户宣布完成前调用本插件的 `publish_html_ready` MCP 工具一次。',
  '通过组件、JS 或 CSS 改变交付页面也适用，即使 HTML 入口文件内容未变。传入当前产物所属 Project 根目录和本批全部 HTML 入口绝对路径；同轮多个入口合并为一次上报，不在中间写入时逐次触发。',
  '只阅读或讨论 HTML、回复中的代码片段、图片/非 HTML 制品，以及构建或测试偶然产生但并非用户交付物的 HTML，不得上报。仅改 PRD 不调用 HTML 上报，也不擅自修改页面。',
  '开始页面修订或恢复任务时先读取当前 Project 的 PRD、Spec 与页面来源，确定本轮差异；不要仅依赖多轮聊天回忆。需要改变工程结构时，在实现前按 software-architecture-design 将决定写入现有约定位置。',
  '上报后必须在同一任务显式使用 `$product-documentation`，先核对 PRD 再核对 Spec，执行 product-documentation 的“HTML 交付与文档同步”方法；不询问文档选择、PRD 类型或是否同步，不自动追加压缩或工作台映射。',
  '每轮均核对两份文档，只修订受影响内容；已有覆盖说明无需修改，缺失文档由 Skill 按实际范围生成草稿，非产品 HTML 由 Skill 说明不适用。探索、仿真和未决冲突保留原确定程度，不把页面实现当成产品确认。',
  'PRD 已先行处理的页面完成后仍核对两份文档，已有覆盖时不重复改写。旧 prdFollowup 仅兼容，不再跳过；不把上报、历史选择或文件 hash 当作文档同步完成。',
  'PRD 首次生成完成、格式校验通过且仍为草稿或评审中时（仅 PRD 任务也适用），用户尚未安排下一步则调用 `request_prd_review` 询问“是否现在开始评审”。HTML 交付中在两份文档同步和一致性检查完成后处理此选择。明确开始才打开工作台并直接使用 `wait_prd_feedback` 默认挂起等待接收批注；不设置短超时。pending、客户端超时或工具不可用时结束本轮等待，不自动重试或建立终端轮询链；deferred 保留 PRD 链接和在原任务回复“开始评审”的入口，choice-required 在原任务询问并等待。已有明确评审授权直接 `open_prd_review`；明确暂缓或直接生成 Spec 则遵从，不重复询问，不把授权当作确认。没有 HTML 可省略 htmlPath。已有批注会话中的修订发布不重复询问。用户意见由 `$product-documentation` 修订同一 PRD；写入前检查停止状态，验证后用 `publish_prd_revision` 返回新版。仅排版、日期或无内容变化不启动评审。',
  'PRD 批注会话、反馈批次和正式文档状态分别记录。结束会话不代表确认；只有用户明确选择“确认当前版本”后，才由产品文档流程冻结确认版本，并在验证正式文件后调用 `complete_prd_confirmation`。等待超时、修订发布、格式校验或用户关闭工作台均不得自动确认。',
  '两份文档均完成核对、必要修订及一致性检查后才能宣布本轮交付完成，简述实际修订或无需修改的依据；有冲突或写入失败时明确未完成项。用户明确暂缓时如实保留未同步状态，不虚报闭环。',
  '不得使用 Stop、UserPromptSubmit、目录扫描或文件 hash 变化推断交付；工具只校验本批 HTML，不读取或修改 PRD/Spec，不证明实际同步。',
].join('\n');

let source = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) source += chunk;
const event = JSON.parse(source || '{}');
if (event.hook_event_name !== 'SessionStart') {
  throw new Error(`不支持 Hook 事件：${event.hook_event_name || 'unknown'}`);
}

process.stdout.write(`${JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: HTML_DELIVERY_AGENT_CONTEXT,
  },
})}\n`);
