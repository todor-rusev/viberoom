// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from 'node:assert/strict';
export const PRODUCT_SELECTOR='experiments/memory-retrieval-trial-d5/product-step.test.mjs';
export const PRIVATE_SELECTOR='experiments/memory-retrieval-trial-d5/private-launch.test.mjs';
export const PROFILE_SELECTOR='experiments/memory-retrieval-trial-d5/profile.test.mjs';
export const SHARED_RESOURCE_SCHEMA='resident-owned-local-resource-closure-v2';
export const CHILD_RESOURCE_SCHEMA='resident-owned-local-resource-closure-v3';
const descriptors=Object.freeze({
  'product-step':Object.freeze({family:'product-step',selector:PRODUCT_SELECTOR,http:'double',histories:true,
    namespaces:Object.freeze(['experiment']),ownerSource:'private-trial/trial-journal/owned-product-local-fixture.mjs'}),
  'private-launch':Object.freeze({family:'private-launch',selector:PRIVATE_SELECTOR,http:'double',histories:true,
    namespaces:Object.freeze(['experiment','private']),ownerSource:'private-trial/trial-journal/owned-private-launch-fixture.mjs'}),
  profile:Object.freeze({family:'profile',selector:PROFILE_SELECTOR,http:'optional-raw',histories:false,
    namespaces:Object.freeze(['experiment']),ownerSource:'private-trial/trial-journal/owned-profile-local-fixture.mjs'}),
  'whole-executor':Object.freeze({family:'whole-executor',selector:'experiments/memory-retrieval-trial-d5/whole-executor.test.mjs',http:'optional-raw',histories:false,extended:true,directDatabase:false,
    namespaces:Object.freeze(['experiment']),ownerSource:'private-trial/trial-journal/owned-whole-local-fixture.mjs'}),
  'comparison-bridge':Object.freeze({family:'comparison-bridge',selector:'experiments/memory-retrieval-trial-d5/comparison-bridge.test.mjs',http:'raw',histories:false,extended:true,directDatabase:true,
    namespaces:Object.freeze(['experiment']),ownerSource:'private-trial/trial-journal/owned-bridge-local-fixture.mjs'})
});
export function localResourceFamily(family){assert.ok(typeof family==='string'&&Object.hasOwn(descriptors,family),'local_fixture_family_not_implemented');return descriptors[family];}
export function localResourceSelector(selector){const found=Object.values(descriptors).find(d=>d.selector===selector);assert.ok(found,'local_fixture_selector_not_implemented');return found;}
export function journalSourcePaths(namespace){assert.ok(namespace==='experiment'||namespace==='private','local_fixture_namespace_invalid');
  const root=namespace==='experiment'?'experiments':'private-trial';return Object.freeze({
    observer:`${root}/trial-journal/sql-resource-observation.mjs`,journal:`${root}/trial-journal/journal.mjs`});}
