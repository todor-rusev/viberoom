// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from 'node:assert/strict';

export async function withHumanServer(w,body){
  for(const name of ['constructAdditionalHumanServer','startAdditionalHumanServer','observeAdditionalHumanServerClose','refuseAdditionalServerFailure'])
    assert.equal(typeof w[name],'function','human_server_fixture_hook_required');
  let actual=null,running=null,primary=null,result,closeError=null;
  try{actual=w.constructAdditionalHumanServer();running=await w.startAdditionalHumanServer(actual);assert.equal(running.server,actual);result=await body(running);}
  catch(error){primary=error;if(!running)w.refuseAdditionalServerFailure('additional-server-acquisition-incomplete');}
  finally{
    if(actual)try{await w.observeAdditionalHumanServerClose(actual,async()=>{if(running)await running.close();else actual.close();});}
      catch(error){closeError=error;w.refuseAdditionalServerFailure('additional-server-close-unconfirmed');}
  }
  if(primary&&closeError)throw new AggregateError([primary,closeError],'human_server_body_and_close_failed');if(primary)throw primary;if(closeError)throw closeError;return result;
}
export const decisionFor=card=>({cardSha256:card.trialBudget.cardSha256,viewSha256:card.trialBudget.viewSha256,decision:'approve'});
function door(running,path,body,{key=true,origin=null}={}){
  const headers={'content-type':'application/json',...(key?{'x-viberoom-key':running.key}:{}),...(origin?{origin}:{})};
  return fetch(new URL(path,running.url),{method:'POST',headers,body:JSON.stringify(body)});
}
export const humanDecision=(running,card,body=decisionFor(card),options={})=>door(running,'api/private-trial/budget/'+encodeURIComponent(card.id),body,options);
export const humanRevoke=(running,card,body={},options={})=>door(running,'api/private-trial/budget/'+encodeURIComponent(card.id)+'/revoke',body,options);
