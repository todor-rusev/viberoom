// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from 'node:assert/strict';
import {localResourceSelector} from './local-resource-families.mjs';
import {validateReturnedLocalResourceClosure} from './local-resource-closure-v2.mjs';
export function validateReturnedLocalResourceClosureV3(input,options){assert.equal(localResourceSelector(options.selector).extended,true,'child_resource_selector_required');
  return validateReturnedLocalResourceClosure(input,options);}
