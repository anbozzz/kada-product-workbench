import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createSkillFixtures } from './helpers/plugin-fixture.mjs';
import { generateProjectionWithCodex } from '../src/codex-projection.mjs';
import { listCodexModels } from '../src/codex-app-server.mjs';

const root = resolve(import.meta.dirname, '..');

test('Codex 投影使用持久可见对话、明确标题、模型与只读策略', async () => {
  const calls = [];
  let closed = false;
  const bundle = {
    schemaVersion: '0.1',
    product: { id: 'TEST', title: '测试', version: '1', status: 'draft' },
    modules: [],
  };
  const client = {
    async start() {},
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'thread/start') {
        return {
          thread: { id: 'thread-visible-test' },
          model: 'gpt-5.6-terra',
          reasoningEffort: 'medium',
        };
      }
      if (method === 'turn/start') return { turn: { id: 'turn-test' } };
      return {};
    },
    async waitForTurn(threadId, turnId) {
      assert.equal(threadId, 'thread-visible-test');
      assert.equal(turnId, 'turn-test');
      return {
        status: 'completed',
        items: [{
          type: 'agentMessage',
          phase: 'final_answer',
          text: JSON.stringify(bundle),
        }],
      };
    },
    close() { closed = true; },
  };
  let created;
  const fixture = await createSkillFixtures(await mkdtemp(join(tmpdir(), 'ips-doc-skill-')));
  const result = await generateProjectionWithCodex({
    skillPath: resolve(process.env.IPS_WORKSPACE_SKILLS_ROOT || fixture, 'product-documentation/SKILL.md'),
    projectPath: root,
    sourceSpecPath: resolve(root, 'examples/task-board/task-board.spec.md'),
    htmlPath: resolve(root, 'examples/task-board/index.html'),
    outputSchema: { type: 'object' },
    model: 'gpt-5.6-terra',
    effort: 'medium',
    clientFactory: async () => client,
    onThreadCreated: value => { created = value; },
  });

  const threadStart = calls.find(call => call.method === 'thread/start');
  assert.equal(threadStart.params.ephemeral, false);
  assert.equal(threadStart.params.sandbox, 'read-only');
  assert.equal(threadStart.params.approvalPolicy, 'never');
  assert.equal(threadStart.params.model, 'gpt-5.6-terra');
  assert.equal(threadStart.params.threadSource, 'user');
  assert.equal(threadStart.params.serviceName, 'interactive_product_spec');
  const nameCall = calls.find(call => call.method === 'thread/name/set');
  assert.equal(nameCall.params.name, 'Interactive Product Spec · task-board.spec');
  const turnStart = calls.find(call => call.method === 'turn/start');
  assert.equal(turnStart.params.effort, 'medium');
  assert.deepEqual(turnStart.params.sandboxPolicy, { type: 'readOnly', networkAccess: false });
  assert.ok(turnStart.params.input.some(input => input.type === 'skill' && input.name === 'product-documentation'));
  assert.equal(created.threadId, 'thread-visible-test');
  assert.equal(result.bundle.product.id, 'TEST');
  assert.equal(result.threadTitle, 'Interactive Product Spec · task-board.spec');
  assert.equal(closed, true);
});

test('模型列表只暴露当前账号可选模型和推理强度', async () => {
  let closed = false;
  const models = await listCodexModels({
    clientFactory: async () => ({
      async start() {},
      async request(method) {
        assert.equal(method, 'model/list');
        return {
          data: [{
            id: 'gpt-5.6-sol',
            displayName: 'GPT-5.6-Sol',
            description: 'Frontier',
            hidden: false,
            supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Deep' }],
            defaultReasoningEffort: 'high',
            isDefault: true,
          }, {
            id: 'hidden',
            displayName: 'Hidden',
            description: '',
            hidden: true,
            supportedReasoningEfforts: [],
            defaultReasoningEffort: 'low',
            isDefault: false,
          }],
        };
      },
      close() { closed = true; },
    }),
  });

  assert.deepEqual(models, [{
    id: 'gpt-5.6-sol',
    displayName: 'GPT-5.6-Sol',
    description: 'Frontier',
    supportedReasoningEfforts: [{ id: 'high', description: 'Deep' }],
    defaultReasoningEffort: 'high',
    isDefault: true,
  }]);
  assert.equal(closed, true);
});
