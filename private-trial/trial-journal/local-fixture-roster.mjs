// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from 'node:assert/strict';
import {after} from 'node:test';
import fs from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,hash,data} from './data.mjs';
import {localResourceFamily} from './local-resource-families.mjs';
const MAXIMUM=4096,MAX_BYTES=4*1024*1024,tokens=new WeakMap(),groups=new Map();
const sourcePath=fileURLToPath(import.meta.url),writer=Object.freeze({processId:process.pid,parentProcessId:process.ppid});
let published=false;
const same=(a,b)=>assert.equal(canonical(a),canonical(b),'fixture_roster_join_changed');
function pin(path){const b=fs.readFileSync(path);assert.ok(b.length>0&&b.length<=MAX_BYTES,'fixture_roster_byte_bound');return {path,bytes:b.length,sha256:hash(b)};}
function identity(root){assert.equal(fs.realpathSync(root),resolve(root),'fixture_roster_physical_root_required');const s=fs.statSync(root,{bigint:true});assert.ok(s.isDirectory()&&!fs.lstatSync(root).isSymbolicLink());
  return {path:resolve(root),device:String(s.dev),inode:String(s.ino),birthtimeNs:String(s.birthtimeNs),platform:process.platform};}
function issue(g,fixtureId,category){if(g.unknowns.length<MAXIMUM)g.unknowns.push({fixtureId,category});else g.traceComplete=false;}
function createNew(path,value){const b=Buffer.from(canonical(value)+'\n');assert.ok(b.length<=MAX_BYTES,'fixture_roster_byte_bound');fs.writeFileSync(path,b,{flag:'wx'});return {path,bytes:b.length,sha256:hash(b)};}
function record(tuple){const p=data(tuple);assert.deepEqual(Object.keys(p).sort(),['bytes','path','sha256']);assert.ok(Number.isSafeInteger(p.bytes)&&p.bytes>0&&p.bytes<=MAX_BYTES);
  assert.match(p.sha256,/^[a-f0-9]{64}$/);same(pin(p.path),p);const b=fs.readFileSync(p.path),v=JSON.parse(b);assert.equal(b.toString('utf8'),canonical(v)+'\n');return v;}
function expected(entry,value){assert.equal(value.fixtureId,entry.fixtureId);assert.equal(value.family,entry.family);assert.equal(value.selector,entry.selector);
  assert.equal(value.nodeVersion,process.version);same(value.writer,writer);}

export function registerOwnedLocalFixture({fixtureId,family,evidenceRoot}){
  assert.equal(published,false,'fixture_roster_registration_after_publication');assert.match(fixtureId,/^[a-f0-9-]{36}$/);
  const descriptor=localResourceFamily(family),key=evidenceRoot===null?null:resolve(evidenceRoot);
  let g=groups.get(key);
  if(!g){assert.ok(groups.size<MAXIMUM,'fixture_roster_group_bound');g={root:key,initial:key===null?null:identity(key),selector:descriptor.selector,entries:[],unknowns:[],traceComplete:true};groups.set(key,g);}
  assert.ok(g.entries.length<MAXIMUM,'fixture_roster_registration_bound');assert.equal(g.entries.some(e=>e.fixtureId===fixtureId),false,'fixture_roster_duplicate_registration');
  const entry={fixtureId,family,selector:descriptor.selector,registrationPin:null,registration:null,terminalPin:null,terminalAttempted:false,terminal:null,g};g.entries.push(entry);
  if(g.selector!==descriptor.selector)issue(g,fixtureId,'multiple-selectors-one-evidence-root');
  const token=Object.freeze({});tokens.set(token,entry);
  try{
    const rosterSourcePin=pin(sourcePath);entry.registration={schema:'resident-owned-local-fixture-registration-v1',fixtureId,family,selector:descriptor.selector,
      nodeVersion:process.version,writer,evidenceRoot:key,rosterSourcePin};
    if(key!==null){same(identity(key),g.initial);entry.registrationPin=createNew(join(key,`local-ledger-registration-${fixtureId}.json`),entry.registration);}
  }catch(error){issue(g,fixtureId,'registration-publication-unconfirmed');throw error;}
  return token;
}
export function recordOwnedLocalFixtureTerminal(token,terminalPin){
  const entry=tokens.get(token);assert.ok(entry,'fixture_roster_registration_required');assert.equal(entry.terminalAttempted,false,'fixture_roster_terminal_not_replayed');entry.terminalAttempted=true;
  try{
    assert.ok(entry.g.root!==null,'fixture_roster_external_terminal_required');same(identity(entry.g.root),entry.g.initial);
    const tuple=data(terminalPin);assert.equal(tuple.path,join(entry.g.root,`local-ledger-terminal-${entry.fixtureId}.json`));const terminal=record(tuple);expected(entry,terminal);
    const d=localResourceFamily(entry.family);assert.equal(terminal.schema,d.extended?'resident-owned-local-resource-closure-v3':'resident-owned-local-resource-closure-v2');
    assert.ok(terminal.status==='closed'||terminal.status==='unknown');assert.equal(typeof terminal.traceComplete,'boolean');
    entry.terminalPin=tuple;entry.terminal=terminal;
    if(terminal.status!=='closed'||terminal.traceComplete!==true)issue(entry.g,entry.fixtureId,'fixture-terminal-unknown');
  }catch(error){issue(entry.g,entry.fixtureId,'terminal-publication-unconfirmed');throw error;}
}
export function recordOwnedLocalFixturePublicationFailure(token){const entry=tokens.get(token);assert.ok(entry,'fixture_roster_registration_required');
  issue(entry.g,entry.fixtureId,'terminal-publication-unconfirmed');}

function publish(){
  assert.equal(published,false,'fixture_roster_publication_not_replayed');published=true;
  for(const g of groups.values()){
    if(g.root===null)continue;
    try{
      same(identity(g.root),g.initial);const rosterSourcePin=pin(sourcePath);
      for(const entry of g.entries){
        if(!entry.registrationPin){issue(g,entry.fixtureId,'registration-missing');continue;}
        try{const registration=record(entry.registrationPin);same(registration,entry.registration);same(registration.rosterSourcePin,rosterSourcePin);}
        catch{issue(g,entry.fixtureId,'registration-drift-unconfirmed');}
        if(!entry.terminalPin){issue(g,entry.fixtureId,'terminal-missing');continue;}
        try{const terminal=record(entry.terminalPin);same(terminal,entry.terminal);expected(entry,terminal);}
        catch{issue(g,entry.fixtureId,'terminal-drift-unconfirmed');}
      }
      const value={schema:'resident-owned-local-fixture-roster-v1',selector:g.selector,nodeVersion:process.version,writer,evidenceRoot:g.root,rosterSourcePin,
        fixtures:g.entries.map(entry=>({fixtureId:entry.fixtureId,registrationPin:entry.registrationPin,terminalPin:entry.terminalPin})),
        traceComplete:g.traceComplete,status:g.unknowns.length===0&&g.traceComplete?'complete':'unknown',unknowns:g.unknowns};
      createNew(join(g.root,`local-ledger-roster-${process.pid}.json`),value);
    }catch{issue(g,null,'roster-publication-unconfirmed');}
  }
}
after(publish);
