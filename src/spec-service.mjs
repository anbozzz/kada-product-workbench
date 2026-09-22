import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  diffSpecBundles,
  flattenSpecNodes,
  validateSpecBundle,
  validateSpecMap,
} from './contracts.mjs';
import { loadPrdImages } from './prd-images.mjs';
import { updateMarkdownSpecNode } from './markdown-spec-editor.mjs';

const hashText = value => createHash('sha256').update(value).digest('hex');

export const readSpecSource = async specPath => {
  const source = await readFile(specPath, 'utf8');
  const bundle = JSON.parse(source);
  const errors = validateSpecBundle(bundle);
  if (errors.length) throw new Error(`Spec bundle 校验失败：\n- ${errors.join('\n- ')}`);
  return { bundle, revision: hashText(source) };
};

export const readMarkdownSource = async sourceSpecPath => {
  const source = await readFile(sourceSpecPath, 'utf8');
  if (!source.trim()) throw new Error('原始 Spec 文档不能为空');
  return { source, revision: hashText(source) };
};

export const writeAtomicText = async (path, content, suffix = randomUUID()) => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${suffix}.tmp`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, path);
};

const prepareSpecChangeSet = (active, body) => {
  if (active.mode !== 'map' || (!active.sourceSpecPath && !active.specPath)) {
    return {
      error: {
        statusCode: 403,
        body: { ok: false, error: '当前会话没有可写入的本地 Spec 原文件' },
      },
    };
  }
  const nextBundle = body.productSpec;
  const errors = validateSpecBundle(nextBundle);
  if (errors.length) {
    return { error: { statusCode: 400, body: { ok: false, errors } } };
  }

  if (!body.baseRevision || body.baseRevision !== active.specRevision) {
    return {
      error: {
        statusCode: 409,
        body: {
          ok: false,
          code: 'SPEC_DRAFT_CHANGED',
          error: '修订草稿已发生变化，请重新载入当前节点后再保存',
        },
      },
    };
  }

  const mapErrors = validateSpecMap(active.map, nextBundle, { allowMissingNodes: true });
  if (mapErrors.length) {
    return {
      error: {
        statusCode: 400,
        body: {
          ok: false,
          errors: mapErrors,
          error: '修改后的 Product Spec 与当前映射不一致',
        },
      },
    };
  }

  return {
    changeSet: {
      baseRevision: body.baseRevision,
      nodeId: body.nodeId || '',
      nextBundle,
      changes: diffSpecBundles(active.bundle, nextBundle),
    },
  };
};

export const CodexGateCommit = async (active, changeSet) => {
  active.bundle = changeSet.nextBundle;
  active.specRevision = hashText(JSON.stringify(changeSet.nextBundle));
  return {
    statusCode: 200,
    body: {
      ok: true,
      productSpec: changeSet.nextBundle,
      specRevision: active.specRevision,
      sourceSpecRevision: active.sourceSpecRevision,
      changeCount: diffSpecBundles(active.baseBundle, active.bundle).length,
      saveTarget: 'codex-gate-draft',
    },
  };
};

export const DirectSourceCommit = async (active, changeSet) => {
  const { changes, nextBundle, nodeId: requestedNodeId } = changeSet;
  if (changes.length !== 1 || (requestedNodeId && changes[0].nodeId !== requestedNodeId)) {
    return {
      statusCode: 400,
      body: { ok: false, error: '一次只能保存当前正在编辑的一个 Spec 节点' },
    };
  }

  const projectionContent = `${JSON.stringify(nextBundle, null, 2)}\n`;
  let nextSourceRevision = active.sourceSpecRevision;
  let specDocument = active.specDocument || null;
  if (active.sourceSpecPath) {
    const currentSource = await readMarkdownSource(active.sourceSpecPath);
    if (currentSource.revision !== active.sourceSpecRevision) {
      return {
        statusCode: 409,
        body: {
          ok: false,
          code: 'SOURCE_SPEC_CHANGED',
          error: '本地 Markdown Spec 已在工作台外发生变化，请重新载入后再编辑',
        },
      };
    }
    const beforeById = new Map(flattenSpecNodes(active.bundle).map(node => [node.id, node]));
    const afterById = new Map(flattenSpecNodes(nextBundle).map(node => [node.id, node]));
    const nodeId = changes[0].nodeId;
    const nextSource = updateMarkdownSpecNode(
      currentSource.source,
      beforeById.get(nodeId),
      afterById.get(nodeId),
    );
    const images = await loadPrdImages({ source: nextSource, path: active.sourceSpecPath }, active.projectPath);
    await writeAtomicText(active.sourceSpecPath, nextSource);
    try {
      await writeAtomicText(active.specPath, projectionContent);
    } catch (error) {
      await writeAtomicText(active.sourceSpecPath, currentSource.source, 'rollback');
      throw error;
    }
    nextSourceRevision = hashText(nextSource);
    specDocument = { source: nextSource, revision: nextSourceRevision, images };
  } else {
    await writeAtomicText(active.specPath, projectionContent);
  }

  active.bundle = nextBundle;
  active.baseBundle = structuredClone(nextBundle);
  active.specRevision = hashText(projectionContent);
  active.sourceSpecRevision = nextSourceRevision;
  active.specDocument = specDocument;
  return {
    statusCode: 200,
    body: {
      ok: true,
      productSpec: nextBundle,
      specRevision: active.specRevision,
      sourceSpecRevision: active.sourceSpecRevision,
      specDocument,
      changeCount: 0,
      saveTarget: active.sourceSpecPath ? 'source-spec-markdown' : 'spec-json',
    },
  };
};

const SPEC_COMMIT_STRATEGIES = Object.freeze({
  directSource: DirectSourceCommit,
  codexGate: CodexGateCommit,
});

export async function saveSpecNode(active, body) {
  const prepared = prepareSpecChangeSet(active, body);
  if (prepared.error) return prepared.error;
  const commit = active.gate
    ? SPEC_COMMIT_STRATEGIES.codexGate
    : SPEC_COMMIT_STRATEGIES.directSource;
  return await commit(active, prepared.changeSet);
}

export async function prepareReviewSubmission(active) {
  if (active.mode !== 'map' || !active.gate || !active.sourceSpecPath) {
    return {
      statusCode: 403,
      body: {
        ok: false,
        error: '当前工作台不是由等待中的 Codex 修订请求启动，无法提交',
      },
    };
  }

  const currentSource = await readFile(active.sourceSpecPath, 'utf8');
  const currentSourceRevision = hashText(currentSource);
  if (currentSourceRevision !== active.sourceSpecRevision) {
    return {
      statusCode: 409,
      body: {
        ok: false,
        code: 'SOURCE_SPEC_CHANGED',
        error: '原始 Spec 文档已在工作台外发生变化。请让 Codex 重新读取后再发起修订',
      },
    };
  }

  const bundleErrors = validateSpecBundle(active.bundle);
  const mapErrors = validateSpecMap(active.map, active.bundle);
  if (bundleErrors.length || mapErrors.length) {
    return {
      statusCode: 400,
      body: {
        ok: false,
        errors: [...bundleErrors, ...mapErrors],
        error: '修订草稿或页面映射未通过提交校验',
      },
    };
  }

  const changes = diffSpecBundles(active.baseBundle, active.bundle);
  const submission = {
    schemaVersion: '0.1',
    type: 'interactive-product-spec-review',
    decision: 'submit',
    sessionId: active.sessionId,
    projectPath: active.projectPath || '',
    productSpecId: active.bundle.product.id,
    sourceSpec: {
      path: active.sourceSpecPath,
      revision: active.sourceSpecRevision,
    },
    viewSpec: {
      path: active.specPath || '',
      baseRevision: hashText(JSON.stringify(active.baseBundle)),
      draftRevision: active.specRevision,
    },
    specMap: {
      path: active.mapPath,
      updatedAt: active.map.updatedAt,
    },
    changes,
    submittedAt: new Date().toISOString(),
    applyTarget: 'source-spec-markdown-only',
  };
  return { statusCode: 200, body: { ok: true, submission } };
}
