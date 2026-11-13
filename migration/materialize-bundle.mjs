import {lstat,readlink,realpath,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {packageFiles,plainPath,listPackage,approvedContent,reviewManifest} from './package-policy.mjs';
import {verifyPackage} from './verify-package.mjs';

// Snowflake CLI 3.33.0 symlinks regular source files on Linux. Materialize ONLY
// direct links to the corresponding approved source in the isolated package.
// Never follow a bundle link to read its content and never use recursive cp -L.
export function approvedLinkTarget(file,entry,link,packageRoot){
  assert.ok(packageFiles.includes(file),'Link entry is not allowlisted');
  const target=path.resolve(path.dirname(entry),link);
  assert.equal(target,path.join(path.resolve(packageRoot),file),'Bundle link is not its corresponding approved source: '+file);
  return target;
}
export async function materializeBundle(bundleRoot,packageRoot,sourceRoot=process.cwd()){
  sourceRoot=path.resolve(sourceRoot);packageRoot=path.resolve(packageRoot);bundleRoot=path.resolve(bundleRoot);
  assert.equal(packageRoot,path.join(sourceRoot,'.migration-package'),'Unexpected source package root');
  assert.equal(bundleRoot,path.join(packageRoot,'output','bundle'),'Unexpected CLI bundle root');
  await plainPath(sourceRoot,bundleRoot,'directory');
  await listPackage(packageRoot,{skipOutput:true});
  const files=await listPackage(bundleRoot,{allowFileLinks:true});
  const replacements=[];
  // Validate every source and every mapping before making the first change.
  for(const file of files){
    const original=await approvedContent(sourceRoot,file);
    const content=await approvedContent(packageRoot,file);
    assert.deepEqual(content,original,'Prepared source differs: '+file);
    if(file==='app.yml')reviewManifest(content);
    const entry=path.join(bundleRoot,file),info=await lstat(entry);
    if(info.isSymbolicLink()){
      const link=await readlink(entry),target=approvedLinkTarget(file,entry,link,packageRoot);
      // Source ancestors are already checked by approvedContent; no chained,
      // broken, directory, external or credential link can pass these checks.
      assert.equal(await realpath(entry),target,'Unexpected resolved link target: '+file);
      replacements.push({entry,link,content});
    }else{
      assert.deepEqual(await approvedContent(bundleRoot,file),original,'Bundled source differs: '+file);
    }
  }
  for(const {entry,link,content} of replacements){
    await plainPath(sourceRoot,path.dirname(entry),'directory');
    assert.equal(await readlink(entry),link,'Bundle link changed during verification');
    const temporary=path.join(path.dirname(entry),'.materialize-'+randomUUID());
    try{
      await writeFile(temporary,content,{flag:'wx',mode:0o644});
      // Rename replaces the symlink itself, not its destination.
      await rename(temporary,entry);
    }finally{
      await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
  }
  await verifyPackage(bundleRoot,sourceRoot); // Strict verification stays mandatory.
  return replacements.length;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const count=await materializeBundle(process.argv[2]||'.migration-package/output/bundle',process.argv[3]||'.migration-package');
  console.log(`Materialized ${count} validated CLI source links. Final bundle contains only regular files.`);
}
