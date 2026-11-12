import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,verify} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import {GoogleAds} from '../../runtime/google-ads.mjs';
import {createServer} from '../../runtime/server.mjs';
import {forbiddenPath,sensitiveContent} from '../check-publication.mjs';

test('generated ephemeral service-account JWT, fixed endpoints, token reuse and rotation — no production key',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'ads-synthetic-'));
  try{
    const key=generateKeyPairSync('rsa',{modulusLength:2048});
    const secretPath=join(temp,'synthetic-secret');
    const credentials={type:'service_account',client_email:'synthetic@example.invalid',private_key:key.privateKey.export({type:'pkcs8',format:'pem'}),token_uri:'https://oauth2.googleapis.com/token'};
    await writeFile(secretPath,JSON.stringify(credentials));
    let issued=0;
    const client=new GoogleAds({secretPath,fetchImpl:async(url,options)=>{
      assert.equal(url,'https://oauth2.googleapis.com/token');assert.equal(options.redirect,'error');
      const jwt=options.body.get('assertion'),[header,payload,signature]=jwt.split('.');
      assert.ok(verify('RSA-SHA256',Buffer.from(header+'.'+payload),key.publicKey,Buffer.from(signature,'base64url')));
      const claims=JSON.parse(Buffer.from(payload,'base64url'));
      assert.equal(claims.scope,'https://www.googleapis.com/auth/adwords');assert.equal(claims.aud,url);
      issued++;return {ok:true,json:async()=>({access_token:'synthetic-token-'+issued,expires_in:3600})};
    }});
    await client.accessToken();await client.accessToken();assert.equal(issued,1);
    credentials.client_email='rotated@example.invalid';await writeFile(secretPath,JSON.stringify(credentials));
    await client.accessToken();assert.equal(issued,2);
    credentials.token_uri='https://example.invalid/token';await writeFile(secretPath,JSON.stringify(credentials));
    await assert.rejects(client.accessToken(),/indisponível ou inválido/);assert.equal(issued,2);
  }finally{await rm(temp,{recursive:true,force:true});}
});
test('SearchStream reads every batch, never mutates Ads and never exposes an error body',async()=>{
  let calls=0;
  const client=new GoogleAds({fetchImpl:async(url,options)=>{
    calls++;assert.match(url,/^https:\/\/googleads\.googleapis\.com\/v26\/customers\/7182459480\/googleAds:searchStream$/);
    assert.equal(options.method,'POST');assert.equal(options.headers['login-customer-id'],'9234046127');
    return {ok:true,json:async()=>[{results:Array.from({length:100001},(_,i)=>({id:i}))},{results:[{id:100001}]}]};
  }});
  client.accessToken=async()=>'synthetic';
  assert.equal((await client.gaql('7182459480','SELECT campaign.id FROM campaign')).length,100002);
  await assert.rejects(client.gaql('7182459480','UPDATE campaign SET status = PAUSED'));
  assert.equal(calls,1);
  client.fetchImpl=async()=>({ok:false,status:403,headers:new Headers({'request-id':'safe-request'}),json:async()=>{throw new Error('must not inspect raw body')}});
  await assert.rejects(client.gaql('7182459480','SELECT campaign.id FROM campaign'),/HTTP 403; request-id=safe-request/);
  client.fetchImpl=async()=>({ok:true,json:async()=>[{results:[]},{error:{private_key:'synthetic'}}]});
  await assert.rejects(client.gaql('7182459480','SELECT campaign.id FROM campaign'),/incompleto/);
});
test('HTTP: local loopback protections and deployed Snowflake session/origin boundaries',async()=>{
  // Native HTTP preserves Host explicitly (fetch can normalize it).
  const request=(url,options)=>new Promise((resolve,reject)=>{
    const req=http.request(url,options,res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,text:async()=>Buffer.concat(chunks).toString('utf8')}));
    });req.on('error',reject);req.end();
  });
  for(const deployed of [false,true]){
    let calls=0;
    const service={ttl:900,fetch:async()=>{calls++;return {ok:true}}};
    const server=createServer({service,html:Buffer.from('<html>synthetic</html>'),deployed,secretAvailable:()=>false});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const port=server.address().port,base=`http://127.0.0.1:${port}`;
    const host=deployed?'review.snowflakecomputing.app':`127.0.0.1:${port}`;
    const headers={host,...(deployed?{'Sf-Context-Current-User-Token':'synthetic-platform-context'}:{})};
    try{
      const get=(path,extra={})=>request(base+path,{headers:{...headers,...extra}});
      assert.equal((await get('/')).status,200);
      assert.equal((await get('/api/status')).status,200);assert.equal(calls,0);
      for(const path of ['/backend/.env','/backend/credentials.json','/runtime/reference.json','/dados_privados/file.json','/app.yml'])assert.equal((await get(path)).status,404);
      assert.equal((await get('/api/relatorios')).status,403);
      assert.equal((await get('/api/relatorios',{'X-Ads-Request':'dashboard'})).status,200);
      const post=origin=>request(base+'/api/atualizar',{method:'POST',headers:{...headers,'X-Ads-Request':'dashboard',Origin:origin}});
      assert.equal((await post('https://attacker.invalid')).status,403);
      assert.equal((await post((deployed?'https://':'http://')+host)).status,200);
      if(deployed)assert.equal((await get('/api/status',{'Sf-Context-Current-User-Token':''})).status,401);
      assert.equal((await get('/api/status',{host:'attacker.invalid'})).status,403);
      service.fetch=async()=>{throw new Error('synthetic-sensitive-secret');};
      const failure=await get('/api/relatorios',{'X-Ads-Request':'dashboard'});
      assert.equal(failure.status,502);assert.ok(!(await failure.text()).includes('synthetic-sensitive-secret'));
    }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }
});
test('publication guard rejects local backups, secrets and corporate audit artifacts',()=>{
  for(const path of ['backend/.env','backend/.env.bak','backend/credentials.json','backend/credentials.json.bak','backups/copy.py',
    'backend/dados_privados/file.json','frontend/index_v6_backup.html','backend/extrair_google_ads.py.bak-20261112',
    'docs/AUDITORIA_CLASSIFICACAO.md','docs/CLASSIFICACAO_PROGRAMAS.md','key.pem'])assert.equal(forbiddenPath(path),true,path);
  for(const path of ['backend/programas.json','runtime/reference.json','docs/BASELINE_VALIDADA.md'])assert.equal(forbiddenPath(path),false,path);
  assert.equal(sensitiveContent('ordinary source'),false);
});
test('manifest is valid YAML (JSON syntax), single instance, Snowflake Secret and restricted review target',async()=>{
  const manifest=JSON.parse(await readFile('app.yml','utf8'));
  assert.equal(manifest.version,2);assert.equal(manifest.min_instances,1);assert.equal(manifest.max_instances,1);
  assert.equal(manifest.schema,'ADS_REVIEW');assert.equal(manifest.auto_suspend_secs,900);
  assert.deepEqual(manifest.external_access_integrations,['EPTV_GOOGLE_ADS_EAI']);
  assert.equal(manifest.secrets[0].name,'GOOGLE_ADS_SERVICE_ACCOUNT');
  assert.ok(!JSON.stringify(manifest).includes('private_key'));
  assert.ok(!manifest.environment_variables.some(v=>['PORT','HOSTNAME'].includes(v.name)));
});
test('cloud build preserves all CSS and frontend behavior except explicit hosting wording',async()=>{
  execFileSync(process.execPath,['migration/build.mjs']);
  const local=await readFile('frontend/index.html','utf8'),cloud=await readFile('dist/index.html','utf8');
  assert.equal(cloud.split('<style>')[1].split('</style>')[0],local.split('<style>')[1].split('</style>')[0]);
  assert.ok(cloud.includes('class="dayvalue"'));assert.ok(cloud.includes('id="dateStart"'));
  assert.ok(!cloud.includes('Os dados ficam no seu computador'));
  assert.ok(!cloud.includes('05_iniciar_dashboard_local'));
  const canonical=s=>s.replaceAll('Conectando ao Snowflake App Runtime','Conectando ao servidor local')
    .replaceAll('Snowflake App Runtime indisponível','Servidor local indisponível')
    .replaceAll('Atualize a aplicação Snowflake para habilitar o calendário','Reinicie o servidor para habilitar o calendário')
    .replaceAll(' • Contate a equipe responsável pela aplicação Snowflake.',' • Execute scripts\\\\05_iniciar_dashboard_local.ps1 com a atualização V6.1.');
  assert.equal(canonical(cloud.split('<script>')[1].split('</script>')[0]),local.split('<script>')[1].split('</script>')[0]);
});
