import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPrdImages, prdImageSources } from '../src/prd-images.mjs';
import { makeReadOnlyReviewConfig } from '../src/review-package.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const fixture = async source => {
  const root = await mkdtemp(join(tmpdir(), 'ips-prd-images-'));
  const project = join(root, 'project');
  await mkdir(join(project, 'docs'), { recursive: true });
  await mkdir(join(project, 'screens'), { recursive: true });
  const path = join(project, 'docs', '需求.md');
  await writeFile(path, source);
  return { root, project, document: { source, path } };
};

test('图片引用解析支持内联、标题、引用式、中文/空格，并忽略代码与普通链接', () => {
  const source = '![图一](../screens/a.png "说明")\n![图二][PIC]\n\n[pic]: <../screens/图 二.png>\n\n`![伪图](secret.png)`\n[普通链接](no.png)\n![图三](../screens/a.png "重复")';
  assert.deepEqual(prdImageSources(source), ['../screens/a.png', '../screens/图 二.png']);
});

test('图片按 PRD 目录解析但允许同项目相邻目录，快照不改写来源且可冻结到只读配置', async () => {
  const f = await fixture('![参考](../screens/%E6%97%B6%E9%97%B4%20%E8%BD%B4.png)');
  await writeFile(join(f.project, 'screens', '时间 轴.png'), png);
  const images = await loadPrdImages(f.document, f.project);
  const image = images['../screens/%E6%97%B6%E9%97%B4%20%E8%BD%B4.png'];
  assert.equal(image.src, `data:image/png;base64,${png.toString('base64')}`);
  assert.equal(await readFile(f.document.path, 'utf8'), f.document.source);
  const config = makeReadOnlyReviewConfig({
    productSpec: { product: {} }, specMap: { items: [] }, targetUrl: '/target/index.html',
    prd: { ...f.document, images }, capabilities: { savePrdMap: true },
  }, 'index.html', '2026-09-02T00:00:00Z');
  assert.equal(config.prd.images['../screens/%E6%97%B6%E9%97%B4%20%E8%BD%B4.png'].src, image.src);
  assert.equal(config.prd.path, '');
  assert.equal(config.canSavePrdMap, false);
});

test('图片拒绝路径越界、绝对/远程地址、符号链接逃逸、伪装文件及缺失文件', async () => {
  const sources = ['../../outside.png', '%2e%2e/%2e%2e/outside.png', '/etc/passwd', 'file:///etc/passwd', 'https://example.com/a.png', '../screens/link.png', '../screens/fake.png', '../screens/missing.png', '../screens/a.svg'];
  const f = await fixture(sources.map(src => `![图](${src})`).join('\n'));
  await writeFile(join(f.root, 'outside.png'), png);
  await symlink(join(f.root, 'outside.png'), join(f.project, 'screens', 'link.png'));
  await writeFile(join(f.project, 'screens', 'fake.png'), '<script>alert(1)</script>');
  await writeFile(join(f.project, 'screens', 'a.svg'), '<svg />');
  const images = await loadPrdImages(f.document, f.project);
  for (const source of sources) {
    assert.ok(images[source]?.error, source);
    assert.equal(images[source].src, undefined, source);
    assert.equal(images[source].error.includes(f.root), false, '错误不得带出本机完整路径');
  }
});

test('截图扩展名与实际位图类型不同时按字节签名显示，不修改原文件', async () => {
  const f = await fixture('![参考](../screens/reference.jpg)');
  const path = join(f.project, 'screens/reference.jpg');
  await writeFile(path, png);
  const images = await loadPrdImages(f.document, f.project);
  assert.equal(images['../screens/reference.jpg'].src, `data:image/png;base64,${png.toString('base64')}`);
  assert.deepEqual(await readFile(path), png);
});

test('图片限额逐图生效，不阻断有效图片；拒绝所选项目外的 PRD', async () => {
  const f = await fixture('![大图](../screens/large.png)\n![小图](../screens/small.png)');
  await writeFile(join(f.project, 'screens', 'large.png'), Buffer.alloc(8 * 1024 * 1024 + 1));
  await writeFile(join(f.project, 'screens', 'small.png'), png);
  const images = await loadPrdImages(f.document, f.project);
  assert.match(images['../screens/large.png'].error, /8 MiB/);
  assert.ok(images['../screens/small.png'].src);
  const outside = await loadPrdImages(f.document, join(f.project, 'screens'));
  assert.ok(Object.values(outside).every(image => image.error && !image.src));
});

test('图片总字节和数量上限生效，重复引用不会重复计费', async () => {
  const f = await fixture(Array.from({ length: 102 }, (_, index) => `![图](../screens/${index}.png)`).join('\n'));
  const bytes = Buffer.alloc(8 * 1024 * 1024);
  png.copy(bytes);
  for (let i = 0; i < 4; i++) await writeFile(join(f.project, 'screens', `${i}.png`), bytes);
  const images = await loadPrdImages(f.document, f.project);
  assert.ok(images['../screens/2.png'].src);
  assert.match(images['../screens/3.png'].error, /24 MiB/);
  assert.match(images['../screens/100.png'].error, /100 张/);
});
