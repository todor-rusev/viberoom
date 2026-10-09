// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import {createOwnedLocalFixture} from './owned-local-fixture-core.mjs';
export function createOwnedProfileFixture(t,options={}){return createOwnedLocalFixture(t,{family:'profile',evidenceRoot:options.evidenceRoot??null});}
