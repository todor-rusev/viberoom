// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import invariant from 'node:assert/strict';
import {data} from '../trial-journal/data.mjs';

export function budgetRecorder(owner,{getBudget,getLogicalJobId}){
  invariant.equal(typeof getBudget,'function');invariant.equal(typeof getLogicalJobId,'function');
  const recorded=new Set(),settled=new Set();let finished=false,finalSummary,finalError;
  const flush=()=>{
    assert.equal(finished,false,'comparison_already_finished');
    const pending=getBudget().attempts.filter(a=>Number.isSafeInteger(a?.number) && recorded.has(a.number) && !settled.has(a.number));
    for(const a of data(pending)){
      if(a.status==='attempted')throw new Error('previous_budget_attempt_unfinished');
      const known=owner.recordBudgetOutcome(a.number,a);settled.add(a.number);
      if(!known && owner.summary().state.run.stopped!==null)throw new Error('budget_outcome_unknown');
    }
    return true;
  };
  return Object.freeze({
    flush,
    recordAttempt(input){
      const a=data(input);flush();assert.ok(!recorded.has(a.number),'budget_attempt_replay');
      assert.equal(owner.recordAttempt(a,a.kind==='model'?getLogicalJobId():null),true);recorded.add(a.number);return true;
    },
    recordPreflightAttempt(input){
      const a=data(input);flush();assert.ok(!recorded.has(a.number),'budget_attempt_replay');
      assert.equal(owner.recordPreflightAttempt(a),true);recorded.add(a.number);return true;
    },
    recordWriteAttempt(input,permitId){
      const a=data(input);flush();assert.ok(!recorded.has(a.number),'budget_attempt_replay');
      assert.equal(owner.recordWriteAttempt(a,permitId),true);recorded.add(a.number);return true;
    },
    finish(){
      if(finished){if(finalError)throw finalError;return finalSummary;}
      finished=true;const errors=[];
      try{
        const attempts=data(getBudget().attempts);
        for(const a of attempts){
          if(!recorded.has(a.number) || settled.has(a.number))continue;
          try{owner.recordBudgetOutcome(a.number,{...a,status:a.status==='attempted'?'unknown':a.status});settled.add(a.number);}
          catch(error){errors.push(error);}
        }
      }catch(error){errors.push(error);}
      try{owner.stop('comparison_finished_no_resume');}catch(error){errors.push(error);}
      if(errors.length){finalError=new AggregateError(errors,'comparison_finish_failed');throw finalError;}
      try{finalSummary=owner.summary();return finalSummary;}catch(error){finalError=error;throw error;}
    }
  });
}
