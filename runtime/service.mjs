import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildInventory,enrich} from './classification.mjs';

export const reference=JSON.parse(readFileSync(new URL('./reference.json',import.meta.url),'utf8'));
export const REPORTS=Object.keys(reference.reports);
export const PERIODS=[7,30,90,365];
const ONE_DAY=86400000;
const stamp=createHash('sha256').update(JSON.stringify(reference)).digest('hex');
export function localDate(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get=type=>parts.find(p=>p.type===type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function parseDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))<1)throw new RangeError('Datas inválidas. Use AAAA-MM-DD.');
  const ms=Date.parse(value+'T00:00:00Z');
  if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==value)throw new RangeError('Datas inválidas. Use AAAA-MM-DD.');
  return ms;
}
export const isoDay=ms=>new Date(ms).toISOString().slice(0,10);
export function resolvePeriod(params=new URLSearchParams(),now=new Date()){
  for(const k of ['dias','inicio','fim'])if(params.getAll(k).length>1)throw new RangeError('Parâmetros de período duplicados.');
  const last=parseDate(localDate(now))-ONE_DAY;
  let start,end;
  if(params.has('inicio')||params.has('fim')){
    if(params.has('dias')||!params.has('inicio')||!params.has('fim'))throw new RangeError('Informe início e fim juntos, sem combinar com dias.');
    start=parseDate(params.get('inicio'));end=parseDate(params.get('fim'));
  }else{
    const raw=params.get('dias')??'365';
    if(!PERIODS.map(String).includes(raw))throw new RangeError('Período inválido.');
    end=last;start=end-(Number(raw)-1)*ONE_DAY;
  }
  if(start>end)throw new RangeError('A data inicial não pode ser posterior à data final.');
  if(end>last)throw new RangeError('A data final deve ser até ontem (America/Sao_Paulo).');
  return {inicio:isoDay(start),fim:isoDay(end),dias:(end-start)/ONE_DAY+1};
}
export function queriesForDates(inicio,fim){
  parseDate(inicio);parseDate(fim);
  return Object.fromEntries(Object.entries(reference.reports).map(([name,query])=>[name,query.replaceAll('__START__',inicio).replaceAll('__END__',fim)]));
}

export class AdsService {
  constructor({reader,now=()=>new Date(),monotonic=()=>performance.now()/1000,ttl=900}={}){
    if(!reader)throw new Error('Google Ads reader obrigatório.');
    this.reader=reader;this.now=now;this.monotonic=monotonic;
    this.ttl=Math.max(300,Math.min(3600,Number(ttl)));
    if(!Number.isFinite(this.ttl))throw new Error('TTL inválido.');
    this.cache=new Map();this.inventoryCache=new Map();this.geoNames=new Map();this.queue=Promise.resolve();
  }
  async fetch(params=new URLSearchParams(),force=false){
    const period=resolvePeriod(params,this.now()); // Invalid parameters never reach Ads.
    // Equivalent to the Python RLock: serialize fills and coalesce duplicate requests.
    const task=this.queue.then(()=>this.fetchLocked(period,force));
    this.queue=task.catch(()=>{});return task;
  }
  async cities(account,reports){
    const usage=new Map();
    for(const row of reports.cidades){
      const id=String(row.segments?.geoTargetCity||'');
      if(/^geoTargetConstants\/\d+$/.test(id))usage.set(id,(usage.get(id)||0)+Number(row.metrics?.videoTrueviewViews||0));
    }
    const ids=[...usage].sort((a,b)=>b[1]-a[1]).slice(0,80).map(([id])=>id).filter(id=>!this.geoNames.has(id));
    for(let i=0;i<ids.length;i+=30){
      const clause=ids.slice(i,i+30).map(id=>`'${id}'`).join(', ');
      const query='SELECT geo_target_constant.resource_name, geo_target_constant.canonical_name, geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.resource_name IN ('+clause+')';
      try{
        for(const row of await this.reader.gaql(account,query)){
          const loc=row.geoTargetConstant||{};
          if(loc.resourceName&&(loc.canonicalName||loc.name))this.geoNames.set(String(loc.resourceName),String(loc.canonicalName||loc.name));
        }
      }catch{break;} // Optional resolution only; numeric city IDs remain in the report.
    }
    return Object.fromEntries([...usage.keys()].filter(id=>this.geoNames.has(id)).map(id=>[id,this.geoNames.get(id)]));
  }
  async fetchLocked(period,force){
    const today=localDate(this.now()),key=JSON.stringify([period.inicio,period.fim,today,stamp]);
    const entry=this.cache.get(key),age=entry?this.monotonic()-entry.at:Infinity;
    if(entry&&((!force&&age<this.ttl)||(force&&age<60)))return {...entry.payload,consulta:{origem:'cache_memoria',idade_segundos:Math.round(age),cache_ttl_segundos:this.ttl,consultado_em:entry.payload.extraido_em}};
    const reports=Object.fromEntries(REPORTS.map(k=>[k,[]])),pending=new Map(),inventories={};
    const currencies={},timezones={},queries=queriesForDates(period.inicio,period.fim);
    let lastAccount;
    for(const account of Object.keys(reference.accounts)){
      lastAccount=account;
      const details=await this.reader.gaql(account,'SELECT customer.currency_code, customer.time_zone FROM customer LIMIT 1');
      const customer=details[0]?.customer||{};
      if(!customer.currencyCode)throw new Error(`Moeda não retornada pela conta ${account}. Total consolidado não é seguro.`);
      currencies[account]=customer.currencyCode;timezones[account]=customer.timeZone||'';
      const ikey=JSON.stringify([account,today,stamp]),cached=this.inventoryCache.get(ikey);
      let inventory;
      if(cached&&!force&&this.monotonic()-cached.at<this.ttl)inventory=cached.inventory;
      else{
        const raw={};for(const [name,query] of Object.entries(reference.inventory))raw[name]=await this.reader.gaql(account,query);
        inventory=buildInventory(raw,account,reference.mapping,reference.labels,reference.version);
        pending.set(ikey,{at:this.monotonic(),inventory});
      }
      inventories[account]=inventory;
      for(const name of REPORTS)for(const row of await this.reader.gaql(account,queries[name]))reports[name].push(enrich(row,inventory,account));
    }
    if(new Set(Object.values(currencies)).size!==1)throw new Error('Contas com moedas diferentes: não é seguro consolidar investimento.');
    const cityNames=await this.cities(lastAccount,reports);
    const consulted=this.now().toISOString();
    const payload={origem:'Google Ads API — múltiplas contas e redes',versao_api:reference.apiVersion,
      customer_id:'7182459480',customer_ids:Object.keys(reference.accounts),extraido_em:consulted,
      dias:period.dias,periodo_inicio:period.inicio,periodo_fim:period.fim,filtro_rede:'ALL',
      observacoes:[
        'Agregados calculados somente a partir de campanhas; não somar relatórios dimensionais.',
        'Taxas de formato e quartis oficiais são mostradas por campanha/rede sem média simples.',
        'CPV oficial recebido em micros e convertido para a moeda da conta.',
        'Dados demográficos podem ter cobertura parcial. Sem snapshots em disco.',
        'Campanhas mistas/conflitantes permanecem pendentes em todas as dimensões; evidência por anúncio não rateia métricas.'
      ],metadata:{currency_code:Object.values(currencies)[0],currency_by_account:currencies,time_zones:timezones,
        time_zone:Object.values(timezones)[0]||'',account_names:reference.accounts,city_names:cityNames,
        classificacao_programas:{versao:reference.version,granularidade_filtros:'campanha',
          campanhas:Object.fromEntries(Object.entries(inventories).map(([account,inv])=>[account,Object.fromEntries(Object.entries(inv).map(([cid,item])=>[cid,item.classificacao]))]))}},
      relatorios:reports,erros:{}};
    for(const [k,v] of this.cache)if(this.monotonic()-v.at>=this.ttl||JSON.parse(k)[2]!==today)this.cache.delete(k);
    for(const [k,v] of this.inventoryCache)if(this.monotonic()-v.at>=this.ttl||JSON.parse(k)[1]!==today)this.inventoryCache.delete(k);
    for(const [k,v] of pending)this.inventoryCache.set(k,v);
    this.cache.set(key,{at:this.monotonic(),payload});
    return {...payload,consulta:{origem:'api',idade_segundos:0,cache_ttl_segundos:this.ttl,consultado_em:consulted}};
  }
}
