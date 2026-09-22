import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createSkillFixtures } from './helpers/plugin-fixture.mjs';
import { generatePrdDraftWithCodex } from '../src/codex-prd-draft.mjs';

const root = resolve(import.meta.dirname, '..');

test('PRD 草稿使用持久可见对话、受限项目写权限和 Product Documentation Skill', async () => {
  const calls = [];
  let closed = false;
  const client = {
    async start() {},
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'thread/start') {
        return {
          thread: { id: 'thread-prd-draft-test' },
          model: 'gpt-5.6-terra',
          reasoningEffort: 'high',
        };
      }
      if (method === 'turn/start') return { turn: { id: 'turn-prd-draft-test' } };
      return {};
    },
    async waitForTurn(threadId, turnId) {
      assert.equal(threadId, 'thread-prd-draft-test');
      assert.equal(turnId, 'turn-prd-draft-test');
      return { status: 'completed', items: [] };
    },
    close() { closed = true; },
  };
  const sourcePrdPath = resolve(root, 'drafts-documents/Interactive Product Spec产品需求文档.md');
  const draftPath = resolve(root, 'drafts-documents/Interactive Product Spec产品需求文档-标准化草稿.md');
  const fixture = await createSkillFixtures(await mkdtemp(join(tmpdir(), 'ips-prd-skill-')));
  const result = await generatePrdDraftWithCodex({
    skillPath: resolve(process.env.IPS_WORKSPACE_SKILLS_ROOT || fixture, 'product-documentation/SKILL.md'),
    projectPath: root,
    sourcePrdPath,
    draftPath,
    model: 'gpt-5.6-terra',
    effort: 'high',
    clientFactory: async () => client,
  });

  const threadStart = calls.find(call => call.method === 'thread/start');
  assert.equal(threadStart.params.ephemeral, false);
  assert.equal(threadStart.params.sandbox, 'workspace-write');
  assert.equal(threadStart.params.approvalPolicy, 'never');
  assert.equal(threadStart.params.threadSource, 'user');
  assert.equal(threadStart.params.serviceName, 'interactive_product_spec');
  const turnStart = calls.find(call => call.method === 'turn/start');
  assert.deepEqual(turnStart.params.sandboxPolicy, {
    type: 'workspaceWrite',
    writableRoots: [root],
    networkAccess: false,
  });
  assert.ok(turnStart.params.input.some(input =>
    input.type === 'skill' && input.name === 'product-documentation'));
  const prompt = turnStart.params.input.find(input => input.type === 'text').text;
  assert.match(prompt, /不修改原始 PRD/);
  assert.match(prompt, /不得按轮次另建副本/);
  assert.match(prompt, new RegExp(draftPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(result.threadId, 'thread-prd-draft-test');
  assert.equal(result.threadTitle, 'PRD 标准化草稿 · Interactive Product Spec产品需求文档');
  assert.equal(closed, true);
});
