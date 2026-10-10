// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, readdirSync, openSync, writeFileSync, fsyncSync, closeSync, existsSync, realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join, resolve, isAbsolute, win32} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PRODUCT_SOURCE_POLICY, PRODUCT_SCRIPTS, productSourceInventory} from './public-source-policy.mjs';

const here=resolve(fileURLToPath(new URL('../',import.meta.url)));
const BUNDLE='private-trial/BUNDLE-FILES.json', MANIFEST='private-trial/manifest.json';
const META=['package.json','tsconfig.json','scripts/graph-release-layout.json','scripts/graph-release-layout.mjs','scripts/public-source-policy.mjs'];
const BASE_FILES=['vendor','ui','templates','assets','!assets/icon-master.png',...PRODUCT_SCRIPTS,'NOTICE'];
const requiredSelectors=Object.freeze([
  "experiments/memory-retrieval-comparison-d3/input-contract.test.mjs",
  "experiments/memory-retrieval-comparison-d3/run.test.mjs",
  "experiments/memory-retrieval-comparison-d3/wire-projection.test.mjs",
  "experiments/memory-retrieval-trial-d5/additional-human-server-closure.test.mjs",
  "experiments/memory-retrieval-trial-d5/comparison-bridge.test.mjs",
  "experiments/memory-retrieval-trial-d5/configured-caller.test.mjs",
  "experiments/memory-retrieval-trial-d5/configured-hub-fixture-local-template.test.mjs",
  "experiments/memory-retrieval-trial-d5/configured-hub.test.mjs",
  "experiments/memory-retrieval-trial-d5/configured-native-scope-current.test.mjs",
  "experiments/memory-retrieval-trial-d5/isolated-source.test.mjs",
  "experiments/memory-retrieval-trial-d5/native-fresh-route-declaration.test.mjs",
  "experiments/memory-retrieval-trial-d5/native-observed-route-handoff.test.mjs",
  "experiments/memory-retrieval-trial-d5/native-project.test.mjs",
  "experiments/memory-retrieval-trial-d5/owned-configured-hub-fixture.test.mjs",
  "experiments/memory-retrieval-trial-d5/private-launch.test.mjs",
  "experiments/memory-retrieval-trial-d5/product-step.test.mjs",
  "experiments/memory-retrieval-trial-d5/profile.test.mjs",
  "experiments/memory-retrieval-trial-d5/tree-changed.test.mjs",
  "experiments/memory-retrieval-trial-d5/tree-inventory.test.mjs",
  "experiments/memory-retrieval-trial-d5/whole-executor.test.mjs",
  "experiments/trial-journal/journal.test.mjs",
  "experiments/trial-journal/lifetime.test.mjs",
  "experiments/trial-journal/local-fixture-roster.test.mjs",
  "experiments/trial-journal/owned-local-fixture.test.mjs",
  "experiments/trial-journal/shared-local-fixture.test.mjs",
  "experiments/trial-journal/whole-bridge-local-fixture.test.mjs",
  "private-trial/owned-trial-inputs.test.mjs",
  "private-trial/resident-v2.test.mjs"
]);
const requiredPrivate=[
  'private-trial/typed-native-test-resource-profiles.json',
  'private-trial/owned-trial-inputs.mjs',
  'private-trial/resident.d.mts',
  'private-trial/resident.mjs',
  'private-trial/trial-journal/local-fixture-roster.mjs',
  'private-trial/trial-journal/local-resource-closure-v2.mjs',
  'private-trial/trial-journal/local-resource-closure-v3.mjs',
  'private-trial/trial-journal/local-resource-closure.mjs',
  'private-trial/trial-journal/local-resource-families.mjs',
  'private-trial/trial-journal/owned-bridge-local-fixture.mjs',
  'private-trial/trial-journal/owned-journal-child-roots.mjs',
  'private-trial/trial-journal/owned-local-fixture-core.mjs',
  'private-trial/trial-journal/owned-local-fixture.mjs',
  'private-trial/trial-journal/owned-private-launch-fixture.mjs',
  'private-trial/trial-journal/owned-product-local-fixture.mjs',
  'private-trial/trial-journal/owned-profile-local-fixture.mjs',
  'private-trial/trial-journal/owned-whole-local-fixture.mjs',
  'private-trial/trial-journal/sql-resource-observation.mjs',
  'private-trial/canonical-files.mjs'
];
const requiredOracleHelpers=[
  "experiments/memory-retrieval-trial-d5/owned-native-trial-lifetime.mjs",
  "experiments/trial-journal/local-resource-closure.mjs",
  "experiments/trial-journal/local-resource-families.mjs",
  "experiments/trial-journal/owned-bridge-local-fixture.mjs",
  "experiments/trial-journal/owned-local-fixture.mjs",
  "experiments/trial-journal/owned-private-launch-fixture.mjs",
  "experiments/trial-journal/owned-product-local-fixture.mjs",
  "experiments/trial-journal/owned-profile-local-fixture.mjs",
  "experiments/trial-journal/owned-whole-local-fixture.mjs",
  "experiments/trial-journal/sql-resource-observation.mjs"
];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const closed=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),keys.slice().sort(),'graph_release_layout_closed_fields');
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
const name=value=>{
  assert.ok(typeof value==='string'&&value.length&&!value.includes('\\')&&!isAbsolute(value)&&!win32.isAbsolute(value));
  assert.ok(value.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!p.includes(':')),'graph_release_layout_relative_path');return value;
};
function file(root,relativePath){
  name(relativePath);let at=resolve(root);const base=lstatSync(at);assert.ok(base.isDirectory()&&!base.isSymbolicLink());
  for(const part of relativePath.split('/')){at=join(at,part);assert.equal(lstatSync(at).isSymbolicLink(),false,'graph_release_layout_link');}
  assert.ok(lstatSync(at).isFile(),'graph_release_layout_regular_file');return at;
}
function names(root){
  const result=[];const walk=(at,prefix)=>{
    const stat=lstatSync(at);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'graph_release_layout_directory');
    for(const entry of readdirSync(at,{withFileTypes:true})){
      const relativePath=prefix+entry.name,child=join(at,entry.name),s=lstatSync(child);
      assert.equal(s.isSymbolicLink(),false,'graph_release_layout_link');
      if(s.isDirectory())walk(child,relativePath+'/');else{assert.ok(s.isFile());result.push(name(relativePath));}
    }
  };walk(root,'');return result.sort();
}
const pinned=(root,relativePath)=>{const bytes=readFileSync(file(root,relativePath));return {relativePath,bytes:bytes.length,sha256:hash(bytes)};};
export function graphReleaseLayout(root=here){
  const spec=JSON.parse(readFileSync(file(root,'scripts/graph-release-layout.json'),'utf8'));
  closed(spec,['schema','sourcePolicy','privateCode','sourceOracleCode','oracleSelectors','generated','userInputsNotShipped']);
  assert.equal(spec.schema,'viberoom-graph-release-layout-v3');assert.equal(spec.sourcePolicy,PRODUCT_SOURCE_POLICY);
  assert.ok(Array.isArray(spec.privateCode)&&spec.privateCode.length);
  for(const p of spec.privateCode){name(p);assert.ok(p.startsWith('private-trial/')&&!p.startsWith('private-trial/inputs/')&&!p.endsWith('.test.mjs')&&/\.(mjs|json|d\.mts)$/.test(p));}
  const runtimeJson=['private-trial/typed-native-test-resource-profiles.json'];
  assert.deepEqual(spec.privateCode.filter(p=>p.endsWith('.json')),runtimeJson.sort(),'graph_release_runtime_json_only');
  assert.deepEqual(spec.privateCode,[...new Set(spec.privateCode)].sort(),'graph_release_layout_duplicate_or_unsorted');
  for(const p of requiredPrivate)assert.ok(spec.privateCode.includes(p),'graph_release_required_private');
  assert.ok(Array.isArray(spec.sourceOracleCode));assert.deepEqual(spec.sourceOracleCode,[...new Set(spec.sourceOracleCode)].sort());
  for(const p of spec.sourceOracleCode){name(p);assert.ok(!spec.privateCode.includes(p),'graph_release_code_overlap');
    assert.ok((p.startsWith('private-trial/')&&p.endsWith('.test.mjs'))||
      (['memory-deletion-refresh-b18d','memory-retrieval-comparison-d3','memory-retrieval-trial-d5','trial-journal'].some(d=>p.startsWith('experiments/'+d+'/'))&&p.endsWith('.mjs'))||
      ['experiments/memory-retrieval-trial-d5/fixtures/payloads.json','experiments/memory-retrieval-trial-d5/fixtures/questions.json'].includes(p),'graph_release_finite_oracle_code');}
  assert.deepEqual(spec.oracleSelectors,requiredSelectors,'graph_release_required_selectors');
  for(const p of spec.oracleSelectors)assert.ok(spec.sourceOracleCode.includes(p),'graph_release_selector_absent');
  for(const p of requiredOracleHelpers)assert.ok(spec.sourceOracleCode.includes(p),'graph_release_resource_helper_absent');
  assert.deepEqual(spec.generated,[BUNDLE,MANIFEST]);
  assert.ok([...spec.privateCode,...spec.sourceOracleCode].every(p=>!spec.generated.includes(p)),'graph_release_generated_code_overlap');
  assert.deepEqual(spec.userInputsNotShipped,['private-trial/inputs/BOUND-PREPARATION.json','private-trial/inputs/PREPARED-PROFILE.json','private-trial/inputs/ingestion.json']);
  return spec;
}
export function graphReleasePackageFiles(root=here){
  const spec=graphReleaseLayout(root),product=productSourceInventory(root);
  return [...BASE_FILES,...product.sources,...product.sourceEmit.map(p=>p.emit),...product.runtimeAssets,'tsconfig.json',...spec.privateCode,...spec.sourceOracleCode,...spec.generated];
}
export function graphReleasePublicEntries(root=here){
  const spec=graphReleaseLayout(root);return [...spec.privateCode,...spec.sourceOracleCode].map(from=>({from}));
}
function verifyDeclaredPackage(root){
  const pkg=JSON.parse(readFileSync(file(root,'package.json'),'utf8'));
  if(JSON.stringify(pkg.files)!==JSON.stringify(graphReleasePackageFiles(root)))
    throw new Error('graph_release_package_files_not_shared: run node scripts/graph-release-layout.mjs write-package-files');
}
export function writeGraphReleasePackageFiles(root=here){
  const path=file(root,'package.json'),pkg=JSON.parse(readFileSync(path,'utf8')),files=graphReleasePackageFiles(root);
  const written=JSON.stringify(pkg.files)!==JSON.stringify(files);
  if(written){pkg.files=files;writeFileSync(path,jsonBytes(pkg));}
  return {sourcePolicy:PRODUCT_SOURCE_POLICY,packageFiles:files.length,written};
}
function bundleBytes(root){
  const spec=graphReleaseLayout(root);for(const p of [...spec.privateCode,...spec.sourceOracleCode])file(root,p);
  return jsonBytes({schema:'fixed-resident-private-source-bundle-v1',files:[...spec.privateCode,...spec.sourceOracleCode,BUNDLE].sort()});
}
function sdkAt(root,supplied){
  const result=supplied?resolve(supplied):resolve(createRequire(join(resolve(root),'package.json')).resolve('@getzep/zep-cloud/package.json'),'..');
  const pkg=JSON.parse(readFileSync(file(result,'package.json'),'utf8'));
  assert.equal(pkg.name,'@getzep/zep-cloud');assert.equal(pkg.version,'3.28.0');return result;
}
function snapshot(root,sdkRoot,{installed=false}={}){
  verifyDeclaredPackage(root);const spec=graphReleaseLayout(root);
  const product=productSourceInventory(root),{sources,sourceEmit}=product;
  const sourceNames=names(join(root,'src')).map(p=>'src/'+p),emitNames=names(join(root,'dist')).map(p=>'dist/'+p);
  if(installed){
    assert.ok(!sourceNames.some(p=>/\.test(?:\.|$)/.test(p))&&!emitNames.some(p=>/\.test(?:\.|$)/.test(p)),'graph_release_installed_private_test');
    assert.deepEqual(sourceNames,sources,'graph_release_installed_product_source_set');
  }
  const privateEmits=new Set(product.privateTests.filter(p=>!p.endsWith('.d.ts')).flatMap(p=>{const stem='dist/'+p.slice(4,-3);return [stem+'.js',stem+'.js.map',stem+'.d.ts'];}));
  const emitted=emitNames.filter(p=>!privateEmits.has(p));
  assert.deepEqual(emitted,[...sourceEmit.map(p=>p.emit),...product.runtimeAssets].sort(),'graph_release_source_emit_bijection');
  const files=[...new Set([...sources,...emitted,...spec.privateCode,...spec.sourceOracleCode,BUNDLE,...META])].sort().map(p=>pinned(root,p));
  const sdk=sdkAt(root,sdkRoot),sdkFiles=names(sdk).map(p=>pinned(sdk,p));
  return {schema:'resident-private-preparation-package-v1',status:'LOCAL_SOURCE_DEPLOYMENT_BYTES_BOUND_ONLY',files,sourceEmit,
    sdk:{version:'3.28.0',files:sdkFiles},sourceEvidence:{schema:'resident-release-layout-physical-observation-v1',
      status:'PHYSICAL_BYTES_ONLY_NO_REVIEW_BUILD_OR_RUNTIME_VERDICT',layoutSha256:hash(readFileSync(file(root,'scripts/graph-release-layout.json')))}};
}
function createOrMatch(root,relativePath,bytes){
  const target=join(root,relativePath);
  if(existsSync(target)){assert.ok(readFileSync(file(root,relativePath)).equals(bytes),'graph_release_stale_output_refused');return;}
  const fd=openSync(target,'wx');try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  assert.ok(readFileSync(file(root,relativePath)).equals(bytes),'graph_release_output_bytes_changed');
}
export function prepareGraphReleaseLayout(root=here,{sdkRoot}={}){
  verifyDeclaredPackage(root);createOrMatch(root,BUNDLE,bundleBytes(root));
  const observation=snapshot(root,sdkRoot),bytes=jsonBytes(observation);
  createOrMatch(root,MANIFEST,bytes);assert.deepEqual(snapshot(root,sdkRoot),observation,'graph_release_changed_during_observation');
  return {manifestSha256:hash(bytes),sourceEmitCount:observation.sourceEmit.length,paidAuthority:false,runtimeGO:false};
}
export function assertInstalledGraphReleaseLayout(root,{sdkRoot}={}){
  const spec=graphReleaseLayout(root);
  assert.deepEqual(names(join(root,'private-trial')).map(p=>'private-trial/'+p),[...spec.privateCode,...spec.sourceOracleCode.filter(p=>p.startsWith('private-trial/')),...spec.generated].sort(),'graph_release_installed_private_set');
  assert.deepEqual(names(join(root,'experiments')).map(p=>'experiments/'+p),spec.sourceOracleCode.filter(p=>p.startsWith('experiments/')),'graph_release_installed_oracle_set');
  assert.ok(readFileSync(file(root,BUNDLE)).equals(bundleBytes(root)),'graph_release_bundle_bytes_changed');
  const actual=snapshot(root,sdkRoot,{installed:true}),bytes=readFileSync(file(root,MANIFEST));
  assert.ok(bytes.equals(jsonBytes(actual)),'graph_release_manifest_bytes_changed');
  assert.deepEqual(snapshot(root,sdkRoot,{installed:true}),actual,'graph_release_changed_during_observation');
  return {schema:'resident-installed-release-layout-observation-v1',manifestSha256:hash(bytes),
    sourceEmitCount:actual.sourceEmit.length,privateCodeCount:spec.privateCode.length,sourceOracleCount:spec.sourceOracleCode.length,paidAuthority:false,runtimeGO:false};
}
let directEntry=false;
if(process.argv[1])try{directEntry=realpathSync(resolve(process.argv[1]))===realpathSync(fileURLToPath(import.meta.url));}catch{}
if(directEntry){
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='write-package-files')console.log(JSON.stringify(writeGraphReleasePackageFiles()));
  else{
    assert.deepEqual(args,['prepare'],'Use graph-release-layout.mjs prepare or write-package-files in the owning product root.');
    console.log(JSON.stringify(prepareGraphReleaseLayout()));
  }
}
