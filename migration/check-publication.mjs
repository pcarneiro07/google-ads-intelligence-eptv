import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

export function forbiddenPath(path){
  return /(^|\/)(?:\.env[^/]*|[^/]*credentials[^/]*|dados_privados|snapshots|backups|node_modules|\.venv)(\/|$)/i.test(path)||
    /(?:\.bak[^/]*|_backup\.[^/]*|\.(?:pem|key|p12|pfx|zip|csv|xlsx|parquet|jsonl|ndjson|log))$/i.test(path)||
    /(?:snapshot|service_account)[^/]*\.json[^/]*$/i.test(path)||
    /(?:^|\/)(?:connections|config)\.toml$/.test(path)||
    /^docs\/(?:AUDITORIA_CLASSIFICACAO|CLASSIFICACAO_PROGRAMAS)\.md$/.test(path);
}
export function sensitiveContent(content){
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)||
    /"type"\s*:\s*"service_account"[\s\S]*?"private_key"\s*:/.test(content)||
    /(?:ya29\.[A-Za-z0-9_-]{15,}|gh[pousr]_[A-Za-z0-9]{25,})/.test(content);
}

export function checkTracked(){
  // Inspect tracked files ONLY. Never traverse a credential directory or read .env.
  const paths=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
  const bad=paths.filter(forbiddenPath);
  if(bad.length)throw new Error('Arquivos privados no índice Git: '+bad.join(', '));
  for(const path of paths)if(sensitiveContent(readFileSync(path,'utf8')))throw new Error('Possível segredo em arquivo versionado: '+path);
  console.log(`Publication check passed: ${paths.length} tracked files. Secret values never printed.`);
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/check-publication.mjs'))checkTracked();
