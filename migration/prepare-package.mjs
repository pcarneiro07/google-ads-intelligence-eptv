import {writeFile,mkdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {packageFiles,approvedContent,reviewManifest} from './package-policy.mjs';

// Positive allowlist: no recursive copy, zip of workspace, or gitignore reliance.
const files=packageFiles;
const destination=path.resolve('.migration-package');
try{await lstat(destination);throw new Error('Package directory already exists. Review it or rename it before preparing another package.');}
catch(error){if(error.code!=='ENOENT')throw error;}
const contents=new Map();
for(const file of files){
  const content=await approvedContent(process.cwd(),file);
  if(file==='app.yml')reviewManifest(content);
  contents.set(file,content);
}
for(const file of files){
  const target=path.join(destination,file);
  await mkdir(path.dirname(target),{recursive:true});await writeFile(target,contents.get(file),{flag:'wx'});
}
console.log('Review package prepared from explicit allowlist: '+files.length+' files. No deployment executed.');
