import { createRequire } from 'node:module';
import Ajv2020 from 'ajv/dist/2020.js';

const require = createRequire(import.meta.url);
const productSpecSchema = require('../schemas/product-spec-bundle.schema.json');
const specMapSchema = require('../schemas/spec-map.schema.json');
const prdMapSchema = require('../schemas/prd-map.schema.json');
const prdReviewSchema = require('../schemas/prd-review.schema.json');

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  verbose: true,
});

const productSpecValidator = ajv.compile(productSpecSchema);
const specMapValidator = ajv.compile(specMapSchema);
const prdMapValidator = ajv.compile(prdMapSchema);
const prdReviewValidator = ajv.compile(prdReviewSchema);

const pathFor = (root, pointer = '') => {
  const segments = pointer.split('/').slice(1).map(segment =>
    segment.replaceAll('~1', '/').replaceAll('~0', '~'));
  return segments.reduce((path, segment) =>
    /^\d+$/.test(segment) ? `${path}[${segment}]` : `${path}.${segment}`, root);
};

const messageFor = (error, root) => {
  const path = pathFor(root, error.instancePath);
  if (error.keyword === 'required') {
    return `${path}.${error.params.missingProperty} 是必填项`;
  }
  if (error.keyword === 'minLength') return `${path} 必须是非空字符串`;
  if (error.keyword === 'type') return `${path} 必须是${error.params.type}`;
  if (error.keyword === 'enum') return `${path} 不受支持：${String(error.data ?? '')}`;
  if (error.keyword === 'const') return `${path} 必须是 ${JSON.stringify(error.params.allowedValue)}`;
  if (error.keyword === 'pattern') return `${path} 格式无效`;
  if (error.keyword === 'minItems') return `${path} 必须是非空数组`;
  if (error.keyword === 'not') return `${path} 不能同时包含互斥字段`;
  if (error.keyword === 'additionalProperties') {
    return `${path}.${error.params.additionalProperty} 不受支持`;
  }
  return `${path} ${error.message || '不符合数据契约'}`;
};

const validateWith = (validator, value, root) => {
  if (validator(value)) return [];
  return [...new Set((validator.errors || []).map(error => messageFor(error, root)))];
};

export const validateProductSpecStructure = value =>
  validateWith(productSpecValidator, value, 'bundle');

export const validateSpecMapStructure = value =>
  validateWith(specMapValidator, value, 'map');

export const validatePrdMapStructure = value =>
  validateWith(prdMapValidator, value, 'prdMap');

export const validatePrdReviewStructure = value =>
  validateWith(prdReviewValidator, value, 'prdReview');

export const contractSchemas = {
  productSpec: productSpecSchema,
  specMap: specMapSchema,
  prdMap: prdMapSchema,
};
