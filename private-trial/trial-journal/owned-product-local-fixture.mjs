// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import {createOwnedLocalFixture} from './owned-local-fixture-core.mjs';
export function createOwnedProductFixture(t,options={}){return createOwnedLocalFixture(t,{family:'product-step',evidenceRoot:options.evidenceRoot??null});}
