import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
for(const path of ['app/page.tsx','app/regions/[slug]/page.tsx','app/regions/[slug]/[city]/page.tsx','app/profiles/[id]/page.tsx','app/services/[slug]/page.tsx'])test('site header and region nav are outside the main/footer sticky boundary: '+path,()=>{
  const ast=ts.createSourceFile(path,readFileSync(new URL('../'+path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let mains=0,headers=0,navs=0;
  function visit(node,insideMain=false){
    const tag=ts.isJsxElement(node)?node.openingElement.tagName.getText(ast):ts.isJsxSelfClosingElement(node)?node.tagName.getText(ast):'';
    if(tag==='main')mains++;
    if(tag==='header'){headers++;assert.equal(insideMain,false,'Sticky header must share body with global footer');}
    if(tag==='RegionNav'){navs++;assert.equal(insideMain,false,'Both desktop navigation rows must stay reachable at footer');}
    ts.forEachChild(node,child=>visit(child,insideMain||tag==='main'));
  }
  visit(ast);assert.equal(mains,1);assert.equal(headers,1);assert.equal(navs,1);assert.equal(ast.parseDiagnostics.length,0);
});
