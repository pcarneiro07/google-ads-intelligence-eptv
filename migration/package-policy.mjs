import {lstat,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {forbiddenPath,sensitiveContent} from './check-publication.mjs';

export const packageFiles=Object.freeze(['app.yml','package.json','package-lock.json','migration/build.mjs','frontend/index.html',
  ...['classification.mjs','google-ads.mjs','service.mjs','server.mjs','reference.json'].map(f=>'runtime/'+f)].sort());
const directories=new Set(packageFiles.flatMap(file=>{
  const parts=file.split('/');return parts.slice(0,-1).map((_,i)=>parts.slice(0,i+1).join('/'));
}));

// Check each ancestor without following links, including a link used as the root.
export async function plainPath(trustedRoot,target,type='file'){
  trustedRoot=path.resolve(trustedRoot);target=path.resolve(target);
  const relative=path.relative(trustedRoot,target);
  assert.ok(relative!== '..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative),'Path outside authorized root');
  const parts=relative?relative.split(path.sep):[];
  let current=trustedRoot;
  for(let i=0;i<=parts.length;i++){
    const info=await lstat(current);
    assert.ok(!info.isSymbolicLink(),'Symlink in authorized source path: '+current);
    const needsDirectory=i<parts.length||type==='directory';
    assert.ok(needsDirectory?info.isDirectory():info.isFile(),'Non-regular authorized path: '+current);
    if(i<parts.length)current=path.join(current,parts[i]);
  }
}

export async function listPackage(root,{allowFileLinks=false,skipOutput=false}={}){
  const files=[];
  async function visit(dir,prefix=''){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      const name=prefix+entry.name;
      const info=await lstat(path.join(dir,entry.name));
      if(skipOutput&&name==='output'){
        assert.ok(info.isDirectory()&&!info.isSymbolicLink(),'Invalid CLI output directory');continue;
      }
      assert.ok(!forbiddenPath(name),'Private entry in package: '+name);
      if(info.isDirectory()){
        assert.ok(directories.has(name),'Unexpected directory in package: '+name);
        await visit(path.join(dir,entry.name),name+'/');
      }else{
        assert.ok(packageFiles.includes(name),'Unexpected file in package: '+name);
        assert.ok(allowFileLinks||!info.isSymbolicLink(),'Symlink in package: '+name);
        assert.ok(info.isFile()||(allowFileLinks&&info.isSymbolicLink()),'Non-regular package entry: '+name);
        files.push(name);
      }
    }
  }
  await visit(root);
  assert.deepEqual(files.sort(),packageFiles,'Package must match the reviewed source allowlist');
  return files;
}

export async function approvedContent(root,file){
  assert.ok(packageFiles.includes(file)&&!forbiddenPath(file),'Source is not allowlisted');
  await plainPath(root,path.join(root,file));
  const content=await readFile(path.join(root,file));
  assert.ok(!sensitiveContent(content.toString('utf8')),'Possible secret in allowed package source: '+file);
  return content;
}

export function reviewManifest(content){
  const manifest=JSON.parse(content.toString('utf8'));
  assert.equal(manifest.name,'GOOGLE_ADS_INTELLIGENCE_REVIEW');
  assert.equal(manifest.database,'EPTV_APPS');
  assert.equal(manifest.schema,'ADS_REVIEW');
  assert.equal(manifest.build_job_location,'EPTV_APPS.ADS_BUILDS');
  assert.ok(!manifest.targets,'Alternate deployment targets are not approved');
}
