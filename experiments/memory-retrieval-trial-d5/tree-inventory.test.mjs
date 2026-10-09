// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {TREE_DEFINITION,treeInventory,treeChanges} from './tree-inventory.mjs';

const definition=Object.freeze({...TREE_DEFINITION,files:['package.json'],folders:['src','node_modules/sdk'],skipped:['node_modules','.git','__pycache__']});
function tree(t){
  const app=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'viberoom-tree-')));t.after(()=>fs.rmSync(app,{recursive:true,force:true}));
  const put=(file,text)=>{fs.mkdirSync(path.dirname(path.join(app,file)),{recursive:true});fs.writeFileSync(path.join(app,file),text);};
  put('package.json','{}');put('src/a.ts','a');put('src/deep/b.ts','b');put('node_modules/sdk/index.js','sdk');
  put('src/__pycache__/x.pyc','cache');put('src/node_modules/y.js','nested');put('docs/readme.md','not in the tree');
  return {app,put};
}

test('the same files give the same digest; skipped folders and files outside the roots are not in it', async t=>{
  const {app}=tree(t),one=await treeInventory(app,{definition}),two=await treeInventory(app,{definition});
  assert.equal(one.sha256,two.sha256);
  assert.deepEqual(one.files.map(f=>f.path),['node_modules/sdk/index.js','package.json','src/a.ts','src/deep/b.ts']);
  assert.ok(Number.isInteger(one.ms)&&Number.isInteger(one.maxLoopDelayMs));
});

test('the definition is part of the digest: the same files under another definition give another digest', async t=>{
  const {app}=tree(t),one=await treeInventory(app,{definition}),other=await treeInventory(app,{definition:{...definition,order:'another rule'}});
  assert.deepEqual(other.files,one.files);assert.notEqual(other.sha256,one.sha256);
  assert.deepEqual(treeChanges(one,other),[{path:null,change:'definition'}]);
});

test('a changed, added and removed file show as such; a missing root file is recorded as absent', async t=>{
  const {app,put}=tree(t),before=await treeInventory(app,{definition});
  put('src/a.ts','A');put('src/c.ts','c');fs.rmSync(path.join(app,'src/deep/b.ts'));fs.rmSync(path.join(app,'package.json'));
  const after=await treeInventory(app,{definition});
  assert.deepEqual(treeChanges(before,after),[{path:'package.json',change:'removed'},{path:'src/a.ts',change:'changed'},
    {path:'src/deep/b.ts',change:'removed'},{path:'src/c.ts',change:'added'}]);
  assert.deepEqual(after.files.find(f=>f.path==='package.json'),{path:'package.json',bytes:null,sha256:null});
});

test("the application's own inventory covers its code, build and SDK and leaves its documents out", async ()=>{
  const app=fileURLToPath(new URL('../../',import.meta.url)),inventory=await treeInventory(app);
  const paths=new Set(inventory.files.map(f=>f.path));
  for(const file of ['package.json','src/hub.ts','private-trial/resident.mjs','experiments/trial-journal/journal.mjs','node_modules/@getzep/zep-cloud/package.json'])assert.ok(paths.has(file),file);
  assert.ok([...paths].every(f=>TREE_DEFINITION.files.includes(f)||TREE_DEFINITION.folders.some(root=>f.startsWith(root+'/'))));
  assert.ok([...paths].every(f=>!f.includes('/__pycache__/')));
});
