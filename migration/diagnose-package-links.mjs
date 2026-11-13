import {readdir,lstat,readlink} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Temporary CI diagnostic: metadata only; never read targets or follow links.
export async function diagnoseLinks(root){
  const links=[];
  async function visit(entry){
    const info=await lstat(entry);
    if(info.isSymbolicLink())links.push({path:entry,target:await readlink(entry)});
    else if(info.isDirectory())for(const name of await readdir(entry))await visit(path.join(entry,name));
  }
  await visit(path.resolve(root));
  return links;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const root=path.resolve(process.argv[2]||'.migration-package/output/bundle');
  const links=await diagnoseLinks(root);
  console.log(`Temporary bundle symlink diagnostic: ${links.length} link(s).`);
  for(const link of links)console.log(JSON.stringify(link));
}
