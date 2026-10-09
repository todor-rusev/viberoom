// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import fs from 'node:fs';
import {refusalAsNo} from './trial-journal/policy-assert.mjs';

const refused=code=>Object.assign(new Error(code),{code});
export function createPreparationLifetime(root){
  let phase='EMPTY';
  return Object.freeze({
    get phase(){return phase;},
    begin(){
      if(phase!=='EMPTY'||fs.existsSync(root))throw refused('preparation_not_repeatable');
      phase='PREPARING';
      try{fs.mkdirSync(root);}catch{phase='REFUSED';throw refused('preparation_root_acquisition_refused');}
    },
    complete(){if(phase!=='PREPARING')throw refused('preparation_phase_refused');phase='PREPARED';},
    refuse(){phase='REFUSED';},
  });
}
export function createResidentFences({liveCurrent,artifactCurrent,beforeClaim}){
  if([liveCurrent,artifactCurrent,beforeClaim].some(v=>typeof v!=='function'))throw refused('resident_fence_required');
  const current=()=>refusalAsNo(()=>liveCurrent()===true&&artifactCurrent()===true);
  const beforeOffer=()=>refusalAsNo(()=>current()===true&&beforeClaim()===true);
  return Object.freeze({current,beforeOffer});
}
