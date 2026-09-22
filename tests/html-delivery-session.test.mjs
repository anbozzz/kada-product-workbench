import test from 'node:test';
import { HTML_DELIVERY_SCOPE } from '../src/html-delivery.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const commandPath = resolve(root, 'src/html-delivery-session.mjs');

const run = event => new Promise(resolveRun => {
  const child = spawn(process.execPath, [commandPath], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(`${JSON.stringify(event)}\n`);
  child.once('exit', code => resolveRun({ code, stdout, stderr }));
});

test('SessionStart 只注入 HTML 完成协议，不扫描目录或弹出确认', async () => {
  const result = await run({
    hook_event_name: 'SessionStart',
    source: 'startup',
    cwd: root,
    session_id: 'session-html-delivery',
  });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout);
  const context = output.hookSpecificOutput.additionalContext;
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(context.split('\n')[1], HTML_DELIVERY_SCOPE);
  assert.match(context, /无论用户是否调用过任何 Skill/);
  assert.match(context, /publish_html_ready/);
  assert.match(context, /\$product-documentation/);
  assert.match(context, /先核对 PRD 再核对 Spec/);
  assert.match(context, /同一任务显式使用/);
  assert.match(context, /开始页面修订或恢复任务时先读取/);
  assert.match(context, /组件、JS 或 CSS 改变交付页面也适用，即使 HTML 入口文件内容未变/);
  assert.match(context, /每轮均核对两份文档/);
  assert.match(context, /不询问文档选择、PRD 类型或是否同步/);
  assert.match(context, /两份文档均完成核对、必要修订及一致性检查后才能宣布/);
  assert.match(context, /仅改 PRD 不调用 HTML 上报/);
  assert.match(context, /旧 prdFollowup 仅兼容，不再跳过/);
  assert.doesNotMatch(context, /不自动生成 Spec|classic|faithful-compressed|同一批 revision 已处理/);
  assert.match(context, /不得使用 Stop、UserPromptSubmit、目录扫描/);
  assert.doesNotMatch(result.stdout, /decision|elicitation/);
});

test('完成协议命令拒绝被错误接到 Stop', async () => {
  const result = await run({ hook_event_name: 'Stop' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /不支持 Hook 事件：Stop/);
});
