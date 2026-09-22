import { access } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { CodexAppServerClient, startVisibleCodexThread } from './codex-app-server.mjs';

const DEFAULT_SKILL_PATH = resolve(
  import.meta.dirname,
  '../../../skills/product-documentation/SKILL.md',
);

const draftPrompt = ({ projectPath, sourcePrdPath, draftPath }) => `
使用 Product Documentation Skill 的“产品需求文档”路径，把现有 PRD 接管为一份可映射的标准化草稿。

已确认输入与输出：
- 当前 Project：${projectPath}
- 必须完整读取的原始 PRD：${sourcePrdPath}
- 唯一允许写入的草稿文件：${draftPath}

必须完成：
1. 完整读取原始 PRD以及当前 Project 的正式产品入口；保留原文中已有依据的产品事实、未知项和用户修改，不猜测医院口径、权限、接口、医疗规则或实现状态。
2. 按 Product Documentation Skill 生成或修订一份完整、连续可读的产品需求文档草稿，并满足“可映射PRD-v1”格式合同。
3. 草稿必须保存在上面给出的唯一目标路径。目标文件已存在时，把它视为当前 Draft 原位完善；不得按轮次另建副本。
4. 不修改原始 PRD，不创建或修改 prd-map.json、Product Spec、HTML、源码、测试、确认版文档或其他文件。
5. 完成写入后自行复核文档头、详细功能四级章节及适用标准标题、全局规则和中文语义 prd-section-id；格式通过不代表产品内容已确认。
6. 最终简要说明草稿路径、保留的关键未知和仍需用户审核的范围。
`.trim();

const threadTitle = sourcePrdPath => {
  const sourceName = basename(sourcePrdPath).replace(/\.(?:md|markdown)$/i, '');
  return `PRD 标准化草稿 · ${sourceName}`;
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

export async function generatePrdDraftWithCodex({
  projectPath,
  sourcePrdPath,
  draftPath,
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
    const title = threadTitle(sourcePrdPath);
    const started = await startVisibleCodexThread(client, {
      title,
      model: model || null,
      cwd: projectPath,
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
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
    const prompt = draftPrompt({ projectPath, sourcePrdPath, draftPath });
    const input = [
      ...(resolvedSkillPath
        ? [{ type: 'skill', name: 'product-documentation', path: resolvedSkillPath }]
        : []),
      {
        type: 'text',
        text: resolvedSkillPath ? prompt : `$product-documentation\n\n${prompt}`,
        text_elements: [],
      },
    ];
    const response = await client.request('turn/start', {
      threadId,
      input,
      cwd: projectPath,
      approvalPolicy: 'never',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [projectPath],
        networkAccess: false,
      },
      model: selectedModel || null,
      effort: selectedEffort || null,
    });
    const turn = await client.waitForTurn(threadId, response.turn.id, signal);
    if (turn.status !== 'completed') {
      throw new Error(turn.error?.message || `Codex 对话未完成：${turn.status}`);
    }
    return {
      threadId,
      threadTitle: title,
      model: selectedModel,
      effort: selectedEffort,
    };
  } finally {
    client.close();
  }
}
