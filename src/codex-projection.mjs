import { access } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { CodexAppServerClient, startVisibleCodexThread } from './codex-app-server.mjs';

const DEFAULT_SKILL_PATH = resolve(
  import.meta.dirname,
  '../../../skills/product-documentation/SKILL.md',
);

const projectionPrompt = ({ projectPath, sourceSpecPath, htmlPath }) => `
使用 Product Documentation Skill 的“仅生成或刷新工作台 JSON 投影”路径，完成一次只读转换。按 references/projection.md 读取转换所需来源与格式合同，不进入 PRD／Spec 编写、架构设计、内容复核或用户评审流程。

已确认输入：
- 当前 Project：${projectPath}
- 原始 Markdown Spec：${sourceSpecPath}
${htmlPath ? `- 当前 HTML 页面证据：${htmlPath}` : '- 当前没有可供本次任务读取的本地 HTML；不要据此编造页面信息。'}

只执行以下任务：
1. 完整读取原始 Markdown Spec，并按 Skill 的规则派生 schemaVersion 为 0.1 的 product.spec.json 工作台投影。
2. 完整保留所有已有业务节点（包括普通操作）、稳定 ID、类型、模块与节点顺序、原文字段标题和内容及直接关联；不筛选关键性、不合并或拆分原节点。按页面组织的正文同样忠实投影，页面章节不是第三种映射节点；旧补充型 Spec 只投影、不自动补写需求。统一 Spec 的工程章节保留在原 Markdown，不转换成业务节点；bundle 不是整份 Spec 的无损副本，不得反向覆盖整份正文。
3. 页面是与正文正交的工作台投影：只有当前来源能证明实际页面时才写入顶层 pages 并让节点用 pageId 引用；仅拟定的页面、路由和布局不算已实现证据，没有实际页面证据时 pages 返回空数组、pageId 返回 null，不得为了满足结构编造页面。
4. 只有已确认页面证据明确证明导航父子关系时才写 parentPageId；不得按标题、数组顺序、route 字符串或 DOM 猜测。没有明确父页面时返回 null。
5. HTML 只用于补充可见页面、路由或锚点提示，不能替代产品语义，也不能推断后端、权限或医疗规则。
6. 不修改任何文件，不启动工作台，不创建 spec-map.json，不修订 Markdown。
7. 最终只返回符合所给 JSON Schema 的 JSON 对象，不附加解释或 Markdown 代码块。
`.trim();

const projectionThreadTitle = sourceSpecPath => {
  const sourceName = basename(sourceSpecPath).replace(/\.(?:md|markdown)$/i, '');
  return `Interactive Product Spec · ${sourceName}`;
};

const availableSkillPath = async preferred => {
  const candidates = preferred ? [preferred] : [
    resolve(import.meta.dirname, '../skills/product-documentation/SKILL.md'),
    DEFAULT_SKILL_PATH,
  ];
  for (const path of candidates) {
    try { await access(path); return path; } catch { /* Try the next supported layout. */ }
  }
  return '';
};

export async function generateProjectionWithCodex({
  projectPath,
  sourceSpecPath,
  htmlPath = '',
  outputSchema,
  model = '',
  effort = '',
  signal,
  onThreadCreated,
  codexPath = '',
  skillPath = '',
  clientFactory,
}) {
  const client = clientFactory
    ? await clientFactory()
    : new CodexAppServerClient({ codexPath });
  try {
    await client.start();
    const title = projectionThreadTitle(sourceSpecPath);
    const started = await startVisibleCodexThread(client, {
      title,
      model: model || null,
      cwd: projectPath,
      approvalPolicy: 'never',
      sandbox: 'read-only',
    });
    const threadId = started.threadId;
    const selectedModel = started.model || model;
    const selectedEffort = effort || started.reasoningEffort || '';
    onThreadCreated?.({
      threadId,
      threadTitle: title,
      model: selectedModel,
      effort: selectedEffort,
    });

    const resolvedSkillPath = await availableSkillPath(skillPath);
    const input = [
      ...(resolvedSkillPath
        ? [{ type: 'skill', name: 'product-documentation', path: resolvedSkillPath }]
        : []),
      {
        type: 'text',
        text: resolvedSkillPath
          ? projectionPrompt({ projectPath, sourceSpecPath, htmlPath })
          : `$product-documentation\n\n${projectionPrompt({ projectPath, sourceSpecPath, htmlPath })}`,
        text_elements: [],
      },
    ];
    const response = await client.request('turn/start', {
      threadId,
      input,
      cwd: projectPath,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      model: selectedModel || null,
      effort: selectedEffort || null,
      outputSchema,
    });
    const turn = await client.waitForTurn(threadId, response.turn.id, signal);
    if (turn.status !== 'completed') {
      throw new Error(turn.error?.message || `Codex 对话未完成：${turn.status}`);
    }
    const finalMessage = [...(turn.items || [])]
      .reverse()
      .find(item => item.type === 'agentMessage' && item.phase === 'final_answer')
      || [...(turn.items || [])].reverse().find(item => item.type === 'agentMessage');
    let bundle;
    try {
      bundle = JSON.parse(finalMessage?.text || '');
    } catch {
      throw new Error('Codex 对话已完成，但没有返回可读取的工作台 JSON');
    }
    return {
      bundle,
      threadId,
      threadTitle: title,
      model: selectedModel,
      effort: selectedEffort,
      usage: null,
    };
  } finally {
    client.close();
  }
}
