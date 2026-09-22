import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defaultStatePath } from './project-store.mjs';
import { readPrdDocument, prdLifecycleStatus } from './prd-service.mjs';
import { resolvePrdReviewSources } from './prd-review-service.mjs';

export function createPrdReviewEntry({ statePath = defaultStatePath(), elicit, open }) {
  const pending = new Map();
  return async (input, context = {}) => {
    const sources = await resolvePrdReviewSources(input);
    const { document } = await readPrdDocument(sources.prdPath);
    if (!['draft', 'reviewing'].includes(prdLifecycleStatus(document.status))) {
      throw new Error('生成后评审选择只接受草稿或评审中的 PRD');
    }
    const identity = JSON.stringify([sources.projectPath, sources.prdPath, document.revision]);
    const id = createHash('sha256').update(identity).digest('hex');
    if (pending.has(id)) return pending.get(id);
    const run = async () => {
      const file = join(dirname(statePath), 'prd-review-choices', `${id}.json`);
      const resume = { tool: 'open_prd_review', arguments: sources };
      const later = status => ({
        status, prdPath: sources.prdPath, revision: document.revision, resume,
        instruction: status === 'deferred'
          ? '用户选择稍后评审或关闭了选择框。不要打开工作台、等待批注、确认文档或据此生成 Spec。向用户保留 PRD 文件链接，并说明在此任务回复“开始评审”即可继续；届时按 resume 参数调用 open_prd_review，不再询问。'
          : '当前客户端未取得有效选择。不要打开工作台或确认文档。请在原任务询问“PRD 已生成，是否现在开始评审？”，等待明确回答；开始则调用 resume，稍后则保留 PRD 文件链接和在此任务回复“开始评审”的入口。',
      });
      let decision, savedSessionId;
      try {
        const saved = JSON.parse(await readFile(file, 'utf8'));
        if (saved.identity === identity && ['start', 'later'].includes(saved.decision)) {
          decision = saved.decision;
          if (saved.sources === JSON.stringify(sources)) savedSessionId = saved.sessionId;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error(`无法读取评审选择记录：${error.message}`);
      }
      const save = async sessionId => {
        await mkdir(dirname(file), { recursive: true });
        const temp = `${file}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify({ schemaVersion: 1, identity, decision, sessionId, sources: JSON.stringify(sources) }), { mode: 0o600 });
        await rename(temp, file);
      };
      if (!decision) {
        let response;
        try {
          response = await elicit?.({
            message: `PRD 已生成：${document.title}（${document.version}）\n是否现在开始评审？\n可阅读正文、提交修改意见，评审后再确认当前版本。`,
            requestedSchema: {
              type: 'object',
              properties: { review: { type: 'string', title: '评审安排', enum: ['开始评审', '稍后评审'] } },
              required: ['review'],
            },
          }, context);
        } catch { return later('choice-required'); }
        if (['cancel', 'decline'].includes(response?.action)) decision = 'later';
        else if (response?.action === 'accept' && ['开始评审', '稍后评审'].includes(response.content?.review)) {
          decision = response.content.review === '开始评审' ? 'start' : 'later';
        } else return later('choice-required');
        const current = await readPrdDocument(sources.prdPath);
        if (current.document.revision !== document.revision) throw new Error('选择期间 PRD 已变化，请核对当前文档后重新发起评审选择');
        await save();
      }
      if (decision === 'later') return later('deferred');
      const opened = await open({ ...sources, ...(savedSessionId ? { resumeSessionId: savedSessionId } : {}) });
      await save(opened.sessionId);
      return { status: 'reviewing', ...opened };
    };
    const promise = run().finally(() => pending.delete(id));
    pending.set(id, promise);
    return promise;
  };
}
