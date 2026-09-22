#!/usr/bin/env node
import readline from 'node:readline';
import { readFileSync } from 'node:fs';
import { PRD_FOLLOWUP_SCHEMA, publishHtmlReady } from './html-delivery.mjs';
import { createPrdReviewMcp, prdReviewTools } from './prd-review-mcp.mjs';

const serverInfo = { name: 'interactive-product-spec-html-delivery', version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version };
let clientCapabilities = {};
let requestId = 0;
const pendingClientRequests = new Map();
const activeToolRequests = new Map();
const elicit = (params, { requestId: parentId } = {}) => {
  const capability = clientCapabilities.elicitation;
  if (!capability || (!Object.hasOwn(capability, 'form') && Object.keys(capability).length)) return null;
  const id = `prd-choice-${++requestId}`;
  return new Promise((resolve, reject) => {
    pendingClientRequests.set(id, { resolve, reject, parentId });
    send({ jsonrpc: '2.0', id, method: 'elicitation/create', params });
  });
};
const prdReviews = createPrdReviewMcp({ elicit });
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);

const tools = [{
  name: 'publish_html_ready',
  title: '上报 HTML 并接续文档同步',
  description: '当前 Codex 任务创建或实质修改用户要求交付的本地 HTML 页面、完成最低验证后调用一次；组件、JS 或 CSS 改变页面但 HTML 入口未变时，也上报该入口。无论用户是否调用 Skill，都在同一任务接续 PRD 与统一 Spec 核对，按影响修订后才完成交付，不弹出文档或类型选择。工具只校验指定 HTML，不读写文档、不证明已同步。按返回指令依次使用两项 Skill，判断修订、无需修改或非产品 HTML 不适用。只读、聊天代码、仅 PRD 修订、构建测试偶然产物不上报。旧 prdFollowup 仅兼容，不免除同步。',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: { type: 'string', description: '本批 HTML 所属 Project 根目录的绝对路径。' },
      htmlPaths: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: { type: 'string' },
        description: '本批已经完成并准备交付的 HTML/HTM 文件绝对路径。',
      },
      prdFollowup: PRD_FOLLOWUP_SCHEMA,
    },
    required: ['projectPath', 'htmlPaths'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, ...prdReviewTools];

const toolResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

const callTool = async ({ name, arguments: input = {} }, requestId, signal) => {
  if (name === 'publish_html_ready') return toolResult(await publishHtmlReady(input));
  if (prdReviewTools.some(tool => tool.name === name)) return toolResult(await prdReviews.call(name, input, { requestId, signal }));
  throw Object.assign(new Error(`未知工具：${name}`), { code: -32601 });
};

const handleRequest = async message => {
  const { id, method, params = {} } = message;
  if (method === 'notifications/initialized') return;
  if (method === 'notifications/cancelled') {
    activeToolRequests.get(params.requestId)?.abort();
    for (const [requestId, pending] of pendingClientRequests) {
      if (pending.parentId !== params.requestId) continue;
      pendingClientRequests.delete(requestId);
      send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId, reason: '原工具调用已取消' } });
      pending.reject(new Error('选择请求已取消'));
    }
    return;
  }
  if (method === 'initialize') {
    clientCapabilities = params.capabilities || {};
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo,
        instructions: '用户要求的本地 HTML 完成最低验证后调用 publish_html_ready 一次，再在当前任务使用 product-documentation 先核对 PRD 再核对 Spec，完成本轮同步。工具返回 document-sync-required 仅表示待处理；两个文档均核对并完成必要修订后才能宣布交付完成。不询问文档选择，不以历史决定或 prdFollowup 跳过。仅 PRD 修订不上报。PRD 首次生成完成且仍为草稿或评审中、用户未安排下一步时，调用 request_prd_review 询问评审时机。明确开始才 open_prd_review；明确暂缓或直接生成 Spec 则遵从，不重复询问。deferred 保留原任务中的文档链接和继续入口；choice-required 在原任务询问并等待。已有批注会话修订不重复询问；使用默认长等待接收批注、发布修订或处理停止；pending、超时或工具不可用时结束本轮等待，不自动轮询或用终端替代。用户选择确认当前版本后，仍由原任务使用 product-documentation 完成正式确认，再调用 complete_prd_confirmation；结束评审、评审会话状态与反馈批次状态都不得替代正式文档状态。',
      },
    });
    return;
  }
  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
    return;
  }
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools } });
    return;
  }
  if (method === 'tools/call') {
    const controller = new AbortController();
    activeToolRequests.set(id, controller);
    try {
      send({ jsonrpc: '2.0', id, result: await callTool(params, id, controller.signal) });
    } catch (error) {
      send({
        jsonrpc: '2.0',
        id,
        error: { code: error?.code || -32603, message: error instanceof Error ? error.message : String(error) },
      });
    } finally { activeToolRequests.delete(id); }
    return;
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `不支持的方法：${method}` } });
};

const interfaceReader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
interfaceReader.on('line', line => {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    process.stderr.write(`MCP JSON 解析失败：${error.message}\n`);
    return;
  }
  if (!message?.method && pendingClientRequests.has(message?.id)) {
    const pending = pendingClientRequests.get(message.id);
    pendingClientRequests.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
    return;
  }
  if (message?.method) {
    void handleRequest(message).catch(error => {
      if (message.id !== undefined) {
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } });
      }
    });
    return;
  }
});

interfaceReader.on('close', () => {
  for (const controller of activeToolRequests.values()) controller.abort();
  activeToolRequests.clear();
  for (const pending of pendingClientRequests.values()) pending.reject(new Error('客户端已断开'));
  pendingClientRequests.clear();
  void prdReviews.close();
});
