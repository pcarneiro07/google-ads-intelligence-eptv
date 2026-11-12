import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const ref=JSON.parse(await readFile('runtime/reference.json','utf8'));
const html=await readFile('frontend/index.html');
if(createHash('sha256').update(html.toString('utf8').replaceAll('\r\n','\n')).digest('hex')!==ref.sourceHashes['frontend/index.html'])throw new Error('Frontend divergiu da referência revisada. Regere e revise o contrato.');
await mkdir('dist',{recursive:true});
for(const file of ['server.mjs','service.mjs','classification.mjs','google-ads.mjs','reference.json'])await copyFile('runtime/'+file,'dist/'+file);
// Only wording about hosting changes. CSS, markup, graphs and application logic remain.
const cloud=html.toString('utf8')
  .replace('Os dados ficam no seu computador: nenhuma credencial é enviada ao navegador, Vercel ou serviços externos.',
    'Os dados são processados no Snowflake App Runtime e exibidos somente a usuários autorizados. As credenciais ficam em Snowflake Secrets e não são enviadas ao navegador.')
  .replaceAll('Conectando ao servidor local','Conectando ao Snowflake App Runtime')
  .replaceAll('Servidor local indisponível','Snowflake App Runtime indisponível')
  .replaceAll('Reinicie o servidor para habilitar o calendário','Atualize a aplicação Snowflake para habilitar o calendário')
  .replaceAll(' • Execute scripts\\\\05_iniciar_dashboard_local.ps1 com a atualização V6.1.',' • Contate a equipe responsável pela aplicação Snowflake.');
await writeFile('dist/index.html',cloud);
console.log('Built Node runtime. No credentials, snapshots, or private audits copied.');
