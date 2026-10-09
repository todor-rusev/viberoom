// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import {createOwnedLocalFixture} from './owned-local-fixture-core.mjs';
export function createOwnedWholeFixture(t,options={}){return createOwnedLocalFixture(t,{family:'whole-executor',evidenceRoot:options.evidenceRoot??null});}
