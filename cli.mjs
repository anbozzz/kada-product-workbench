#!/usr/bin/env node
import { readFile, mkdir, open } from 'node:fs/promises';
import { listRuntimes } from './src/workbench-runtime.mjs';
import { defaultStatePath } from './src/project-store.mjs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveSpec, inspectSpecEdits } from './src/spec-derivation.mjs';
import { validateSpecBundle, validateSpecMap } from './src/contracts.mjs';
import { startGateStudio, startSmartStudio, startStudio, startWorkbench } from './src/server.mjs';

const appRoot = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const BOOLEAN_OPTIONS = new Set(['gate', 'json', 'no-open', 'preview']);

const parseOptions = values => {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith('--')) throw new Error(`无法识别的参数：${token}`);
    const key = token.slice(2);
    if (BOOLEAN_OPTIONS.has(key)) {
      result[key] = true;
      continue;
    }
    const value = values[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 --${key} 缺少值`);
    result[key] = value;
    index += 1;
  }
  return result;
};

const openInBrowser = url => {
  const command = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The URL is always printed as a fallback.
  }
};

const parseSmartOptions = values => {
  const result = { projectPath: '' };
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith('--')) {
      if (result.projectPath) throw new Error(`只能指定一个项目路径：${token}`);
      result.projectPath = token;
      continue;
    }
    const key = token.slice(2);
    if (!['html', 'url', 'route', 'port', 'host', 'state'].includes(key)) {
      throw new Error(`无法识别的参数：${token}`);
    }
    const value = values[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 --${key} 缺少值`);
    result[key] = value;
    index += 1;
  }
  return result;
};

const help = () => {
  process.stdout.write(`Interactive Product Spec\n\n` +
    `零配置启动（推荐）：\n` +
    `  node /实际插件目录/cli.mjs [项目路径] [--html <页面入口>] [--route '#screen']\n` +
    `  默认扫描当前目录；来源唯一时直达工作台，有歧义或缺失时才打开确认界面。\n\n` +
    `启动可视化项目中心：\n` +
    `  node cli.mjs start [--port 4317] [--host 127.0.0.1] [--state <工具侧配置路径>]\n\n` +
    `由 Codex 发起统一的来源确认与图形修订：\n` +
    `  node cli.mjs start --project <项目目录> --html <页面入口> --source-spec <原始Spec.md> --spec <临时视图.json> --map <spec-map.json> --gate --json\n\n` +
    `启动映射工作台：\n` +
    `  node cli.mjs map --html <页面入口> --spec <临时视图.json> --source-spec <原始Spec.md> --map <spec-map.json> [--route '#screen'] [--port 4317]\n\n` +
    `由 Codex 发起阻塞式修订：\n` +
    `  node cli.mjs map --html <页面入口> --spec <临时视图.json> --source-spec <原始Spec.md> --map <spec-map.json> --gate --json\n\n` +
    `启动只读查看：\n` +
    `  node cli.mjs review --html <页面入口> --spec <spec.bundle.json> --map <spec-map.json> [--route '#screen'] [--port 4317]\n\n` +
    `从明确来源派生 Spec：\n` +
    `  node cli.mjs derive-spec --project <目录> --prd <PRD.md> --architecture <架构.md> --output <Spec.md> [--preview] [--receipt <同步回执.json>]\n` +
    `读取待同步手改：\n` +
    `  node cli.mjs spec-changes --project <目录> --spec <Spec.md>\n\n` +
    `校验数据契约：\n` +
    `  node cli.mjs validate --spec <spec.bundle.json> [--map <spec-map.json>]\n`);
};

try {
  const command = args[0];
  if (command === 'help' || command === '--help' || command === '-h') {
    help();
  } else if (command === 'derive-spec' || command === 'spec-changes') {
    const options = parseOptions(args.slice(1));
    const common = { projectPath: options.project, specPath: options.spec || options.output, statePath: options.state };
    const result = command === 'spec-changes'
      ? await inspectSpecEdits(common)
      : await deriveSpec({ ...common, prdPath: options.prd, architecturePath: options.architecture, preview: options.preview, receipt: options.receipt ? JSON.parse(await readFile(options.receipt, 'utf8')) : undefined });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (command === 'open') {
    const options = parseOptions(args.slice(1));
    const statePath = resolve(options.state || defaultStatePath());
    const find = async () => (await listRuntimes(statePath)).find(instance => instance.kind === 'normal' && ['ready', 'waiting'].includes(instance.state) && !instance.closing);
    let instance = await find();
    if (!instance) {
      process.stdout.write('正在启动工作台并检查可用性…\n');
      await mkdir(dirname(statePath), { recursive: true });
      const logPath = resolve(dirname(statePath), 'workbench-start.log');
      const log = await open(logPath, 'a', 0o600);
      const child = spawn(process.execPath, [resolve(appRoot, 'cli.mjs'), 'start', '--state', statePath, '--port', options.port || '4317', '--host', '127.0.0.1', '--no-open'], { detached: true, stdio: ['ignore', log.fd, log.fd] });
      child.unref(); await log.close();
      for (let attempt = 0; attempt < 60 && !instance; attempt++) { await new Promise(resolveWait => setTimeout(resolveWait, 250)); instance = await find(); }
      if (!instance) throw new Error(`工作台未能启动，请查看 ${logPath}，或将该文件交给 Codex 排查`);
    }
    process.stdout.write(`${instance.state === 'ready' ? '工作台已就绪' : '项目中心已就绪，请选择项目'}：${instance.url}\n`);
    if (!options['no-open']) openInBrowser(instance.url);
  } else if (command === 'start' || command === 'studio') {
    const options = parseOptions(args.slice(1));
    if (options.json && !options.gate) throw new Error('--json 只与 --gate 一起使用');
    const common = {
      appRoot,
      managedLaunch: true,
      statePath: options.state,
      host: options.host || '127.0.0.1',
      port: Number(options.port || 4317),
    };
    if (options.gate) {
      const result = await startGateStudio({
        ...common,
        projectPath: options.project,
        htmlPath: options.html,
        devUrl: options.url,
        sourceSpecPath: options['source-spec'],
        specPath: options.spec,
        mapPath: options.map,
        initialRoute: options.route || '',
      });
      if (result.usedFallbackPort) {
        process.stderr.write(`默认端口已被其他项目占用，已为本次 Skill 会话启用独立地址：${result.url}\n`);
      }
      process.stderr.write(`Codex 正在等待来源确认与修订提交：${result.url}\n`);
      if (!options['no-open']) openInBrowser(result.url);
      const submission = await result.waitForDecision();
      await result.stop();
      process.stdout.write(options.json
        ? `${JSON.stringify(submission)}\n`
        : submission.cancelled ? '工作台已关闭，本次会话已取消\n' : `修订已提交：${submission.changes.length} 项 Spec 修改\n`);
    } else {
      const result = await startStudio({ ...common, fallbackToAvailablePort: true });
      process.stdout.write(`${result.reused ? '已复用可用工作台' : '项目中心已启动并通过检查'}：${result.url}\n`);
    }
  } else if (command === 'validate') {
    const options = parseOptions(args.slice(1));
    if (!options.spec) throw new Error('validate 需要 --spec');
    const bundle = JSON.parse(await readFile(resolve(options.spec), 'utf8'));
    const errors = validateSpecBundle(bundle);
    if (options.map) {
      const map = JSON.parse(await readFile(resolve(options.map), 'utf8'));
      errors.push(...validateSpecMap(map, bundle));
    }
    if (errors.length) throw new Error(errors.join('\n'));
    process.stdout.write('PASS：Spec bundle 与映射文件符合 v0.1 数据契约。\n');
  } else if (command === 'map' || command === 'review') {
    const options = parseOptions(args.slice(1));
    if (!options.html || !options.spec || !options.map) throw new Error(`${command} 需要 --html、--spec 和 --map`);
    if (options.gate && command !== 'map') throw new Error('--gate 只支持 map 模式');
    if (options.json && !options.gate) throw new Error('--json 只与 --gate 一起使用');
    const result = await startWorkbench({
      appRoot,
      managedLaunch: true,
      mode: command,
      fallbackToAvailablePort: true,
      htmlPath: options.html,
      specPath: options.spec,
      sourceSpecPath: options['source-spec'],
      projectPath: options.project,
      mapPath: options.map,
      initialRoute: options.route || '',
      host: options.host || '127.0.0.1',
      port: Number(options.port || 4317),
      gate: Boolean(options.gate),
    });
    if (options.gate) {
      process.stderr.write(`Codex 正在等待修订提交：${result.url}\n`);
      if (!options['no-open']) openInBrowser(result.url);
      const submission = await result.waitForDecision();
      await result.stop();
      process.stdout.write(options.json
        ? `${JSON.stringify(submission)}\n`
        : submission.cancelled ? '工作台已关闭，本次会话已取消\n' : `修订已提交：${submission.changes.length} 项 Spec 修改\n`);
    } else {
      process.stdout.write(`${command === 'map' ? '映射工作台' : '只读查看'}已启动：${result.url}\n`);
    }
  } else {
    const options = parseSmartOptions(args);
    const result = await startSmartStudio({
      appRoot,
      managedLaunch: true,
      projectPath: options.projectPath || process.cwd(),
      htmlPath: options.html,
      devUrl: options.url,
      initialRoute: options.route || '',
      statePath: options.state,
      host: options.host || '127.0.0.1',
      port: Number(options.port || 4317),
    });
    const label = result.launch.kind === 'direct'
      ? '已自动识别来源，映射工作台'
      : result.launch.kind === 'confirm'
        ? '发现需要确认的来源，确认界面'
        : '未找到 HTML，项目中心';
    if (result.usedFallbackPort) {
      process.stdout.write(`默认端口已被其他项目占用，已启用独立地址：${result.url}\n`);
    }
    process.stdout.write(`${result.reused ? '已复用已有工作台' : label + '已启动并通过检查'}：${result.url}\n`);
  }
} catch (error) {
  process.stderr.write(`ERROR：${error.message}\n`);
  process.exitCode = 1;
}
