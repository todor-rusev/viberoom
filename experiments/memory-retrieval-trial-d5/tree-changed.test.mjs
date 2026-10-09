// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configuredHubWorld} from './configured-hub-fixture.mjs';
import {createConfiguredNativeCaller} from './configured-native-caller.mjs';
import {createOwnedNativeTrialLifetime} from './owned-native-trial-lifetime.mjs';
import {RunJournal} from '../trial-journal/journal.mjs';
import {resultRefusal} from './profile.mjs';
import {launchPrivateTrial} from './private-launch.mjs';
import {TREE_DEFINITION,treeInventory,writeTreeInventory} from './tree-inventory.mjs';

function ownTree(t){
  const app=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'viberoom-tree-trial-')));t.after(()=>fs.rmSync(app,{recursive:true,force:true}));
  for(const file of TREE_DEFINITION.files)fs.writeFileSync(path.join(app,file),'{}');
  for(const folder of TREE_DEFINITION.folders){fs.mkdirSync(path.join(app,folder),{recursive:true});fs.writeFileSync(path.join(app,folder,'file.txt'),folder);}
  return app;
}
async function world(t){
  const loopback=await import('./loopback-inputs.mjs');
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'viberoom-tree-inputs-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const inputs=await loopback.prepareLoopbackInputs({workDir:path.join(dir,'input'),runId:'d-tree-changed',sieve:loopback.syntheticSieveVerdicts(loopback.loopbackProjection())});
  const app=ownTree(t),inventory=await treeInventory(app);
  inputs.prior.review.acceptedCETree=inventory.sha256;inputs.tree={file:writeTreeInventory(path.join(dir,'OWN-TREE.json'),inventory),app};
  const lifetime=createOwnedNativeTrialLifetime(t);
  const w=await configuredHubWorld(t,{inputs,approvalMs:3_600_000,nativeProject:true,isolated:true,readers:true,callerFactory:async w=>{
    w.caller=createConfiguredNativeCaller({hub:w.hub,selection:w.selection,source:w.source});w.prepared=w.caller.prepare(w.prepared);}});
  lifetime.attach(w);w.app=app;return w;
}
const saved=(w,name)=>{const row=RunJournal.inspect(w.ownerRoot).state.bindings.find(b=>b.name===name);return row?JSON.parse(row.value):null;};

test('a file changed after the ingestion began ends the trial held with tree_changed at the next check, nothing sent after it', async t=>{
  const w=await world(t);let sentAtCheck=null;
  const error=await w.launch({record:(kind,value)=>{
    w.events.push({kind,value});
    if(kind==='tree-check'&&value.phase==='claim')fs.writeFileSync(path.join(w.app,'src/file.txt'),'changed during the trial');
    if(kind==='tree-check'&&value.phase==='after-ingestion')sentAtCheck=w.HTTP.length;
  }}).then(()=>null,error=>error);
  assert.equal(error?.message,'tree_changed');
  assert.deepEqual(saved(w,'tree-changed'),{phase:'after-ingestion',changes:[{path:'src/file.txt',change:'changed'}],count:1});
  assert.equal(RunJournal.inspect(w.ownerRoot).state.run.stopped,'tree_changed');
  assert.ok(sentAtCheck>0,'the ingestion ran');assert.equal(w.HTTP.length,sentAtCheck,'nothing is sent after the check');
  assert.equal(w.HTTP.some(r=>r.kind==='model'),false,'the comparison never starts');
  assert.equal(resultRefusal(w.ownerRoot),'tree_changed','the result is refused, later too');
});

test('a tree changed before the launch ends the trial at its first check, before any request', async t=>{
  const w=await world(t);fs.rmSync(path.join(w.app,'dist/file.txt'));fs.writeFileSync(path.join(w.app,'dist/added.txt'),'new');
  const error=await w.launch().then(()=>null,error=>error);
  assert.equal(error?.message,'tree_changed');
  assert.deepEqual(saved(w,'tree-changed'),{phase:'claim',changes:[{path:'dist/file.txt',change:'removed'},{path:'dist/added.txt',change:'added'}],count:2});
  assert.equal(w.HTTP.length,0);assert.equal(resultRefusal(w.ownerRoot),'tree_changed');
});

test('a paid trial without an inventory does not launch', async ()=>{
  await assert.rejects(launchPrivateTrial({profile:{purpose:'approved-paid-trial'}}),/tree_inventory_required/);
});

test('a file changed after the boundary check is caught at the end: the comparison ran, its result is refused', async t=>{
  const w=await world(t);
  const error=await w.launch({record:(kind,value)=>{
    w.events.push({kind,value});
    if(kind==='tree-check'&&value.phase==='after-ingestion')fs.writeFileSync(path.join(w.app,'private-trial/file.txt'),'changed during the comparison');
  }}).then(()=>null,error=>error);
  assert.equal(error?.message,'tree_changed');
  assert.deepEqual(saved(w,'tree-changed'),{phase:'end',changes:[{path:'private-trial/file.txt',change:'changed'}],count:1});
  assert.ok(w.HTTP.some(r=>r.kind==='model'),'the comparison ran');assert.equal(resultRefusal(w.ownerRoot),'tree_changed');
});
