import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Ajv from 'ajv';
import { source as prdSource } from './fixtures/prd-review.mjs';


const root = resolve(import.meta.dirname, '..');

class JsonLineMcpClient {
  constructor(serverPath, options = {}) {
    this.child = spawn(process.execPath, [serverPath], {
      cwd: root,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.elicitations = [];
    this.elicitationResponse = options.elicitationResponse ?? { action: 'decline' };
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf('\n');
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line) this.#handle(JSON.parse(line));
        newline = this.buffer.indexOf('\n');
      }
    });
  }

  #send(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handle(message) {
    if (message.method === 'elicitation/create') {
      this.elicitations.push(message.params);
      const result = typeof this.elicitationResponse === 'function' ? this.elicitationResponse(message.params) : this.elicitationResponse;
      this.#send({ jsonrpc: '2.0', id: message.id, result });
      return;
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }

  request(method, params = {}) {
    const id = this.nextId++;
    this.#send({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolveRequest, rejectRequest) => this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest }));
  }

  notify(method, params = {}) {
    this.#send({ jsonrpc: '2.0', method, params });
  }

  async close() {
    this.child.stdin.end();
    await new Promise(resolveClose => this.child.exitCode !== null ? resolveClose() : this.child.once('exit', resolveClose));
  }
}

const start = async (t, capabilities = {}) => {
  const projectPath = await realpath(await mkdtemp(join(tmpdir(), 'ips-html-sync-mcp-')));
  const htmlPath = join(projectPath, 'index.html');
  await writeFile(htmlPath, '<title>v1</title>');
  const client = new JsonLineMcpClient(resolve(root, 'src/html-delivery-mcp.mjs'), {
    env: { IPS_HOME: join(projectPath, '.ips-home') },
  });
  t.after(async () => {
    if (client.child.exitCode === null) await client.close();
    await rm(projectPath, { recursive: true, force: true });
  });
  const initialized = await client.request('initialize', {
    protocolVersion: '2025-11-25', capabilities,
    clientInfo: { name: 'html-delivery-test', version: '1.0.0' },
  });
  assert.equal(initialized.serverInfo.name, 'interactive-product-spec-html-delivery');
  client.notify('notifications/initialized');
  return { client, projectPath, htmlPath, input: { projectPath, htmlPaths: [htmlPath] } };
};

const publish = async (client, input) => {
  const called = await client.request('tools/call', { name: 'publish_html_ready', arguments: input });
  const result = JSON.parse(called.content[0].text);
  assert.equal(result.status, 'document-sync-required');
  assert.equal(result.route, 'prd-spec');
  assert.equal(result.skill, 'product-documentation');
  assert.deepEqual(result.followUpSkills, []);
  assert.equal(client.elicitations.length, 0);
  assert.equal(result.decision, undefined);
  return result;
};

for (const [name, capabilities] of [['有表单能力', { elicitation: { form: {} } }], ['无表单能力', {}]]) {
  test(`MCP ${name}时都直接返回两份文档的待同步任务，无任何弹窗`, { timeout: 10000 }, async t => {
    const { client, input } = await start(t, capabilities);
    const listed = await client.request('tools/list');
    assert.deepEqual(listed.tools.map(tool => tool.name), [
      'publish_html_ready',
      'request_prd_review',
      'open_prd_review',
      'wait_prd_feedback',
      'publish_prd_revision',
      'get_prd_feedback_status',
      'acknowledge_prd_stop',
      'complete_prd_confirmation',
    ]);
    assert.equal(listed.tools[0].annotations.readOnlyHint, true);
    const first = await publish(client, input);
    const resumed = await publish(client, input);
    assert.equal(resumed.batch.deliveryId, first.batch.deliveryId);
    assert.match(first.instruction, /工具返回不表示文档已同步/);
  });
}

test('MCP 旧版 covered 声明不能免除 Spec，非法声明可修正后重试', { timeout: 10000 }, async t => {
  const { client, input, htmlPath } = await start(t, { elicitation: { form: {} } });
  const listed = await client.request('tools/list');
  const validate = new Ajv({ strict: true }).compile(listed.tools[0].inputSchema);
  const prdFollowup = { source: 'product-documentation', prdHandled: true, pageUpdateAuthorized: true, requirements: 'covered' };
  assert.equal(validate({ ...input, prdFollowup }), true);
  assert.equal(validate({ ...input, prdFollowup: { ...prdFollowup, pageUpdateAuthorized: false } }), false);
  assert.equal(validate({ ...input, choice: 'skip' }), false);
  const first = await publish(client, { ...input, prdFollowup });
  await assert.rejects(client.request('tools/call', {
    name: 'publish_html_ready', arguments: { ...input, prdFollowup: {} },
  }), /prdFollowup/);
  await writeFile(htmlPath, '<title>v2</title>');
  const second = await publish(client, input);
  assert.notEqual(second.batch.deliveryId, first.batch.deliveryId);
});

test('MCP 路径错误与未知工具不终止服务，正常上报仍可完成协议响应', { timeout: 10000 }, async t => {
  const { client, input, projectPath } = await start(t);
  await assert.rejects(client.request('tools/call', {
    name: 'publish_html_ready', arguments: { ...input, htmlPaths: [join(projectPath, 'missing.html')] },
  }), /不存在/);
  await assert.rejects(client.request('tools/call', { name: 'missing' }), /未知工具/);
  await assert.rejects(client.request('unknown/method'), /不支持的方法/);
  assert.deepEqual(await client.request('ping'), {});
  await publish(client, input);
});

for (const [label, response, expected] of [
  ['开始', { action: 'accept', content: { review: '开始评审' } }, 'reviewing'],
  ['稍后', { action: 'accept', content: { review: '稍后评审' } }, 'deferred'],
  ['关闭', { action: 'cancel' }, 'deferred'],
  ['拒绝', { action: 'decline' }, 'deferred'],
  ['无效回答', { action: 'accept', content: { review: 'yes' } }, 'choice-required'],
]) {
  test(`PRD 生成选择：${label}，独立于 HTML 同步且没有 HTML 也可继续`, { timeout: 15000 }, async t => {
    const { client, projectPath } = await start(t, { elicitation: { form: {} } });
    client.elicitationResponse = response;
    const prdPath = join(projectPath, 'PRD.md');
    await writeFile(prdPath, prdSource);
    const call = (name, args) => client.request('tools/call', { name, arguments: args }).then(result => JSON.parse(result.content[0].text));
    const input = { projectPath, prdPath };
    const result = await call('request_prd_review', input);
    assert.equal(result.status, expected);
    assert.equal(client.elicitations.length, 1);
    assert.match(client.elicitations[0].message, /是否现在开始评审/);
    if (expected === 'choice-required') return;
    const retry = await call('request_prd_review', input);
    assert.equal(client.elicitations.length, 1, 'same revision must not ask again');
    assert.equal(retry.status, expected);
    const opened = expected === 'reviewing' ? result : await call(result.resume.tool, result.resume.arguments);
    assert.equal(client.elicitations.length, 1, 'explicit start after defer bypasses prompt');
    const config = await (await fetch(`${opened.url}api/config`)).json();
    assert.equal(config.reviewBaseline.target.type, 'document');
    assert.equal(config.prd.source, prdSource);
    assert.equal(config.prdMap, null);
    assert.equal(config.prdReview.status, 'reviewing');
    assert.equal(config.reviewPackage.canExport, false);
  });
}

test('PRD 无表单能力时返回待选择，不默认为开始', { timeout: 10000 }, async t => {
  const { client, projectPath } = await start(t, { elicitation: { url: {} } });
  const prdPath = join(projectPath, 'PRD.md');
  await writeFile(prdPath, prdSource);
  const called = await client.request('tools/call', { name: 'request_prd_review', arguments: { projectPath, prdPath } });
  const result = JSON.parse(called.content[0].text);
  assert.equal(result.status, 'choice-required');
  assert.equal(client.elicitations.length, 0);
  assert.equal(result.url, undefined);
});

test('MCP cancellation stops only its pending review wait and keeps the connection usable', { timeout: 10000 }, async t => {
  const { client, projectPath } = await start(t);
  const prdPath = join(projectPath, 'PRD.md');
  await writeFile(prdPath, prdSource);
  const opened = JSON.parse((await client.request('tools/call', {
    name: 'open_prd_review', arguments: { projectPath, prdPath },
  })).content[0].text);
  const id = client.nextId;
  const waiting = client.request('tools/call', { name: 'wait_prd_feedback', arguments: { sessionId: opened.sessionId } });
  const rejected = assert.rejects(waiting, /abort/i);
  await client.request('ping');
  client.notify('notifications/cancelled', { requestId: id });
  await rejected;
  const probe = JSON.parse((await client.request('tools/call', {
    name: 'wait_prd_feedback', arguments: { sessionId: opened.sessionId, timeoutMs: 0 },
  })).content[0].text);
  assert.equal(probe.status, 'pending');
  await client.request('ping');
});
