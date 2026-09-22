import { createPrdReviewEntry } from './prd-review-entry.mjs';
import { resolve } from 'node:path';
import { startPrdReviewWorkbench } from './server.mjs';
import { PRD_WAIT_TIMEOUT_MS, resolvePrdReviewSources } from './prd-review-service.mjs';

const annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const tool = (name, description, properties, required) => ({
  name, description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations,
});
const sessionId = { type: 'string', description: 'open_prd_review 返回的会话 ID' };
export const prdReviewTools = [
  tool('request_prd_review', 'PRD 首次生成完成且用户未明确安排下一步时调用：在原任务询问开始评审或稍后评审，明确开始后才打开现有工作台。已有评审授权直接 open_prd_review；明确暂缓或直接生成 Spec 则遵从，不调用本工具。批注修订发布不重复询问。deferred 或 choice-required 不得等待批注或确认文档，按返回指令保留继续入口。', {
    projectPath: { type: 'string' }, prdPath: { type: 'string' }, htmlPath: { type: 'string', description: '已有用于对照的 HTML 时传入；没有则省略。' },
  }, ['projectPath', 'prdPath']),
  tool('open_prd_review', '仅在用户已明确要求开始评审或恢复原会话时，在 $product-documentation 已准备好可映射 PRD 后调用。打开现有工作台的完整 PRD 批注阅读；HTML 可选，不要求 Spec 或 Map；不得用 Stop 推测触发。返回地址后打开给用户并持续等待反馈。', {
    projectPath: { type: 'string' }, htmlPath: { type: 'string' }, prdPath: { type: 'string' },
    resumeSessionId: { type: 'string', description: '仅恢复原任务已知会话时传入；不要猜测其他任务会话。' },
  }, ['projectPath', 'prdPath']),
  tool('wait_prd_feedback', '等待并原子领取最早的 PRD 批次，直接返回当前原任务。submitted 表示已领取；同一会话只处理一批。默认由插件保持一次挂起调用，无反馈不返回。省略 timeoutMs；短超时仅供程序探测。pending 或客户端超时后结束本轮等待，不自动重试。不得用终端或定时查询替代挂起调用。修订步骤之间及写入前检查 get_prd_feedback_status；stop_requested 时停止后续工作并确认，不回滚。不得新建任务或修改 HTML/Spec。', {
    sessionId, timeoutMs: { type: 'number', minimum: 0, maximum: PRD_WAIT_TIMEOUT_MS, default: PRD_WAIT_TIMEOUT_MS },
  }, ['sessionId']),
  tool('publish_prd_revision', '原任务完成 PRD 修订和验证后发布新版供用户预览。返回 nextFeedback 时直接继续其中已领取的下一批；否则再次默认挂起等待。只读已绑定 PRD，不由工具写正文。revision 是验证后的源文件 SHA-256；summary 说明修改与未采纳意见。无变化须显式 unchanged 并说明原因。', {
    sessionId, batchId: { type: 'string' }, revision: { type: 'string' }, summary: { type: 'string' }, unchanged: { type: 'boolean' },
  }, ['sessionId', 'batchId', 'revision', 'summary']),
  tool('get_prd_feedback_status', '原任务在修订步骤之间、每次写入 PRD 前检查本批状态。只有 processing 可继续；stop_requested 必须停止后续修订，等待正在执行的写入停止，再调用 acknowledge_prd_stop。不是桌面原生中断，不能将请求视为已停止。', {
    sessionId, batchId: { type: 'string' },
  }, ['sessionId', 'batchId']),
  tool('acknowledge_prd_stop', '仅原任务已停止本批后续修订、确认没有仍在写入的命令时调用。说明已执行和未执行部分。不得回滚已写内容，不得将整个 Codex 任务的停止与本批合作停止混淆。随后再次等待反馈。', {
    sessionId, batchId: { type: 'string' }, summary: { type: 'string' },
  }, ['sessionId', 'batchId', 'summary']),
  tool('complete_prd_confirmation', '仅在用户已从工作台明确选择“确认当前版本”，且原任务已使用 $product-documentation 完成正式 PRD 确认或冻结后调用。工具只复核文档状态、来源和 revision，并关闭评审闭环；不得用结束评审、工具上报或文件 hash 变化替代用户确认。', {
    sessionId,
    sourceRevision: { type: 'string', description: 'confirmation_requested 返回的用户所确认源 revision。' },
    confirmedPrdPath: { type: 'string', description: '正式确认后 PRD 的绝对路径。' },
    revision: { type: 'string', description: '重新读取正式 PRD 后得到的 SHA-256 revision。' },
    summary: { type: 'string', description: '确认结果与冻结位置说明。' },
  }, ['sessionId', 'sourceRevision', 'confirmedPrdPath', 'revision', 'summary']),
];

export function createPrdReviewMcp({ statePath, elicit } = {}) {
  const sessions = new Map();
  const opening = new Map();
  const identities = new Map();
  const requestEntry = createPrdReviewEntry({ statePath, elicit, open: sources => api.call('open_prd_review', sources) });
  const api = {
    async call(name, input, context) {
      if (name === 'request_prd_review') return requestEntry(input, context);
      if (name === 'open_prd_review') {
        const sources = await resolvePrdReviewSources(input);
        const identity = JSON.stringify(sources);
        const key = JSON.stringify([input.projectPath, input.htmlPath, input.prdPath, input.resumeSessionId || '']);
        if (input.resumeSessionId && sessions.has(input.resumeSessionId)) {
          if (identities.get(input.resumeSessionId) !== identity) throw new Error('原会话与当前来源不匹配');
          opening.set(key, Promise.resolve(sessions.get(input.resumeSessionId)));
        }
        if (!opening.has(key)) {
          const pending = startPrdReviewWorkbench({ ...input, statePath, appRoot: resolve(import.meta.dirname, '..') }).then(workbench => {
            sessions.set(workbench.prdReview.sessionId, workbench);
            identities.set(workbench.prdReview.sessionId, identity);
            return workbench;
          }).catch(error => { opening.delete(key); throw error; });
          opening.set(key, pending);
        }
        const workbench = await opening.get(key);
        return { sessionId: workbench.prdReview.sessionId, url: workbench.url, instruction: '为用户打开此工作台地址。PRD 已完整呈现，可选中正文填写评论。直接调用 wait_prd_feedback 并省略 timeoutMs，插件内部等待事件；工具不可用或宿主超时则停止等待并告知用户，不用终端轮询代替。用户提交后使用 $product-documentation 修订，发布新版，再等待下一轮。不要把打开页面视为流程完成。' };
      }
      const workbench = sessions.get(input.sessionId);
      if (!workbench) throw new Error('当前 MCP 连接没有此会话；若为原任务恢复，请使用原 sessionId 及来源重新 open_prd_review');
      if (name === 'wait_prd_feedback') return await workbench.prdReview.wait(input.timeoutMs, { signal: context?.signal });
      if (name === 'get_prd_feedback_status') return await workbench.prdReview.feedbackStatus(input);
      if (name === 'acknowledge_prd_stop') {
        await workbench.prdReview.acknowledgeStop(input);
        return { sessionId: input.sessionId, batchId: input.batchId, status: 'stopped', instruction: '本批已确认停止，已写内容未回滚。继续 wait_prd_feedback；若磁盘有未发布修改，请先与用户核对。' };
      }
      if (name === 'publish_prd_revision') {
        const review = await workbench.prdReview.publish(input);
        const feedback = review.batches.some(batch => ['queued', 'processing', 'stop_requested'].includes(batch.status))
          ? await workbench.prdReview.wait(0, { signal: context?.signal }) : null;
        const nextFeedback = feedback && ['submitted', 'stop_requested'].includes(feedback.status) ? feedback : null;
        return { sessionId: input.sessionId, revision: review.revision, status: review.status, url: workbench.url,
          ...(nextFeedback ? { nextFeedback } : {}),
          instruction: nextFeedback
            ? '本批已发布，nextFeedback 是已领取的下一批反馈。按其中指令继续处理，不要结束本轮，也不要重复等待领取。发布不代表用户确认。'
            : '新版已在同一工作台发布，请调用 wait_prd_feedback 并省略 timeoutMs 等待下一轮。发布不代表用户确认。' };
      }
      if (name === 'complete_prd_confirmation') {
        const review = await workbench.prdReview.completeConfirmation(input);
        return { sessionId: input.sessionId, revision: review.revision, prdPath: review.confirmedPath, status: review.status, url: workbench.url, instruction: '正式 PRD 已通过状态与 revision 复核，工作台已显示“当前版本已确认”。' };
      }
      throw new Error(`未知 PRD 工具：${name}`);
    },
    async close() {
      await Promise.allSettled([...opening.values()]);
      await Promise.allSettled([...sessions.values()].map(async workbench => {
        workbench.prdReview.close();
        await workbench.stop();
      }));
    },
  };
  return api;
}
