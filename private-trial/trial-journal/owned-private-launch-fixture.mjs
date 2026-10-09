// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import {createOwnedLocalFixture} from './owned-local-fixture-core.mjs';

export function createOwnedPrivateLaunchFixture(t,{evidenceRoot=null}={}){
  return createOwnedLocalFixture(t,{family:'private-launch',evidenceRoot});
}
