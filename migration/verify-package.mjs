import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {sensitiveContent} from './check-publication.mjs';

// Inspect names before reading; never open an unexpected credential file.
const expected=['app.yml','package.json','package-lock.json','migration/build.mjs','frontend/index.html',
  ...['classification.mjs','google-ads.mjs','service.mjs','server.mjs','reference.json'].map(f=>'runtime/'+f)].sort();
const root=path.resolve(process.argv[2]||'.migration-package');
async function list(dir,prefix=''){
  const files=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const name=prefix+entry.name;
    assert.ok(!entry.isSymbolicLink(),'Symlink in package');
    if(entry.isDirectory())files.push(...await list(path.join(dir,entry.name),name+'/'));
    else {assert.ok(entry.isFile(),'Non-regular package entry');files.push(name);}
  }
  return files;
}
assert.deepEqual((await list(root)).sort(),expected,'Package must match the reviewed source allowlist');
for(const file of expected){
  const content=await readFile(path.join(root,file));
  assert.ok(!sensitiveContent(content.toString('utf8')),'Possible secret in allowed package source');
  assert.deepEqual(content,await readFile(file),'Packaged source differs: '+file);
}
const manifest=JSON.parse(await readFile(path.join(root,'app.yml'),'utf8'));
assert.equal(manifest.name,'GOOGLE_ADS_INTELLIGENCE_REVIEW');
assert.equal(manifest.database,'EPTV_APPS');
assert.equal(manifest.schema,'ADS_REVIEW');
assert.equal(manifest.build_job_location,'EPTV_APPS.ADS_BUILDS');
assert.ok(!manifest.targets,'Alternate deployment targets are not approved');
console.log('Package verified: exact source allowlist and exclusive homologation target.');
