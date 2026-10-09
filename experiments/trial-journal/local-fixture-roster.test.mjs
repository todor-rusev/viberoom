// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {canonical,hash} from './data.mjs';
import {RunJournal} from './journal.mjs';
import {createOwnedLocalFixture} from '../../private-trial/trial-journal/owned-local-fixture-core.mjs';
import {registerOwnedLocalFixture,recordOwnedLocalFixtureTerminal} from '../../private-trial/trial-journal/local-fixture-roster.mjs';
const expectations=[];
const policy={schema:'viberoom-trial-journal-policy-v1',identity:{purpose:'inert-roster-mechanics'},kinds:{read:1},
  limits:{localEstimatedCredits:0,maxRequestBytes:256,maxResponseBytes:256,maxAggregateBytes:256,runMs:1000}};
function evidence(t,status){
  let root=null;
  t.after(()=>{if(root){assert.equal(fs.realpathSync(root),root);assert.equal(dirname(root),fs.realpathSync(tmpdir()));}});
  root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'local-roster-control-')));const expected={root,status,fixtures:[],checks:[]};expectations.push(expected);return expected;
}
function fixture(t,e,{negative=false}={}){
  let hook=null;
  const f=createOwnedLocalFixture(negative?{after(fn){assert.equal(hook,null);hook=fn;}}:t,{family:'profile',evidenceRoot:e.root});
  t.after(async()=>{if(negative)await assert.rejects(hook());});
  e.fixtures.push(f);return f;
}
function read(path){const b=fs.readFileSync(path),v=JSON.parse(b);assert.equal(b.toString('utf8'),canonical(v)+'\n');return {b,v};}
function registration(e){const names=fs.readdirSync(e.root).filter(n=>n.startsWith('local-ledger-registration-'));assert.equal(names.length,1);return read(join(e.root,names[0])).v;}

test('RS01 two actual fixtures register before native work and publish both terminal pins without a supplied list',async t=>{
  const e=evidence(t,'complete'),a=fixture(t,e),b=fixture(t,e);RunJournal.prepare(a.ownerRoot,policy);RunJournal.prepare(b.ownerRoot,policy);
  assert.equal((await a.finalize()).status,'closed');assert.equal((await b.finalize()).status,'closed');
  e.checks.push(roster=>{assert.equal(roster.fixtures.length,2);assert.ok(roster.fixtures.every(r=>r.registrationPin&&r.terminalPin));});
});
test('RS02 failed registration CreateNew remains in the exact roster as unknown before any fixture constructor',t=>{
  const e=evidence(t,'unknown'),fixtureId='22222222-2222-4222-8222-222222222222';fs.writeFileSync(join(e.root,`local-ledger-registration-${fixtureId}.json`),'preexisting-owned-control\n',{flag:'wx'});
  assert.throws(()=>registerOwnedLocalFixture({fixtureId,family:'profile',evidenceRoot:e.root}));
  e.checks.push(roster=>{assert.equal(roster.fixtures.length,1);assert.equal(roster.fixtures[0].registrationPin,null);assert.equal(roster.fixtures[0].terminalPin,null);});
});
test('RS03 an actual registration without a returned terminal cannot disappear behind another complete fixture',async t=>{
  const e=evidence(t,'unknown');registerOwnedLocalFixture({fixtureId:'33333333-3333-4333-8333-333333333333',family:'profile',evidenceRoot:e.root});
  const f=fixture(t,e);RunJournal.prepare(f.ownerRoot,policy);assert.equal((await f.finalize()).status,'closed');
  e.checks.push(roster=>{assert.equal(roster.fixtures.length,2);assert.equal(roster.fixtures.filter(r=>r.terminalPin===null).length,1);assert.ok(roster.unknowns.some(r=>r.category==='terminal-missing'));});
});
test('RS04 intentionally unknown actual SQLite constructor keeps a pinned unknown terminal and unknown global roster',async t=>{
  const e=evidence(t,'unknown'),f=fixture(t,e,{negative:true});fs.mkdirSync(join(f.ownerRoot,'trial-journal.sqlite'));assert.throws(()=>RunJournal.inspect(f.ownerRoot));
  const terminal=await f.finalize();assert.equal(terminal.status,'unknown');assert.equal(fs.existsSync(f.root),true);
  e.checks.push(roster=>{assert.equal(roster.fixtures.length,1);assert.ok(roster.fixtures[0].terminalPin);assert.ok(roster.unknowns.some(r=>r.category==='fixture-terminal-unknown'));});
});
test('RS05 failed terminal CreateNew keeps first publication refusal despite known native/root cleanup',async t=>{
  const e=evidence(t,'unknown'),f=fixture(t,e,{negative:true});RunJournal.prepare(f.ownerRoot,policy);const reg=registration(e);
  fs.writeFileSync(join(e.root,`local-ledger-terminal-${reg.fixtureId}.json`),'preexisting-owned-terminal-control\n',{flag:'wx'});
  await assert.rejects(f.finalize());assert.equal(fs.existsSync(f.root),false);
  e.checks.push(roster=>{assert.equal(roster.fixtures.length,1);assert.equal(roster.fixtures[0].terminalPin,null);assert.ok(roster.unknowns.some(r=>r.category==='terminal-publication-unconfirmed'));});
});
test('RS06 late terminal byte drift cannot replace first successful publication or become roster completeness',async t=>{
  const e=evidence(t,'unknown'),f=fixture(t,e);RunJournal.prepare(f.ownerRoot,policy);const terminal=await f.finalize();assert.equal(terminal.status,'closed');
  const path=join(e.root,`local-ledger-terminal-${terminal.fixtureId}.json`);fs.writeFileSync(path,'changed-terminal-control\n');
  e.checks.push(roster=>{assert.ok(roster.fixtures[0].terminalPin);assert.ok(roster.unknowns.some(r=>r.category==='terminal-drift-unconfirmed'));});
});
test('RS07 original terminal pin mismatch consumes first attempt and cannot be retried as a fake complete record',t=>{
  const e=evidence(t,'unknown'),fixtureId='77777777-7777-4777-8777-777777777777';
  const token=registerOwnedLocalFixture({fixtureId,family:'profile',evidenceRoot:e.root});const path=join(e.root,`local-ledger-terminal-${fixtureId}.json`),b=Buffer.from('{}\n');fs.writeFileSync(path,b,{flag:'wx'});
  const wrong={path,bytes:b.length+1,sha256:hash(b)};assert.throws(()=>recordOwnedLocalFixtureTerminal(token,wrong));
  assert.throws(()=>recordOwnedLocalFixtureTerminal(token,{...wrong,bytes:b.length}),/not_replayed/);
  e.checks.push(roster=>{assert.equal(roster.fixtures[0].terminalPin,null);assert.ok(roster.unknowns.some(r=>r.category==='terminal-publication-unconfirmed'));});
});

after(()=>{
  for(const e of expectations){
    const path=join(e.root,`local-ledger-roster-${process.pid}.json`),{v:roster}=read(path);
    assert.deepEqual(Object.keys(roster).sort(),['schema','selector','nodeVersion','writer','evidenceRoot','rosterSourcePin','fixtures','traceComplete','status','unknowns'].sort());
    assert.equal(roster.schema,'resident-owned-local-fixture-roster-v1');assert.equal(roster.selector,'experiments/memory-retrieval-trial-d5/profile.test.mjs');
    assert.equal(roster.nodeVersion,process.version);assert.equal(roster.writer.processId,process.pid);assert.equal(roster.writer.parentProcessId,process.ppid);assert.equal(roster.evidenceRoot,e.root);
    const source=fs.readFileSync(roster.rosterSourcePin.path);assert.equal(hash(source),roster.rosterSourcePin.sha256);assert.equal(source.length,roster.rosterSourcePin.bytes);
    assert.equal(roster.status,e.status);assert.equal(roster.traceComplete,true);
    for(const check of e.checks)check(roster);
    if(e.status==='complete'){
      assert.equal(roster.unknowns.length,0);for(const row of roster.fixtures){
        for(const p of [row.registrationPin,row.terminalPin]){const b=fs.readFileSync(p.path);assert.equal(hash(b),p.sha256);assert.equal(b.length,p.bytes);}
        const registration=read(row.registrationPin.path).v,terminal=read(row.terminalPin.path).v;assert.equal(registration.fixtureId,row.fixtureId);assert.equal(terminal.fixtureId,row.fixtureId);
        assert.equal(registration.schema,'resident-owned-local-fixture-registration-v1');assert.equal(registration.evidenceRoot,e.root);assert.equal(terminal.status,'closed');
      }
      assert.ok(e.fixtures.every(f=>!fs.existsSync(f.root)));assert.equal(fs.realpathSync(e.root),e.root);assert.equal(dirname(e.root),fs.realpathSync(tmpdir()));fs.rmSync(e.root,{recursive:true,force:false});
    }else assert.ok(roster.unknowns.length>0);
  }
});
