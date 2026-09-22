import test from 'node:test';
import assert from 'node:assert/strict';
import {readMarkdownBundle} from '../src/markdown-spec-reader.mjs';
import {updateMarkdownSpecNode} from '../src/markdown-spec-editor.mjs';
const previous={product:{id:'TEST',title:'测试',version:'v1',status:'draft'},modules:[]};
const source='# 测试\n\n## MODULE `GROUP`：群\n\n#### ACTION `INVITE`：邀请\n\n- 状态：`draft`\n- 来源：`product-decision`\n- 关联 PRD：`需求-邀请`\n\n##### 正常流程与结果\n\n1. 选择。\n2. 提交。\n\n##### 依赖失败与超时\n\n###### 部分失败\n\n保留成功者。\n\n| 项目 | 结果 |\n|---|---|\n| 甲 | 成功 |\n\n```text\n##### 不是字段\n```\n\n## 工程\n\n保留工程。\n';
test('标题成为完整字段，六级分支、表格和代码保留在字段正文内',()=>{
 const {bundle}=readMarkdownBundle(source,previous);const n=bundle.modules[0].nodes[0];
 assert.deepEqual(n.contentBlocks.map(b=>b.label),['状态','来源','关联 PRD','正常流程与结果','依赖失败与超时']);
 assert.equal(n.contentBlocks[3].content,'1. 选择。\n2. 提交。');
 assert.match(n.contentBlocks[4].content,/###### 部分失败/);assert.match(n.contentBlocks[4].content,/##### 不是字段/);
 assert.deepEqual(n.prdSectionIds,['需求-邀请']);
});
test('标题字段编辑后重读仍保留字段结构、分支与工程章节',()=>{
 const {bundle}=readMarkdownBundle(source,previous);const before=bundle.modules[0].nodes[0];
 const after=structuredClone(before);after.contentBlocks.find(b=>b.label==='正常流程与结果').content='1. 选择人员。\n2. 确认邀请。';
 const updated=updateMarkdownSpecNode(source,before,after);
 assert.match(updated,/##### 正常流程与结果\n\n1\. 选择人员。/);assert.ok(updated.endsWith('## 工程\n\n保留工程。\n'));
 const reread=readMarkdownBundle(updated,bundle).bundle.modules[0].nodes[0];
 assert.deepEqual(reread.contentBlocks,after.contentBlocks);
});
test('字段改名仍使用标题；后加定位提示重读不落入正文',()=>{
 const {bundle}=readMarkdownBundle(source,previous);const before=bundle.modules[0].nodes[0];const after=structuredClone(before);
 after.anchorHints=['添加'];after.contentBlocks.find(b=>b.label==='正常流程与结果').label='展示与交互';
 const updated=updateMarkdownSpecNode(source,before,after);assert.match(updated,/##### 展示与交互/);
 const n=readMarkdownBundle(updated,bundle).bundle.modules[0].nodes[0];assert.deepEqual(n.anchorHints,['添加']);
 assert.ok(n.contentBlocks.some(b=>b.label==='展示与交互'));assert.ok(!n.contentBlocks.find(b=>b.label==='依赖失败与超时').content.includes('页面匹配提示'));
});
