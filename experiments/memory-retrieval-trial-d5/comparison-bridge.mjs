// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import invariant from 'node:assert/strict';
import { DTrial } from './profile.mjs';
import { budgetRecorder } from './budget-recorder.mjs';
import { json, canonical, RunBudget, Held } from '../memory-retrieval-comparison-d3/contracts.mjs';
import { runComparison } from '../memory-retrieval-comparison-d3/run.mjs';
import {nativeProfile} from './native-project.mjs';

export async function runOwnedComparison(input) {
  const owner=input.owner;
  assert.ok(owner instanceof DTrial);
  owner.beginComparison();
  let manifest,questions,payloads,preparation,permit,authorities,ports,current,record,clock,readLocalRoutes,beforeComparison=null,afterComparison=null,loadInputs=null;
  let budget, activeJob = null, initializing = false;
  const recorder = budgetRecorder(owner, {
    getBudget: () => budget,
    getLogicalJobId: () => {
      assert.ok(activeJob, 'model_without_manifest_job'); return activeJob.order;
    },
  });
  let result, primaryError, finalError, durableTrial;
  try {
    ({manifest,questions,payloads,preparation,permit,authorities,ports,current,record,clock,readLocalRoutes,beforeComparison=null,afterComparison=null,loadInputs=null}=input);
    if(loadInputs!==null){invariant.equal(typeof loadInputs,'function');({manifest,questions,payloads,preparation,ports,current,record,clock,readLocalRoutes}=loadInputs());}
    initializing=beforeComparison!==null;
    manifest = json(manifest); questions = json(questions); payloads = json(payloads);
    preparation = json(preparation); permit = json(permit); authorities = json(authorities);
    invariant.equal(typeof ports, 'function'); invariant.equal(typeof record, 'function');
    invariant.equal(typeof current, 'function');
    const state = owner.summary(), profile = state.policy.identity;
    assert.ok(state.state.run.claim && state.state.run.stopped === null, 'trial_not_active');
    for (const [key, input] of Object.entries({ manifest, questions, payloads }))
      assert.equal(canonical(input), canonical(profile[key]), `trial_${key}_changed`);
    invariant.ok(beforeComparison === null || typeof beforeComparison === 'function');invariant.ok(afterComparison === null || typeof afterComparison === 'function');
    budget = new RunBudget(manifest.limits, clock, attempt => initializing ? recorder.recordPreflightAttempt(attempt) : recorder.recordAttempt(attempt), () => recorder.flush());
    if(beforeComparison !== null){
      const binding = await beforeComparison({budget,recorder});budget.check();
      permit=json(binding.permit);authorities=json(binding.authorities);
    }
    initializing=false;
    assert.equal(permit.purpose, profile.purpose);
    assert.equal(permit.ownerClaimId, state.state.run.claim);
    const nativeCapability=nativeProfile(profile)?owner.nativeComparison(permit,authorities,readLocalRoutes):null;
    const observedCurrent=(...args)=>current(...args)===true&&(!nativeCapability||nativeCapability.routesCurrent()===true);
    const { readPort, answerPort } = ports({ budget, nativeCapability, current:observedCurrent });
    result = await runComparison({ manifest, questions, payloads, preparation, permit, authorities,
      readPort, answerPort, current:observedCurrent, budget, nativeCapability,
      onJob(job) {
        activeJob = job === null ? null : json(job);
        if (activeJob) assert.equal(canonical(activeJob), canonical(profile.manifest.jobs[activeJob.order - 1]), 'wrong_manifest_job');
      },
      record(kind, value) {
        if (kind !== 'finish') record(kind, value);
      },
    });
    if (afterComparison !== null) await afterComparison({ budget, recorder, result });
  } catch (error) { primaryError = error; }
  finally {
    activeJob = null;
    budget?.stop('comparison_finished_no_resume');
    for (const attempt of budget?.attempts ?? []) if (attempt.status === 'attempted') {
      attempt.status = 'unknown'; attempt.error ??= 'comparison_finished_with_unresolved_attempt';
    }
    if (!budget) budget = { attempts: [] };
    try { durableTrial = recorder.finish(); } catch (error) { finalError = error; }
  }
  if (primaryError && finalError) throw new AggregateError([primaryError, finalError], 'comparison_and_finish_failed');
  if (finalError) throw finalError;
  if (primaryError) throw primaryError;
  assert.ok(result, 'comparison_result_missing');
  if (result.summary.reason === 'outcome_record_refused') throw new Held('outcome_record_refused');
  result.attempts = json(budget.attempts);
  result.durableTrial = json(durableTrial);
  record('finish', json(result));
  return result;
}
