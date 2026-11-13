import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,lstat,writeFile,readFile,symlink,unlink,rm,readlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {packageFiles} from '../package-policy.mjs';
import {verifyPackage} from '../verify-package.mjs';
import {materializeBundle,approvedLinkTarget} from '../materialize-bundle.mjs';
import {diagnoseLinks} from '../diagnose-package-links.mjs';

async function fixture(t,{withPrepared=true}={}){
  const temporary=await mkdtemp(path.join(tmpdir(),'ads-package-'));
  t.after(async()=>{
    assert.equal(path.dirname(temporary),path.resolve(tmpdir()));
    assert.ok(path.basename(temporary).startsWith('ads-package-'));
    await rm(temporary,{recursive:true,force:true});
  });
  const sourceRoot=path.join(temporary,'source'),packageRoot=path.join(sourceRoot,'.migration-package');
  for(const file of packageFiles)for(const root of withPrepared?[sourceRoot,packageRoot]:[sourceRoot]){
    await mkdir(path.dirname(path.join(root,file)),{recursive:true});
    await copyFile(file,path.join(root,file));
  }
  return {temporary,sourceRoot,packageRoot,bundleRoot:path.join(packageRoot,'output','bundle')};
}
test('preparation writes exact regular files and refuses to overwrite an existing package',async t=>{
  const f=await fixture(t,{withPrepared:false});
  const script=path.resolve('migration/prepare-package.mjs');
  execFileSync(process.execPath,[script],{cwd:f.sourceRoot,stdio:'pipe'});
  await verifyPackage(f.packageRoot,f.sourceRoot);
  assert.throws(()=>execFileSync(process.execPath,[script],{cwd:f.sourceRoot,stdio:'pipe'}));
  await verifyPackage(f.packageRoot,f.sourceRoot);
});
async function makeLink(t,target,destination,type='file'){
  try{await symlink(target,destination,type);return true;}
  catch(error){
    if(process.platform==='win32'&&['EPERM','EACCES','ENOTSUP'].includes(error.code)){
      t.skip('Windows does not allow file symlinks for this user; mandatory symlink coverage runs on Ubuntu CI.');return false;
    }
    throw error;
  }
}
async function bundleFiles(f,links=false,t){
  for(const file of packageFiles){
    const destination=path.join(f.bundleRoot,file),source=path.join(f.packageRoot,file);
    await mkdir(path.dirname(destination),{recursive:true});
    if(links){if(!await makeLink(t,source,destination))return false;}
    else await copyFile(source,destination);
  }
  return true;
}
test('direct link policy accepts only the corresponding approved absolute/relative target, on every OS',()=>{
  const packageRoot=path.resolve('.migration-package'),file='runtime/service.mjs';
  const entry=path.join(packageRoot,'output/bundle',file),target=path.join(packageRoot,file);
  assert.equal(approvedLinkTarget(file,entry,target,packageRoot),target);
  assert.equal(approvedLinkTarget(file,entry,path.relative(path.dirname(entry),target),packageRoot),target);
  for(const unsafe of [entry,path.join(packageRoot,'missing.mjs'),path.join(packageRoot,'backend/credentials.json'),
    path.resolve(file),path.join(packageRoot,'runtime/server.mjs'),path.resolve('.migration-package-evil',file),
    path.resolve('../outside',file)])assert.throws(()=>approvedLinkTarget(file,entry,unsafe,packageRoot));
  assert.throws(()=>approvedLinkTarget('backend/credentials.json',entry,target,packageRoot));
});
test('regular package and bundle retain exact allowlist, content and review target',async t=>{
  const f=await fixture(t);
  await verifyPackage(f.packageRoot,f.sourceRoot);
  await bundleFiles(f);
  assert.equal(await materializeBundle(f.bundleRoot,f.packageRoot,f.sourceRoot),0);
  await verifyPackage(f.bundleRoot,f.sourceRoot);
});
test('CLI absolute source links are rejected by strict verifier and materialized without changing sources',async t=>{
  const f=await fixture(t);if(!await bundleFiles(f,true,t))return;
  const links=await diagnoseLinks(f.bundleRoot);assert.equal(links.length,packageFiles.length);
  for(const link of links)assert.equal(link.target,path.join(f.packageRoot,path.relative(f.bundleRoot,link.path)));
  await assert.rejects(verifyPackage(f.bundleRoot,f.sourceRoot),/Symlink in package/);
  assert.equal(await materializeBundle(f.bundleRoot,f.packageRoot,f.sourceRoot),packageFiles.length);
  for(const file of packageFiles){
    assert.equal((await lstat(path.join(f.bundleRoot,file))).isSymbolicLink(),false);
    assert.deepEqual(await readFile(path.join(f.bundleRoot,file)),await readFile(path.join(f.sourceRoot,file)));
    assert.equal((await lstat(path.join(f.packageRoot,file))).isSymbolicLink(),false);
  }
  assert.equal((await diagnoseLinks(f.bundleRoot)).length,0);
});
test('relative direct link to corresponding prepared file can be materialized',async t=>{
  const f=await fixture(t);await bundleFiles(f);
  const entry=path.join(f.bundleRoot,'app.yml');await unlink(entry);
  if(!await makeLink(t,path.relative(path.dirname(entry),path.join(f.packageRoot,'app.yml')),entry))return;
  assert.equal(await materializeBundle(f.bundleRoot,f.packageRoot,f.sourceRoot),1);
});
for(const mode of ['outside-package','outside-workspace','broken','wrong-allowlisted-file','private','cycle']){
  test(`reject ${mode} bundle link without touching any valid link`,async t=>{
    const f=await fixture(t);if(!await bundleFiles(f,true,t))return;
    const entry=path.join(f.bundleRoot,'runtime/service.mjs');await unlink(entry);
    const target={
      'outside-package':path.join(f.sourceRoot,'runtime/service.mjs'),
      'outside-workspace':path.join(f.temporary,'outside-source.mjs'),
      broken:path.join(f.packageRoot,'missing.mjs'),
      'wrong-allowlisted-file':path.join(f.packageRoot,'runtime/server.mjs'),
      private:path.join(f.packageRoot,'backend/credentials.json'),
      cycle:entry,
    }[mode];
    // No real secret file is created or read. These are synthetic link metadata.
    if(!await makeLink(t,target,entry))return;
    const first=path.join(f.bundleRoot,'app.yml'),unchanged=await readlink(first);
    await assert.rejects(materializeBundle(f.bundleRoot,f.packageRoot,f.sourceRoot));
    assert.equal(await readlink(first),unchanged);assert.equal(await readlink(entry),target);
  });
}
test('source link chain cannot turn a private target into an allowed source',async t=>{
  const f=await fixture(t);if(!await bundleFiles(f,true,t))return;
  const source=path.join(f.packageRoot,'runtime/service.mjs');await unlink(source);
  if(!await makeLink(t,path.join(f.packageRoot,'backend/credentials.json'),source))return;
  await assert.rejects(materializeBundle(f.bundleRoot,f.packageRoot,f.sourceRoot),/Symlink/);
});
test('symlink in original approved source is rejected before dereferencing',async t=>{
  const f=await fixture(t);await bundleFiles(f);
  const source=path.join(f.sourceRoot,'runtime/service.mjs');await unlink(source);
  if(!await makeLink(t,path.join(f.sourceRoot,'backend/credentials.json'),source))return;
  await assert.rejects(materializeBundle(f.bundleRoot,f.packageRoot,f.sourceRoot),/Symlink/);
});
test('linked directory and linked bundle root are never traversed',async t=>{
  const f=await fixture(t);
  await mkdir(path.join(f.packageRoot,'output'),{recursive:true});
  if(!await makeLink(t,f.packageRoot,f.bundleRoot,process.platform==='win32'?'junction':'dir'))return;
  await assert.rejects(verifyPackage(f.bundleRoot,f.sourceRoot),/Symlink/);
  await assert.rejects(materializeBundle(f.bundleRoot,f.packageRoot,f.sourceRoot),/Symlink/);
  const links=await diagnoseLinks(f.bundleRoot);assert.equal(links.length,1);
});
test('linked output ancestor cannot hide a regular bundle outside the authorized package',async t=>{
  const f=await fixture(t),external=path.join(f.temporary,'external-output');
  await mkdir(path.join(external,'bundle'),{recursive:true});
  if(!await makeLink(t,external,path.join(f.packageRoot,'output'),process.platform==='win32'?'junction':'dir'))return;
  await assert.rejects(verifyPackage(f.bundleRoot,f.sourceRoot),/Symlink/);
  await assert.rejects(materializeBundle(f.bundleRoot,f.packageRoot,f.sourceRoot),/Symlink/);
});
test('regular files with different content, extra files and production target still fail',async t=>{
  const f=await fixture(t);await bundleFiles(f);
  await writeFile(path.join(f.bundleRoot,'runtime/service.mjs'),'changed');
  await assert.rejects(materializeBundle(f.bundleRoot,f.packageRoot,f.sourceRoot),/differs/);
  await copyFile(path.join(f.packageRoot,'runtime/service.mjs'),path.join(f.bundleRoot,'runtime/service.mjs'));
  await writeFile(path.join(f.bundleRoot,'unexpected.txt'),'unexpected');
  await assert.rejects(verifyPackage(f.bundleRoot,f.sourceRoot),/Unexpected/);
  await unlink(path.join(f.bundleRoot,'unexpected.txt'));
  const manifest=JSON.parse(await readFile(path.join(f.sourceRoot,'app.yml'),'utf8'));manifest.schema='ADS_PROD';
  for(const root of [f.sourceRoot,f.packageRoot,f.bundleRoot])await writeFile(path.join(root,'app.yml'),JSON.stringify(manifest));
  await assert.rejects(materializeBundle(f.bundleRoot,f.packageRoot,f.sourceRoot));
  await assert.rejects(verifyPackage(f.bundleRoot,f.sourceRoot));
});
test('secret scanning remains mandatory even for regular allowlisted files',async t=>{
  const f=await fixture(t);await bundleFiles(f);
  const synthetic=JSON.stringify({type:'service_account',private_key:'synthetic-not-a-key'});
  for(const root of [f.sourceRoot,f.packageRoot,f.bundleRoot])await writeFile(path.join(root,'runtime/reference.json'),synthetic);
  await assert.rejects(materializeBundle(f.bundleRoot,f.packageRoot,f.sourceRoot),/Possible secret/);
  await assert.rejects(verifyPackage(f.bundleRoot,f.sourceRoot),/Possible secret/);
});
test('diagnostic enumerates links without traversing directories or reading a broken target',async t=>{
  const f=await fixture(t);await mkdir(f.bundleRoot,{recursive:true});
  if(!await makeLink(t,'missing-target',path.join(f.bundleRoot,'broken')))return;
  if(!await makeLink(t,f.sourceRoot,path.join(f.bundleRoot,'directory'),process.platform==='win32'?'junction':'dir'))return;
  const links=await diagnoseLinks(f.bundleRoot);
  assert.equal(links.length,2);assert.ok(links.some(link=>link.target==='missing-target'));
});
test('workflows inspect then materialize then strictly verify; deployment remains manually gated',async()=>{
  for(const file of ['ci.yml','deploy-review.yml']){
    const source=await readFile('.github/workflows/'+file,'utf8');
    const bundled=source.indexOf('run: snow app bundle')>=0?source.indexOf('run: snow app bundle'):source.indexOf('          snow app bundle');
    const diagnostic=source.indexOf('run: node migration/diagnose-package-links.mjs');
    const materialized=source.indexOf('run: node migration/materialize-bundle.mjs');
    const verified=source.indexOf('run: node migration/verify-package.mjs .migration-package/output/bundle');
    assert.ok(bundled>=0&&diagnostic>bundled&&materialized>diagnostic&&verified>materialized,file);
    if(file==='ci.yml')assert.ok(!source.includes('snow app deploy'));
    else{
      assert.ok(source.includes('workflow_dispatch:'));
      assert.ok(source.includes("if: ${{ inputs.operation == 'deploy' }}"));
      assert.ok(source.includes('inputs.reviewed_plan && vars.ENABLE_SNOWFLAKE_REVIEW_DEPLOY'));
    }
  }
});
