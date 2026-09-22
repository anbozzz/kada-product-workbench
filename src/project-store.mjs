import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const emptyState = () => ({
  schemaVersion: 1,
  lastProjectId: null,
  projects: [],
});

export const defaultStatePath = () => {
  if (process.env.IPS_HOME) return resolve(process.env.IPS_HOME, 'projects.json');
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Interactive Product Spec', 'projects.json');
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, 'Interactive Product Spec', 'projects.json');
  }
  return join(homedir(), '.interactive-product-spec', 'projects.json');
};

export const projectIdFor = project => {
  const identity = [
    resolve(project.projectPath || '.'),
    project.sourceType || 'directory',
    project.htmlPath || project.devUrl || '',
  ].join('\n');
  return `project-${createHash('sha256').update(identity).digest('hex').slice(0, 14)}`;
};

export async function loadProjectState(statePath) {
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8'));
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.projects)) {
      return { ...emptyState(), warning: '最近项目记录格式不受支持，已忽略。' };
    }
    return {
      schemaVersion: 1,
      lastProjectId: typeof parsed.lastProjectId === 'string' ? parsed.lastProjectId : null,
      projects: parsed.projects.filter(project => project && typeof project === 'object'),
    };
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    return { ...emptyState(), warning: `最近项目记录无法读取：${error.message}` };
  }
}

export async function saveProjectState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, statePath);
}

export async function rememberProject(statePath, project, { opened = false } = {}) {
  const state = await loadProjectState(statePath);
  const id = project.id || projectIdFor(project);
  const now = new Date().toISOString();
  const nextProject = {
    ...project,
    id,
    updatedAt: now,
    ...(opened ? { lastOpenedAt: now } : {}),
  };
  const previous = state.projects.find(item => item.id === id);
  if (previous?.lastOpenedAt && !nextProject.lastOpenedAt) {
    nextProject.lastOpenedAt = previous.lastOpenedAt;
  }
  const projects = [
    nextProject,
    ...state.projects.filter(item => item.id !== id),
  ].slice(0, 20);
  const nextState = {
    schemaVersion: 1,
    lastProjectId: id,
    projects,
  };
  await saveProjectState(statePath, nextState);
  return { state: nextState, project: nextProject };
}

const ownedToolMapsFor = async (statePath, project) => {
  if (project.mapPolicy !== 'tool' || !project.id) return [];
  const mapsRoot = join(dirname(statePath), 'maps');
  try {
    const entries = await readdir(mapsRoot, { withFileTypes: true });
    return entries
      .filter(entry =>
        entry.isFile() &&
        entry.name.startsWith(`${project.id}.`) &&
        entry.name.endsWith('.spec-map.json'))
      .map(entry => join(mapsRoot, entry.name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};

export async function previewRecentProjectRemoval(statePath, projectId) {
  const state = await loadProjectState(statePath);
  const project = state.projects.find(item => item.id === projectId);
  if (!project) throw new Error('最近项目不存在或已被移除');
  const toolMapPaths = await ownedToolMapsFor(statePath, project);
  let mappingCount = 0;
  for (const mapPath of toolMapPaths) {
    try {
      const map = JSON.parse(await readFile(mapPath, 'utf8'));
      mappingCount += Array.isArray(map.items) ? map.items.length : 0;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return {
    project,
    deleteToolMaps: toolMapPaths.length > 0,
    mappingFileCount: toolMapPaths.length,
    mappingCount,
  };
}

export async function removeRecentProject(statePath, projectId, { confirmed = false } = {}) {
  if (!confirmed) throw new Error('移除最近项目并删除工具侧映射前需要二次确认');
  const preview = await previewRecentProjectRemoval(statePath, projectId);
  const state = await loadProjectState(statePath);
  const toolMapPaths = await ownedToolMapsFor(statePath, preview.project);
  for (const mapPath of toolMapPaths) {
    try {
      await unlink(mapPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const projects = state.projects.filter(item => item.id !== projectId);
  const nextState = {
    schemaVersion: 1,
    lastProjectId: state.lastProjectId === projectId
      ? projects[0]?.id || null
      : state.lastProjectId,
    projects,
  };
  await saveProjectState(statePath, nextState);
  return {
    ...preview,
    state: nextState,
    nextLastProject: projects.find(project => project.id === nextState.lastProjectId) || null,
  };
}

export const toolMapPathFor = (statePath, projectId, productSpecId = '') => {
  const variant = productSpecId
    ? `.${createHash('sha256').update(productSpecId).digest('hex').slice(0, 10)}`
    : '';
  return join(dirname(statePath), 'maps', `${projectId}${variant}.spec-map.json`);
};
