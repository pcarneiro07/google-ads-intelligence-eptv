import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {plainPath,listPackage,approvedContent,reviewManifest} from './package-policy.mjs';

// Inspect names before reading; never open an unexpected credential file.
export async function verifyPackage(root,sourceRoot=process.cwd()){
  root=path.resolve(root);sourceRoot=path.resolve(sourceRoot);
  await plainPath(sourceRoot,root,'directory');
  const files=await listPackage(root);
  for(const file of files){
    const content=await approvedContent(root,file);
    assert.deepEqual(content,await approvedContent(sourceRoot,file),'Packaged source differs: '+file);
  }
  reviewManifest(await approvedContent(root,'app.yml'));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  await verifyPackage(process.argv[2]||'.migration-package');
  console.log('Package verified: no symlinks, exact source allowlist and exclusive homologation target.');
}
