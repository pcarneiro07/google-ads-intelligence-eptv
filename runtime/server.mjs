import http from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {GoogleAds} from './google-ads.mjs';
import {AdsService,reference,localDate,parseDate,isoDay,PERIODS} from './service.mjs';

const HEADERS={
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
export function createServer({service,html=readFileSync(new URL('./index.html',import.meta.url)),
  deployed=false,secretAvailable=()=>existsSync('/secrets/GOOGLE_ADS_SERVICE_ACCOUNT/secret_string'),now=()=>new Date()}={}){
  if(!service)throw new Error('Serviço de dados obrigatório.');
  return http.createServer(async(req,res)=>{
    function send(value,status=200,mime='application/json; charset=utf-8'){
      const body=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
      res.writeHead(status,{...HEADERS,'Content-Type':mime,'Content-Length':body.length});res.end(body);
    }
    const host=req.headers.host||'';
    const port=req.socket.localPort;
    const hostAllowed=deployed?/^[a-zA-Z0-9-]+\.snowflakecomputing\.app$/.test(host):[ `127.0.0.1:${port}`,`localhost:${port}`].includes(host);
    if(!hostAllowed)return send({erro:'Host não permitido'},403);
    // Snowflake is the authentication boundary. The service has no anonymous route to Ads.
    if(deployed&&!req.headers['sf-context-current-user-token'])return send({erro:'Sessão Snowflake autenticada obrigatória'},401);
    let url;try{url=new URL(req.url,'http://localhost');}catch{return send({erro:'URL inválida'},400);}
    const path=url.pathname;
    if(req.method==='GET'&&(path==='/'||path==='/index.html'))return send(html,200,'text/html; charset=utf-8');
    if(req.method==='GET'&&path==='/api/status')return send({modo:'api_dinamica',credenciais_configuradas:secretAvailable(),
      customer_id:'7182459480',customer_ids:Object.keys(reference.accounts),gerenciadora_configurada:true,
      periodos:PERIODS,rede:'ALL',intervalo_personalizado:true,data_maxima:isoDay(parseDate(localDate(now()))-86400000),
      max_dias_intervalo:null,cache_segundos:service.ttl});
    const read=req.method==='GET'&&path==='/api/relatorios',update=req.method==='POST'&&path==='/api/atualizar';
    if(read||update){
      if(req.headers['x-ads-request']!=='dashboard')return send({erro:'Requisição não autorizada'},403);
      if(update){
        const allowed=deployed?[`https://${host}`]:[`http://127.0.0.1:${port}`,`http://localhost:${port}`];
        if(!allowed.includes(req.headers.origin))return send({erro:'Origem não permitida'},403);
      }
      try{return send(await service.fetch(url.searchParams,update));}
      catch(error){
        // Detailed Google errors are already sanitized by the reader; never send raw exceptions.
        if(error instanceof RangeError)return send({erro:error.message},400);
        return send({erro:'Consulta completa indisponível. Verifique Secret, permissões e External Access Integration.',tipo:'GoogleAdsReadError'},502);
      }
    }
    return send({erro:'Rota não encontrada'},req.method==='GET'?404:405);
  });
}

export function start(){
  const deployed=process.env.ADS_RUNTIME_MODE==='snowflake';
  if(deployed&&(!process.env.SNOWFLAKE_SERVICE_NAME||!existsSync('/snowflake/session/token')))throw new Error('Modo Snowflake requer execução dentro do App Runtime.');
  const reader=new GoogleAds({apiVersion:reference.apiVersion,manager:reference.manager});
  const service=new AdsService({reader,ttl:process.env.ADS_DASHBOARD_CACHE_SECONDS||900});
  const port=Number(process.env.PORT||(deployed?8080:8766));
  const hostname=deployed?process.env.HOSTNAME:'127.0.0.1';
  if(!hostname||!Number.isInteger(port)||port<1||port>65535)throw new Error('Endereço de execução inválido.');
  const server=createServer({service,deployed});
  server.listen(port,hostname,()=>console.log('Google Ads Intelligence: serviço iniciado; somente leitura.'));
  process.once('SIGTERM',()=>server.close());process.once('SIGINT',()=>server.close());
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)start();
