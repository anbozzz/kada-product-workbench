import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const DESKTOP_CODEX_BINARY = '/Applications/ChatGPT.app/Contents/Resources/codex';

const rpcError = value => {
  const error = new Error(value?.message || 'Codex App Server 请求失败');
  if (value?.code !== undefined) error.code = value.code;
  return error;
};

const abortError = () => {
  const error = new Error('Codex 任务已取消');
  error.name = 'AbortError';
  return error;
};

const resolveCodexBinary = async preferred => {
  if (preferred) return preferred;
  if (process.env.CODEX_BINARY_PATH) return process.env.CODEX_BINARY_PATH;
  if (process.platform === 'darwin') {
    try {
      await access(DESKTOP_CODEX_BINARY);
      return DESKTOP_CODEX_BINARY;
    } catch {
      // 非 ChatGPT.app 安装环境继续使用 PATH 中的 codex。
    }
  }
  return 'codex';
};

export class CodexAppServerClient {
  constructor({ codexPath = '', requestTimeoutMs = 30_000 } = {}) {
    this.codexPath = codexPath;
    this.requestTimeoutMs = requestTimeoutMs;
    this.child = null;
    this.lines = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.completedTurns = new Map();
    this.turnWaiters = new Map();
    this.stderr = '';
    this.closing = false;
  }

  async start() {
    if (this.child) return;
    const binary = await resolveCodexBinary(this.codexPath);
    const child = spawn(binary, ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    this.child = child;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      this.stderr = `${this.stderr}${chunk}`.slice(-12_000);
    });
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on('line', line => this.#handleLine(line));
    child.once('error', error => this.#failAll(error));
    child.once('exit', code => {
      if (this.closing) return;
      const detail = this.stderr.trim();
      this.#failAll(new Error(
        detail || `Codex App Server 已退出（exit ${code ?? 'unknown'}）`,
      ));
    });

    await this.request('initialize', {
      clientInfo: {
        name: 'interactive-product-spec',
        title: 'Interactive Product Spec',
        version: '0.1.0',
      },
      capabilities: null,
    });
    this.notify('initialized', {});
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && (message.result !== undefined || message.error)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(rpcError(message.error));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === 'turn/completed') {
      const key = `${message.params?.threadId || ''}:${message.params?.turn?.id || ''}`;
      const waiter = this.turnWaiters.get(key);
      if (waiter) {
        this.turnWaiters.delete(key);
        waiter.cleanup();
        waiter.resolve(message.params.turn);
      } else {
        this.completedTurns.set(key, message.params?.turn);
      }
      return;
    }
    if (message.id !== undefined && message.method) {
      this.#write({
        id: message.id,
        error: { code: -32601, message: `Unsupported server request: ${message.method}` },
      });
    }
  }

  #write(message) {
    if (!this.child?.stdin.writable) throw new Error('Codex App Server 尚未启动');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params) {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server 请求超时：${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.#write({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params) {
    this.#write({ method, params });
  }

  waitForTurn(threadId, turnId, signal) {
    const key = `${threadId}:${turnId}`;
    if (this.completedTurns.has(key)) {
      const turn = this.completedTurns.get(key);
      this.completedTurns.delete(key);
      return Promise.resolve(turn);
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.turnWaiters.delete(key);
        void this.request('turn/interrupt', { threadId, turnId }).catch(() => {});
        reject(abortError());
      };
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      this.turnWaiters.set(key, { resolve, reject, cleanup });
    });
  }

  #failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.turnWaiters.values()) {
      waiter.cleanup();
      waiter.reject(error);
    }
    this.turnWaiters.clear();
  }

  close() {
    if (!this.child) return;
    this.closing = true;
    this.lines?.close();
    this.child.kill('SIGTERM');
    this.child = null;
  }
}

export async function startVisibleCodexThread(client, {
  title,
  cwd,
  model = '',
  approvalPolicy = 'never',
  sandbox,
}) {
  const started = await client.request('thread/start', {
    model: model || null,
    cwd,
    approvalPolicy,
    sandbox,
    serviceName: 'interactive_product_spec',
    ephemeral: false,
    // 这是用户在工作台中明确发起的独立任务。使用桌面端的用户任务来源，
    // 避免被归为仅供集成客户端消费的 appServer 后台线程。
    threadSource: 'user',
  });
  const threadId = started.thread.id;
  await client.request('thread/name/set', { threadId, name: title });
  return { ...started, threadId };
}

const publicModel = model => ({
  id: model.id,
  displayName: model.displayName,
  description: model.description,
  supportedReasoningEfforts: (model.supportedReasoningEfforts || []).map(option => ({
    id: option.reasoningEffort,
    description: option.description,
  })),
  defaultReasoningEffort: model.defaultReasoningEffort,
  isDefault: Boolean(model.isDefault),
});

export async function listCodexModels({ codexPath = '', clientFactory } = {}) {
  const client = clientFactory
    ? await clientFactory()
    : new CodexAppServerClient({ codexPath });
  try {
    await client.start();
    const response = await client.request('model/list', {
      limit: 100,
      includeHidden: false,
    });
    return (response.data || []).filter(model => !model.hidden).map(publicModel);
  } finally {
    client.close();
  }
}
