// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from 'node:assert/strict';
import {DTrial} from './profile.mjs';

export function createOwnedNativeTrialLifetime(t){
  let world=null,owner=null,claimAttempted=false,claimReturned=false,ended=false;
  let closeAttempts=0,closeCallReturned=false;
  const refused=new Set();
  function refuse(category,primary=null){
    if(refused.has(category))return;
    refused.add(category);
    try{world.refuseExternalClaimFailure(category);}
    catch(error){if(primary!==null)throw new AggregateError([primary,error],'manual_trial_and_fixture_refusal_failed');throw error;}
  }
  t.after(()=>{
    ended=true;
    if(!claimAttempted)return;
    if(!claimReturned){refuse('external-claim-acquisition-incomplete');return;}
    closeAttempts++;
    try{Reflect.apply(DTrial.prototype.close,owner,[]);closeCallReturned=true;}
    catch(error){refuse('external-claim-close-unconfirmed',error);throw error;}
  });
  return Object.freeze({
    attach(returnedWorld){
      assert.equal(ended,false,'manual_trial_lifetime_ended');assert.equal(world,null,'manual_trial_world_already_attached');
      assert.ok(returnedWorld&&typeof returnedWorld.ownerRoot==='string'&&typeof returnedWorld.refuseExternalClaimFailure==='function','manual_trial_configured_world_required');
      world=returnedWorld;
    },
    claim(current){
      assert.equal(ended,false,'manual_trial_lifetime_ended');assert.ok(world,'manual_trial_world_not_attached');
      assert.equal(claimAttempted,false,'manual_trial_claim_already_attempted');assert.equal(typeof current,'function');
      claimAttempted=true;
      try{owner=DTrial.claim(world.ownerRoot,{approval:world.approval,verifyApproval:()=>true,current});claimReturned=true;return owner;}
      catch(error){refuse('external-claim-acquisition-incomplete',error);throw error;}
    },
    snapshot(){return Object.freeze({claimAttempted,claimReturned,ended,closeAttempts,closeCallReturned,refusals:Object.freeze([...refused])});}
  });
}
