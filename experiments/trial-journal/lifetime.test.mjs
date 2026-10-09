// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {RunJournal} from './journal.mjs';
import {canonical} from './data.mjs';

const policy={schema:'viberoom-trial-journal-policy-v1',identity:{purpose:'local-lifetime-control'},kinds:{read:2},limits:{localEstimatedCredits:0,maxRequestBytes:2048,maxResponseBytes:100,maxAggregateBytes:200,runMs:60000}};
const request={method:'GET',url:'http://127.0.0.1/owned',body:null,maxRetries:0};
function world(t){
  const root=mkdtempSync(join(tmpdir(),'viberoom-owner-lifetime-'));const card=RunJournal.prepare(root,policy);
  const approval={id:'synthetic-local-only',cardSha256:card.cardSha256,expiresAt:new Date(Date.now()+60000).toISOString()};
  const owner=RunJournal.claim(root,{approval,verifyApproval:()=>true,current:()=>true,validateRequest:()=>true});
  t.after(()=>{owner.close();assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir())+sep+'viberoom-owner-lifetime-'));rmSync(root,{recursive:true,force:true});});
  for(const id of ['read:1','read:2'])owner.permit({id,kind:'read',request,estimate:0});
  return {root,owner,approval};
}
function refuseStop(root){const db=new DatabaseSync(join(root,'trial-journal.sqlite'));db.exec("create trigger stop_refusal before update of stopped on run when new.stopped='comparison_finished_no_resume' begin update permits set consumed=1 where id='read:2'; end;");db.close();}
function failedStop(owner){assert.throws(()=>owner.stop('comparison_finished_no_resume'),/unexpected_trial_sql_delta/);}
const capture={status:200,raw:'{}',latencyMs:1,known:true};

test('failed stop revokes direct admissions, permit registration and bindings despite durable rollback',t=>{
  const {root,owner,approval}=world(t);refuseStop(root);const before=canonical(owner.summary().state);failedStop(owner);
  assert.equal(canonical(owner.summary().state),before);assert.equal(owner.summary().state.run.stopped,null);
  assert.throws(()=>owner.admit('read:1',request),/trial_stopped/);
  assert.throws(()=>owner.permit({id:'read:3',kind:'read',request,estimate:0}),/trial_stopped/);
  assert.throws(()=>owner.save('new-binding',{uuid:'synthetic'}),/trial_stopped/);
  assert.equal(canonical(owner.summary().state),before);
  assert.throws(()=>RunJournal.claim(root,{approval,verifyApproval:()=>true,current:()=>true,validateRequest:()=>true}),/trial_already_claimed/);
});

test('failed stop permits late unknown diagnostics without releasing consumption or reopening lifetime',t=>{
  const {root,owner}=world(t);const handle=owner.admit('read:1',request);refuseStop(root);failedStop(owner);
  assert.equal(owner.outcome(handle,capture),false);
  const stored=RunJournal.inspect(root).state;assert.equal(stored.attempts[0].outcome,'unknown');assert.equal(stored.permits[0].consumed,1);
  assert.equal(JSON.parse(stored.attempts[0].capture).raw,'{}');assert.throws(()=>owner.admit('read:2',request),/trial_stopped/);
});

test('successful stop closes admissions while summary and late diagnostic capture stay available',t=>{
  const {owner}=world(t);const handle=owner.admit('read:1',request);assert.equal(owner.stop('explicit-stop'),true);
  assert.throws(()=>owner.admit('read:2',request),/trial_stopped/);assert.equal(owner.outcome(handle,capture),false);
  assert.equal(owner.summary().state.attempts[0].outcome,'unknown');
});

test('positive active owner still admits and captures separate requests before terminal stop',t=>{
  const {owner}=world(t);for(const id of ['read:1','read:2'])assert.equal(owner.outcome(owner.admit(id,request),capture),true);
  assert.equal(owner.summary().state.attempts.length,2);assert.equal(owner.stop('complete'),true);
});
