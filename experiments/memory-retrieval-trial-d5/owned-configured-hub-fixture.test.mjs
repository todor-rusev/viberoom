// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Logger} from '../../dist/log.js';
import {slowIoWords} from '../../dist/slow-io.js';
import {createOwnedConfiguredHubFixture,observeFixtureLogger} from './owned-configured-hub-fixture.mjs';

async function acquire(t,options={}){
  const owned=createOwnedConfiguredHubFixture(t,options),root=owned.allocateRoot();owned.createTrialDirectory();
  const server=owned.constructServer();await owned.startServer();const hub=owned.constructHub();
  return {owned,root,server,hub};
}
const refused=report=>{assert.equal(report.status,'refused');assert.equal(report.directoryRemoved,false);};

test('HC01 actual Hub final history and owned Server close event precede successful temp-root removal',async t=>{
  const {owned,root,server,hub}=await acquire(t);let actualServerEvent=false;
  server.server.once('close',()=>{actualServerEvent=true;});
  const result=await owned.cleanup();assert.equal(result.status,'closed');assert.equal(result.server.closed,true);
  assert.equal(actualServerEvent,true);assert.equal(hub.history.db.isOpen,false,'read-only genuine TimedDatabase observation');
  assert.equal(result.hubs[0].stages.at(-1).stage,'history');assert.ok(result.hubs[0].stages.every(s=>s.timedOut===false));
  assert.equal(result.hubs[0].closed,true);assert.deepEqual(result.categories,[]);assert.equal(fs.existsSync(root),false);
});

test('HC02 failed real Hub constructor stays unknown while the independently returned Server closes and diagnostics stay',async t=>{
  const owned=createOwnedConfiguredHubFixture(t,{onCleanup:refused}),root=owned.allocateRoot();owned.createTrialDirectory();
  const server=owned.constructServer();await owned.startServer();let actualServerEvent=false;
  server.server.once('close',()=>{actualServerEvent=true;});
  fs.writeFileSync(path.join(root,'hub'),'synthetic constructor path blocker',{flag:'wx'});
  assert.throws(()=>owned.constructHub());
  const result=await owned.cleanup();refused(result);assert.ok(result.categories.includes('hub-acquisition-incomplete'));
  assert.equal(result.hubs[0].constructorAttempted,true);assert.equal(result.hubs[0].constructorReturned,false);
  assert.equal(result.hubs[0].shutdownAttempts,0);assert.equal(result.server.closed,true);assert.equal(actualServerEvent,true);
  assert.equal(fs.existsSync(root),true,'retained diagnostics; not repaired or deleted');
});

test('HC03 checked public reopen acquires a new actual Hub after old closure; repeated close returns the same first attempt',async t=>{
  const {owned,root,hub}=await acquire(t),first=owned.closeHub(hub),same=owned.closeHub(hub);
  assert.equal(first,same);const closed=await first;assert.equal(closed.closed,true);assert.equal(hub.history.db.isOpen,false);
  const reopened=await owned.reopenHub(hub);assert.notEqual(reopened,hub);assert.equal(reopened.history.db.isOpen,true);
  const snapshot=owned.snapshot(),oldHistory=snapshot.records.find(r=>r.event==='shutdown-stage'&&r.hub===1&&r.stage==='history'),newHandle=snapshot.records.find(r=>r.event==='hub-returned'&&r.hub===2);
  assert.ok(oldHistory&&newHandle&&oldHistory.sequence<newHandle.sequence);
  const result=await owned.cleanup();assert.equal(result.status,'closed');assert.deepEqual(result.hubs.map(h=>h.shutdownAttempts),[1,1]);
  assert.ok(result.hubs.every(h=>h.closed));assert.equal(reopened.history.db.isOpen,false);assert.equal(fs.existsSync(root),false);
});

test('DC01 actual Logger child-tree policy retains only fixed categories; synthetic warning is not a database fault',()=>{
  const categories=[],marker='SYNTHETIC_PRIVATE_ERROR_MARKER';let closing=false;
  const log=observeFixtureLogger(new Logger('fixture-policy-control'),category=>categories.push(category),()=>closing),child=log.child('child'),grandchild=child.child('grandchild');
  assert.notEqual(child,log);assert.notEqual(grandchild,child);
  grandchild.warn('history.db did not close cleanly: '+marker);closing=true;child.warn(marker);grandchild.error(marker);
  assert.deepEqual(categories,['history-close-warning','shutdown-warning','shutdown-error']);assert.equal(JSON.stringify(categories).includes(marker),false);
});

test('DC02 a slow file step while closing is recorded as what it is, a measure of the disk, and refuses nothing',()=>{
  const categories=[];let closing=true;
  const log=observeFixtureLogger(new Logger('fixture-slow-io'),category=>categories.push(category),()=>closing);
  log.warn(slowIoWords({step:'rename',path:'rooms.json',ms:402,held:true}));log.child('c').warn(slowIoWords({step:'write',path:'a.sqlite',ms:2500,held:false}));
  log.warn('a file step held the hubbub');closing=false;log.warn(slowIoWords({step:'read',path:'b',ms:300,held:true}));
  assert.deepEqual(categories,['slow-io-observation','slow-io-observation','shutdown-warning','slow-io-observation']);
});

test('HC04 sticky logger policy refusal blocks reopen and prevents replay although independent genuine closures finish',async t=>{
  const {owned,root,hub}=await acquire(t,{onCleanup:refused});
  owned.loggerFor(hub).child('fixture-policy-control').warn('history.db did not close cleanly: synthetic policy observation');
  const first=owned.closeHub(hub);assert.equal(first,owned.closeHub(hub));const report=await first;assert.equal(report.closed,false);
  await assert.rejects(owned.reopenHub(hub),/fixture_hub_reopen_refused/);
  const result=await owned.cleanup();refused(result);assert.equal(result.hubs.length,1);assert.equal(result.hubs[0].shutdownAttempts,1);
  assert.equal(hub.history.db.isOpen,false);assert.equal(result.server.closed,true);assert.ok(result.categories.includes('history-close-warning'));assert.equal(fs.existsSync(root),true);
});

test('HC05 bounded trace truncation keeps diagnostics and still attempts every genuine returned resource close',async t=>{
  const {owned,root,hub}=await acquire(t,{maximumRecords:1,onCleanup:refused}),result=await owned.cleanup();refused(result);
  assert.equal(result.recordCount,1);assert.ok(result.dropped>0);assert.equal(result.truncated,true);assert.ok(result.categories.includes('trace-truncated'));
  assert.equal(result.hubs[0].shutdownAttempts,1);assert.equal(hub.history.db.isOpen,false);assert.equal(result.server.closed,true);assert.equal(fs.existsSync(root),true);
});

test('HC06 evidence-write refusal follows both actual closures and cannot discard diagnostics or replay shutdown',async t=>{
  let writes=0;
  const {owned,root,hub}=await acquire(t,{onCleanup:refused,writeEvidence:report=>{
    writes++;assert.equal(report.server.closed,true);assert.ok(report.hubs.every(h=>h.closed));throw Error('synthetic evidence write refusal');
  }});
  const first=owned.cleanup();assert.equal(first,owned.cleanup());const result=await first;refused(result);
  assert.equal(writes,1);assert.ok(result.categories.includes('evidence-write-refused'));assert.equal(result.hubs[0].shutdownAttempts,1);
  assert.equal(hub.history.db.isOpen,false);assert.equal(result.server.closed,true);assert.equal(fs.existsSync(root),true);
});

test('HC07 fixed external claim refusal policy retains diagnostics while genuine Hub/Server close independently without replay',async t=>{
  const {owned,root,server,hub}=await acquire(t,{onCleanup:refused});let actualServerEvent=false;
  server.server.once('close',()=>{actualServerEvent=true;});
  assert.throws(()=>owned.refuseExternalClaimFailure('SYNTHETIC_PRIVATE_ERROR_MARKER'),/fixture_external_claim_category_invalid/);
  owned.refuseExternalClaimFailure('external-claim-acquisition-incomplete');
  owned.refuseExternalClaimFailure('external-claim-close-unconfirmed');
  owned.refuseExternalClaimFailure('external-claim-close-unconfirmed');
  const first=owned.cleanup();assert.equal(first,owned.cleanup());const result=await first;refused(result);
  assert.equal(actualServerEvent,true);assert.equal(result.server.closed,true);assert.equal(hub.history.db.isOpen,false);
  assert.equal(result.hubs[0].shutdownAttempts,1);assert.equal(result.server.stopAttempts,1);assert.equal(result.hubs[0].stages.at(-1).stage,'history');
  assert.ok(result.categories.includes('external-claim-acquisition-incomplete'));assert.ok(result.categories.includes('external-claim-close-unconfirmed'));
  assert.equal(result.categories.filter(c=>c==='external-claim-close-unconfirmed').length,1);assert.equal(fs.existsSync(root),true);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_ERROR_MARKER'),false);
  assert.throws(()=>owned.refuseExternalClaimFailure('external-claim-close-unconfirmed'),/fixture_external_claim_refusal_after_cleanup/);
  assert.equal(owned.cleanup(),first);assert.equal(owned.snapshot().directoryRemoved,false);
});
