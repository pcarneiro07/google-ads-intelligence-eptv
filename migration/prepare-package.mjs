import {copyFile,mkdir,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {sensitiveContent} from './check-publication.mjs';

// Positive allowlist: no recursive copy, zip of workspace, or gitignore reliance.
const files=['app.yml','package.json','package-lock.json','migration/build.mjs','frontend/index.html',
  ...['classification.mjs','google-ads.mjs','service.mjs','server.mjs','reference.json'].map(f=>'runtime/'+f)];
const destination=path.resolve('.migration-package');
try{await access(destination);throw new Error('Package directory already exists. Review it or rename it before preparing another package.');}
catch(error){if(error.code!=='ENOENT')throw error;}
for(const file of files){
  const content=await readFile(file,'utf8');
  if(sensitiveContent(content))throw new Error('Possible secret in package source: '+file);
}
for(const file of files){
  const target=path.join(destination,file);
  await mkdir(path.dirname(target),{recursive:true});await copyFile(file,target);
}
console.log('Review package prepared from explicit allowlist: '+files.length+' files. No deployment executed.');
