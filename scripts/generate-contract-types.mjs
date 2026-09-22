import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'ui/src/generated/contract-types.ts');
const schemaPaths = [
  resolve(root, 'schemas/product-spec-bundle.schema.json'),
  resolve(root, 'schemas/spec-map.schema.json'),
  resolve(root, 'schemas/prd-map.schema.json'),
  resolve(root, 'schemas/prd-review.schema.json'),
];

const compileOptions = {
  bannerComment: '',
  ignoreMinAndMaxItems: true,
  style: {
    bracketSpacing: true,
    printWidth: 100,
    semi: false,
    singleQuote: false,
    tabWidth: 2,
    trailingComma: 'all',
    useTabs: false,
  },
};

const generated = [];
for (const schemaPath of schemaPaths) {
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  generated.push(await compile(schema, schema.title, compileOptions));
}

const output = [
  '// This file is generated from schemas/*.schema.json.',
  '// Run `npm run generate:contracts` after changing a schema.',
  '',
  ...generated.map(source => source.trim()),
  '',
].join('\n');

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = await readFile(outputPath, 'utf8');
  } catch {
    // Missing generated output is reported by the same drift error below.
  }
  if (current !== output) {
    console.error('生成的前端契约已过期，请运行 npm run generate:contracts');
    process.exitCode = 1;
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, 'utf8');
  console.log(`已生成 ${outputPath}`);
}
