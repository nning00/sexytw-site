import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(process.env.GEO_TEST_DEPENDENCY_ROOT || root,'package.json'));
const ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const source=fs.readFileSync(path.join(root,'components/ArticleReferences.tsx'),'utf8');
const article=JSON.parse(fs.readFileSync(path.join(root,'scripts/fixtures/reviewed-privacy-article.json'),'utf8').replace(/^\uFEFF/,''));
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
assert.equal((output.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
function load(crypto=webcrypto){const module={exports:{}};vm.runInNewContext(output.outputText,{module,exports:module.exports,TextEncoder,crypto,require:(id)=>{assert.equal(id,'react');return React;}});return module.exports;}
const api=load();
test('reviewed offline draft renders three references',async()=>{assert(await api.matchesReviewedArticle(article));const html=renderToStaticMarkup(await api.default({article}));assert.equal((html.match(/<a /g)||[]).length,3);assert(html.includes('參考資料'));assert(!html.includes('target=')&&!html.includes('<script'));});
const mutations={body:a=>a.content[12].text+=' drift',title:a=>a.title+=' changed',slug:a=>a.slug='other',blockOrder:a=>a.content.reverse(),blockType:a=>a.content[0].type='heading',extraField:a=>a.content[0].html='<b>new</b>',deletedBlock:a=>a.content.pop(),missingBody:a=>delete a.content,wrongShape:a=>a.content='text',nullBlock:a=>a.content[0]=null,whitespace:a=>a.content[0].text=a.content[0].text.trim()};
for(const [name,mutate]of Object.entries(mutations))test('fail closed on '+name,async()=>{const a=structuredClone(article);mutate(a);assert.equal(await api.matchesReviewedArticle(a),false);assert.equal(await api.default({article:a}),null);});
test('object key reorder is stable',async()=>{const a=structuredClone(article);a.content=a.content.map(b=>({type:b.type,text:b.text}));assert(await api.matchesReviewedArticle(a));});
test('timestamp-only changes do not change actual content version',async()=>{const a=structuredClone(article);a.updated_at='2099-01-01';assert(await api.matchesReviewedArticle(a));});
test('missing crypto fails closed',async()=>assert.equal(await load(null).default({article}),null));
test('integration passes same article object after body before gallery',()=>{const p=fs.readFileSync(path.join(root,'app/articles/[slug]/page.tsx'),'utf8');assert.equal((p.match(/<ArticleReferences article=\{article\} \/>/g)||[]).length,1);assert(p.indexOf('<ArticleReferences')>p.indexOf('{chapters.map'));assert(p.indexOf('<ArticleReferences')<p.indexOf('{articleImages.length > 0'));});

test('previous published body remains hidden',async()=>{const old=JSON.parse(fs.readFileSync(path.join(root,'scripts/fixtures/previous-privacy-article.json'),'utf8'));assert.equal(await api.default({article:old}),null);});
