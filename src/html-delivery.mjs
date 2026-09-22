import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, isAbsolute, parse, relative, resolve, sep } from 'node:path';

const MAX_HTML_FILES = 20;
const MAX_HTML_BYTES = 10 * 1024 * 1024;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const inside = (root, path) => path === root || path.startsWith(`${root}${sep}`);

// Keep old-session input compatible without allowing it to bypass document sync.
export const PRD_FOLLOWUP_SCHEMA = Object.freeze({
  type: 'object',
  description: '旧版会话兼容字段，新调用请省略。声明不会免除 PRD 与 Spec 同轮核对，也不代表插件核验了文档。',
  properties: {
    source: { type: 'string', enum: ['product-documentation'] },
    prdHandled: { type: 'boolean', const: true, description: '已完成本次 PRD 整理（含无需修改），不能仅因选择过 PRD 路由就设为 true。' },
    pageUpdateAuthorized: { type: 'boolean', const: true, description: '用户已同意继续处理这些页面。' },
    requirements: { type: 'string', enum: ['covered', 'new-or-uncertain'], description: 'covered：本批相关内容已核对且没有新需求差异；new-or-uncertain：有新增或尚未明确差异。不是全产品验收。' },
  },
  required: ['source', 'prdHandled', 'pageUpdateAuthorized', 'requirements'],
  additionalProperties: false,
});

const validatePrdFollowup = value => {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !Object.hasOwn(PRD_FOLLOWUP_SCHEMA.properties, key))
    || value.source !== 'product-documentation' || value.prdHandled !== true
    || value.pageUpdateAuthorized !== true || !['covered', 'new-or-uncertain'].includes(value.requirements)) {
    throw new Error('prdFollowup 必须是本次 PRD 已处理且页面跟进已获用户授权的完整声明；无法确认时省略，不得猜测');
  }
  return { source: value.source, prdHandled: true, pageUpdateAuthorized: true, requirements: value.requirements };
};

const requiredText = (value, label) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${label} 不能为空`);
  return normalized;
};

const requiredAbsolutePath = (value, label) => {
  const path = requiredText(value, label);
  if (!isAbsolute(path)) throw new Error(`${label} 必须是绝对路径`);
  return path;
};

const resolveProject = async value => {
  const requested = resolve(requiredAbsolutePath(value, 'projectPath'));
  const projectPath = await realpath(requested);
  const info = await stat(projectPath);
  if (!info.isDirectory()) throw new Error('projectPath 必须是目录');
  if (projectPath === parse(projectPath).root || projectPath === resolve(homedir())) {
    throw new Error('projectPath 不得是文件系统根目录或用户主目录');
  }
  return projectPath;
};

const resolveHtmlArtifact = async (projectPath, value) => {
  const requested = resolve(requiredAbsolutePath(value, 'htmlPath'));
  let htmlPath;
  try {
    htmlPath = await realpath(requested);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`HTML 文件不存在：${requested}`);
    throw error;
  }
  if (!inside(projectPath, htmlPath)) throw new Error(`HTML 必须位于当前 Project 内：${htmlPath}`);
  if (!['.html', '.htm'].includes(extname(htmlPath).toLowerCase())) {
    throw new Error(`完成上报只接受 .html 或 .htm：${htmlPath}`);
  }
  const info = await stat(htmlPath);
  if (!info.isFile()) throw new Error(`HTML 路径不是文件：${htmlPath}`);
  if (info.size === 0) throw new Error(`HTML 文件为空：${htmlPath}`);
  if (info.size > MAX_HTML_BYTES) throw new Error(`HTML 文件超过 10MB 上限：${htmlPath}`);
  const content = await readFile(htmlPath);
  return {
    path: htmlPath,
    relativePath: relative(projectPath, htmlPath),
    revision: sha256(content),
    size: info.size,
  };
};

export async function resolveHtmlDeliveryBatch(input) {
  const projectPath = await resolveProject(input?.projectPath);
  if (!Array.isArray(input?.htmlPaths) || input.htmlPaths.length === 0) {
    throw new Error('htmlPaths 至少包含一个已完成的 HTML 文件');
  }
  if (input.htmlPaths.length > MAX_HTML_FILES) {
    throw new Error(`一次完成上报最多包含 ${MAX_HTML_FILES} 个 HTML 文件`);
  }
  const artifacts = await Promise.all(input.htmlPaths.map(path => resolveHtmlArtifact(projectPath, path)));
  const unique = new Map();
  for (const artifact of artifacts) {
    if (unique.has(artifact.path)) throw new Error(`htmlPaths 包含重复文件：${artifact.path}`);
    unique.set(artifact.path, artifact);
  }
  const sortedArtifacts = [...unique.values()].sort((left, right) => left.path.localeCompare(right.path));
  const deliveryId = sha256([
    projectPath,
    ...sortedArtifacts.flatMap(artifact => [artifact.path, artifact.revision]),
  ].join('\0'));
  return { schemaVersion: 1, deliveryId, projectPath, artifacts: sortedArtifacts };
}


const DOCUMENT_SYNC_INSTRUCTION = [
  '本批 HTML 已通过路径与 revision 校验，PRD 与统一 Spec 尚待当前 Agent 核对；工具返回不表示文档已同步。',
  '现在显式使用 `$product-documentation`，先核对 PRD 再核对 Spec，在同一任务执行 product-documentation 的“HTML 交付与文档同步”方法，不询问文档选择或 PRD 类型。',
  '按本轮用户明确反馈、当前 Project 正式文档和实际页面差异处理，先核对 PRD 的需求与规则，再核对统一 Spec 的页面行为、工程约束和验收；只修订受影响内容，已有覆盖则说明无需修改。',
  '文档缺失时按实际产品范围生成草稿；非产品 HTML 由 Skill 说明不适用，不凭空建立产品文档。探索方案保留候选，页面可见不证明保存、权限或后端能力。',
  '同步保留稳定 ID、有效引用、独立工程章节和人工 Map；未请求映射时不启动工作台交互。每轮结束及中断恢复都以当前文件为准，不积压到多轮聊天之后。',
  '两份文档均完成核对、必要修订及一致性检查后，才能宣布本轮交付完成；冲突或写入失败时说明具体未完成项，不以本次上报、历史选择或 prdFollowup 声明代替完成证据。',
].join('\n');

export async function publishHtmlReady(input) {
  validatePrdFollowup(input?.prdFollowup);
  const batch = await resolveHtmlDeliveryBatch(input);
  // No persisted decision: retries and unchanged HTML can still need document work.
  return {
    status: 'document-sync-required',
    route: 'prd-spec',
    skill: 'product-documentation',
    followUpSkills: [],
    batch,
    instruction: DOCUMENT_SYNC_INSTRUCTION,
  };
}
