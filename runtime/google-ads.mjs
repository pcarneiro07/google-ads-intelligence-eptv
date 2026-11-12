import {readFile} from 'node:fs/promises';
import {createHash,createSign} from 'node:crypto';

const TOKEN_URL='https://oauth2.googleapis.com/token';
const ADS_HOST='https://googleads.googleapis.com';
const SCOPE='https://www.googleapis.com/auth/adwords';
// Read the mounted generic secret fresh before each use; rotation invalidates the token.
export class GoogleAds {
  constructor({secretPath='/secrets/GOOGLE_ADS_SERVICE_ACCOUNT/secret_string',fetchImpl=fetch,clock=Date.now,apiVersion='v26',manager='9234046127'}={}){
    Object.assign(this,{secretPath,fetchImpl,clock,apiVersion,manager});
    this.token=null;this.fingerprint=null;this.expires=0;
    if(!/^v\d+$/.test(apiVersion)||!/^\d{10}$/.test(manager))throw new Error('Configuração Ads inválida.');
  }
  async accessToken(){
    let content,credentials;
    try{
      content=await readFile(this.secretPath,'utf8');credentials=JSON.parse(content);
      if(credentials.type!=='service_account'||typeof credentials.client_email!=='string'||typeof credentials.private_key!=='string')throw new Error();
      // Do not trust token_uri from a key document: egress is fixed to Google's token endpoint.
      if(credentials.token_uri&&credentials.token_uri!==TOKEN_URL)throw new Error();
    }catch{throw new Error('Snowflake Secret da conta de serviço indisponível ou inválido.');}
    const fingerprint=createHash('sha256').update(content).digest('hex');
    if(this.token&&fingerprint===this.fingerprint&&this.expires>this.clock()+60000)return this.token;
    const now=Math.floor(this.clock()/1000);
    const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:credentials.client_email,scope:SCOPE,aud:TOKEN_URL,iat:now,exp:now+3600});
    let assertion;
    try{assertion=unsigned+'.'+createSign('RSA-SHA256').update(unsigned).sign(credentials.private_key,'base64url');}
    catch{throw new Error('Chave de assinatura do Snowflake Secret inválida.');}
    const response=await this.fetchImpl(TOKEN_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
    if(!response.ok)throw new Error(`Autenticação Google recusada (HTTP ${response.status}).`);
    let payload;try{payload=await response.json();}catch{throw new Error('Resposta de autenticação Google inválida.');}
    if(typeof payload.access_token!=='string'||!Number.isFinite(Number(payload.expires_in))||Number(payload.expires_in)<=0)throw new Error('Resposta de autenticação Google incompleta.');
    this.token=payload.access_token;this.fingerprint=fingerprint;this.expires=this.clock()+Number(payload.expires_in)*1000;
    return this.token;
  }
  async gaql(account,query){
    if(!/^\d{10}$/.test(account)||!/^SELECT\s/i.test(query))throw new Error('Somente consultas GAQL de leitura são permitidas.');
    const token=await this.accessToken();
    const response=await this.fetchImpl(`${ADS_HOST}/${this.apiVersion}/customers/${account}/googleAds:searchStream`,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(195000),
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','login-customer-id':this.manager},body:JSON.stringify({query})});
    // Never return API bodies/headers that might contain corporate data or credentials.
    if(!response.ok){
      const requestId=response.headers.get('request-id')||response.headers.get('google-ads-request-id')||'';
      const safeId=/^[a-zA-Z0-9_-]{1,120}$/.test(requestId)?`; request-id=${requestId}`:'';
      throw new Error(`Google Ads API HTTP ${response.status}${safeId}. Consulta obrigatória não concluída.`);
    }
    let batches;try{batches=await response.json();}catch{throw new Error('Resposta Google Ads inválida.');}
    if(!Array.isArray(batches))throw new Error('Resposta SearchStream inválida.');
    const rows=[];
    for(const batch of batches){
      if(!batch||typeof batch!=='object'||Array.isArray(batch)||batch.error||!Array.isArray(batch.results??[]))throw new Error('Lote SearchStream inválido ou incompleto.');
      for(const row of batch.results||[])rows.push(row);
    }
    return rows;
  }
}
