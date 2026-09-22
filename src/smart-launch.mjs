import { readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { validateSpecBundle, validateSpecMap } from './contracts.mjs';
import { checkLocalDevUrl, scanProjectDirectory } from './project-discovery.mjs';

const readValidBundle = async path => {
  try {
    const bundle = JSON.parse(await readFile(path, 'utf8'));
    const errors = validateSpecBundle(bundle);
    return errors.length ? { bundle: null, errors } : { bundle, errors: [] };
  } catch (error) {
    return { bundle: null, errors: [`Product Spec 无法读取：${error.message}`] };
  }
};

export async function enrichDiscoveryMaps(discovery, specPath = '') {
  if (!specPath) return discovery;
  const { bundle } = await readValidBundle(specPath);
  if (!bundle) return discovery;
  const map = await Promise.all(discovery.map.map(async candidate => {
    if (!candidate.valid) return candidate;
    try {
      const value = JSON.parse(await readFile(candidate.path, 'utf8'));
      const errors = validateSpecMap(value, bundle);
      return {
        ...candidate,
        valid: errors.length === 0,
        errors: errors.slice(0, 4),
      };
    } catch (error) {
      return {
        ...candidate,
        valid: false,
        errors: [`Spec map 无法读取：${error.message}`],
      };
    }
  }));
  return { ...discovery, map };
}

const assertHtml = async path => {
  const info = await stat(path);
  if (!info.isFile()) throw new Error('--html 指定的页面入口不是文件');
  if (!['.html', '.htm'].includes(extname(path).toLowerCase())) {
    throw new Error('--html 只支持 .html 或 .htm 文件');
  }
};

const noticeFor = ({ reason, discovery }) => {
  if (reason === 'missing-target') {
    return '当前目录没有找到 HTML。请选择其他项目、单个 HTML，或连接本地开发地址。';
  }
  if (reason === 'target-unreachable') {
    return `本地开发地址暂时无法访问：${discovery.devCheck?.error || '连接失败'}。请确认服务后重试。`;
  }
  if (reason === 'missing-spec') {
    return '页面来源已经确定，但没有唯一有效的 Product Spec。请选择已有 Spec、保存来源后交给 AI，或暂不处理。';
  }
  if (reason === 'stale-map') {
    return '已有映射与当前 Product Spec 不兼容。旧映射会保留，请确认创建新的工具侧映射。';
  }
  return '自动扫描发现多个候选或来源冲突。已经确定的来源已预填，只需处理仍有歧义的项目。';
};

export async function resolveSmartLaunch({
  projectPath = process.cwd(),
  htmlPath = '',
  devUrl = '',
  initialRoute = '',
  mode = 'map',
} = {}) {
  const root = resolve(projectPath);
  const rootInfo = await stat(root);
  if (!rootInfo.isDirectory()) throw new Error('项目路径不是目录');

  const explicitHtmlPath = htmlPath ? resolve(htmlPath) : '';
  if (explicitHtmlPath) await assertHtml(explicitHtmlPath);

  let discovery = await scanProjectDirectory(root);
  if (explicitHtmlPath && !discovery.html.some(item => item.path === explicitHtmlPath)) {
    discovery = {
      ...discovery,
      html: [{
        path: explicitHtmlPath,
        relativePath: explicitHtmlPath,
        score: Number.MAX_SAFE_INTEGER,
        valid: true,
        errors: [],
      }, ...discovery.html],
      recommended: { ...discovery.recommended, htmlPath: explicitHtmlPath },
    };
  }

  if (devUrl) throw new Error('开发地址接入已移除，请重新选择本地 HTML 页面包');
  const devCheck = devUrl ? await checkLocalDevUrl(devUrl) : null;
  if (devCheck) discovery = { ...discovery, devCheck };

  const targetIsExplicit = Boolean(explicitHtmlPath || devUrl);
  const selectedHtmlPath = explicitHtmlPath || (discovery.html.length === 1 ? discovery.html[0].path : '');
  const targetReady = devUrl ? Boolean(devCheck?.reachable) : Boolean(selectedHtmlPath);
  const targetAmbiguous = !targetIsExplicit && discovery.html.length > 1;
  const targetMissing = !devUrl && !selectedHtmlPath && discovery.html.length === 0;

  const selectedSpec = discovery.spec.length === 1 && discovery.spec[0].valid
    ? discovery.spec[0]
    : null;
  const selectedSourceSpec = discovery.specSource.length === 1 && discovery.specSource[0].valid
    ? discovery.specSource[0]
    : null;
  const specAmbiguous = discovery.spec.length > 1;
  const specMissing = !selectedSpec;
  discovery = await enrichDiscoveryMaps(discovery, selectedSpec?.path || '');

  const validMaps = discovery.map.filter(candidate => candidate.valid);
  const singleMap = validMaps.length === 1 ? validMaps[0] : null;
  const mapAmbiguous = validMaps.length > 1;
  const mapConflict = discovery.map.length > 0 && validMaps.length === 0;
  const mapPolicy = validMaps.length ? 'existing' : 'tool';
  const mapPath = singleMap?.path || '';

  const draft = {
    name: basename(root),
    projectPath: root,
    sourceType: devUrl ? 'dev' : explicitHtmlPath ? 'html' : 'directory',
    htmlPath: devUrl ? '' : selectedHtmlPath,
    devUrl: devCheck?.url || devUrl,
    specPath: selectedSpec?.path || '',
    sourceSpecPath: selectedSourceSpec?.path || '',
    mapPath: mapAmbiguous ? '' : mapPath,
    mapPolicy,
    mode: mode === 'review' ? 'review' : 'map',
    initialRoute,
    confirmMapCreate: false,
    confirmPrdMapCreate: false,
    confirmTargetWrite: false,
  };

  const mapMissing = discovery.map.length === 0;
  const direct = targetReady && !targetAmbiguous && !specMissing && !specAmbiguous && !mapMissing && !mapAmbiguous && !mapConflict;
  if (direct) {
    return { kind: 'direct', reason: 'ready', draft, discovery };
  }

  const reason = targetMissing
    ? 'missing-target'
    : devUrl && !targetReady
      ? 'target-unreachable'
      : specMissing && !specAmbiguous
        ? 'missing-spec'
        : targetAmbiguous || specAmbiguous || mapAmbiguous || mapConflict
          ? mapConflict
            ? 'stale-map'
            : 'ambiguous'
          : mapMissing
            ? 'missing-map'
            : 'ambiguous';
  const kind = reason === 'missing-target' ? 'project-center' : 'confirm';
  return {
    kind,
    reason,
    draft,
    discovery,
    bootstrap: {
      reason,
      step: reason === 'missing-target' ? 1 : 2,
      draft,
      discovery,
      notice: noticeFor({ reason, discovery }),
    },
  };
}
