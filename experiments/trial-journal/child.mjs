// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import {RunJournal} from './journal.mjs';
const [root,approvalText,mode]=process.argv.slice(2);
try{
  const owner=RunJournal.claim(root,{approval:JSON.parse(approvalText),verifyApproval:()=>true,current:()=>true,validateRequest:()=>true});
  if(mode==='crash'){const request={method:'POST',url:'http://127.0.0.1/model',body:{question:'fixture'},maxRetries:0};owner.permit({id:'model:1',kind:'model',request,estimate:0});owner.admit('model:1',request);process.exit(0);}
  owner.close();process.exit(0);
}catch{process.exit(2);}
