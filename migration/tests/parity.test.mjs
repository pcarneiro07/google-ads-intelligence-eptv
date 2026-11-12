import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildInventory,enrich,nameHits} from '../../runtime/classification.mjs';
import {AdsService,reference,queriesForDates,resolvePeriod} from '../../runtime/service.mjs';

const python=process.env.PYTHON||(process.platform==='win32'&&existsSync('backend/.venv/Scripts/python.exe')?'backend/.venv/Scripts/python.exe':'python');
function oracle(input){
  const proc=spawnSync(python,['migration/python_oracle.py'],{input:JSON.stringify(input),encoding:'utf8'});
  assert.equal(proc.status,0,proc.stderr);return JSON.parse(proc.stdout);
}
const time=new Date('2026-11-12T15:00:00Z');
const params=(inicio='2026-08-14',fim='2026-11-11')=>new URLSearchParams({inicio,fim});
function raw(campaign,adNames){
  return {campaigns:[{campaign:{id:'100',name:campaign}}],labels:[],assets:[],ads:adNames.map((name,i)=>({
    campaign:{id:'100'},adGroup:{id:String(i+1),name},adGroupAd:{ad:{id:String(i+1000),name}}
  }))};
}
test('GAQL and persisted mappings exactly match current Python source, including source fingerprints',()=>{
  const expected=oracle({action:'reference'});assert.deepEqual(reference,expected);
  for(const [name,query] of Object.entries(queriesForDates('2023-01-01','2026-11-11'))){
    assert.equal(query,expected.reports[name].replaceAll('__START__','2023-01-01').replaceAll('__END__','2026-11-11'));
    assert.ok(query.includes("BETWEEN '2023-01-01' AND '2026-11-11'"));
  }
  for(const query of Object.values(reference.inventory))assert.ok(!query.includes('LIMIT'));
});
test('classification differential: mappings, labels, aliases, conflicts, partial and mixed campaigns',()=>{
  const cases=[raw('EPTV 1',[]),raw('EPTV -2',[]),raw('Bom Dia Cidade',[]),raw('genérica',['EPTV1']),
    raw('genérica',['EPTV1','genérica']),raw('genérica',['EPTV1','EPTV2']),raw('BDC',['EPTV1']),
    raw('EPTV1',['EPTV1 BDC']),raw('SINAL EPTV 1',['SINAL EPTV 2']),raw('Primeira Edição',['Morel']),raw('EPTV1 e EPTV2',[])];
  const video=raw('genérica',['genérico']);video.ads[0].adGroupAd.ad.videoResponsiveAd={videos:[{asset:'video1'}]};
  video.assets=[{asset:{resourceName:'video1',youtubeVideoAsset:{youtubeVideoId:'synthetic',youtubeVideoTitle:'Juliana | EPTV1'}}}];cases.push(video);
  const label='customers/7182459480/labels/1';
  for(let i=0;i<cases.length;i++)for(const mapping of [{},{'7182459480:100':'BDC','100':'EPTV2'}]){
    const input={action:'inventory',raw:cases[i],account:'7182459480',mapping,labels:{}};
    assert.deepEqual(buildInventory(input.raw,input.account,mapping,{},reference.version),oracle(input));
  }
  const labelled=raw('EPTV1',['EPTV1']);labelled.campaigns[0].campaign.labels=[label];
  labelled.labels=[{label:{resourceName:label,name:'Rótulo oficial'}}];
  const input={action:'inventory',raw:labelled,account:'7182459480',labels:{[label]:'EPTV2'}};
  assert.deepEqual(buildInventory(labelled,input.account,{},input.labels,reference.version),oracle(input));
  const second='customers/7182459480/labels/2';
  labelled.campaigns[0].campaign.labels=[label,second];input.labels[second]='BDC';
  assert.deepEqual(buildInventory(labelled,input.account,{},input.labels,reference.version),oracle(input));
  labelled.campaigns[0].campaign.labels=[];labelled.ads[0].adGroup.labels=[label,second];
  assert.deepEqual(buildInventory(labelled,input.account,{},input.labels,reference.version),oracle(input));
  const inv=buildInventory(video,'7182459480',{}, {},reference.version);
  const row={campaign:{id:'100'},adGroupAd:{ad:{id:'1000'}},metrics:{costMicros:'1234567',trueviewAverageCpv:10046.52}};
  assert.deepEqual(enrich(row,inv,'7182459480'),oracle({action:'enrich',row,inventory:inv,account:'7182459480'}));
});
test('explicit confirmed campaign mappings and signal videos retained',()=>{
  assert.equal(reference.mapping['7182459480:21869675883'],'EPTV1');
  assert.equal(reference.mapping['7182459480:22019887866'],'EPTV1');
  for(const value of ['SINAL EPTV 1','SINAL EPTV 2','Primeira Edição','Segunda Edição','Jonatan Morel'])assert.equal(nameHits(value).size,0);
});
export class FakeReader {
  constructor(){this.calls=[];this.failure=null;this.currency='BRL';}
  async gaql(account,query){
    this.calls.push([account,query]);
    if(this.failure?.(account,query))throw new Error('Synthetic mandatory query failure');
    if(query.includes('FROM customer '))return [{customer:{currencyCode:account==='5498287982'?this.currency:'BRL',timeZone:'America/Sao_Paulo'}}];
    const kind=Object.keys(reference.inventory).find(k=>reference.inventory[k]===query);
    const campaign={id:account==='7182459480'?'100':'200',name:account==='7182459480'?'Jornalismo genérico':'BDC'};
    if(kind==='campaigns')return [{campaign}];
    if(kind==='labels'||kind==='assets')return [];
    if(kind==='ads')return [{campaign,adGroup:{id:'10',name:campaign.name},adGroupAd:{ad:{id:campaign.id+'99'}}}];
    if(query.includes('FROM geo_target_constant '))return [];
    const rows=account==='7182459480'?
      [['YOUTUBE',439628,48117,50,'1502711448'],['CONTENT',27612,1667,32,'235159118']]:
      [['YOUTUBE',3395,759,0,'54150000']];
    return rows.map(([adNetworkType,impressions,views,clicks,costMicros])=>({campaign,
      segments:{adNetworkType,date:'2026-09-10'},
      ...(query.includes('FROM ad_group_ad ')?{adGroupAd:{ad:{id:campaign.id+'99'}}}:{}),
      metrics:{impressions:String(impressions),videoTrueviewViews:String(views),clicks:String(clicks),costMicros,
        trueviewAverageCpv:account==='7182459480'?10046.52:32779.19,
        videoTrueviewViewRateInStream:0.5177,videoTrueviewViewRateInFeed:0.0655,videoQuartileP25Rate:0.6362}}));
  }
}
test('synthetic baseline, micros, raw official rates and exclusive categories preserved across all reports',async()=>{
  const reader=new FakeReader(),service=new AdsService({reader,now:()=>time});
  const payload=await service.fetch(params());const rows=payload.relatorios.campanhas;
  const sums=Object.fromEntries(['costMicros','impressions','videoTrueviewViews','clicks'].map(k=>[k,rows.reduce((a,r)=>a+BigInt(r.metrics[k]),0n)]));
  assert.deepEqual(sums,{costMicros:1792020566n,impressions:470635n,videoTrueviewViews:50543n,clicks:82n});
  assert.equal((Number(sums.costMicros)/1e6).toFixed(2),'1792.02');
  assert.equal(rows[0].costInAccountCurrency,1502.711448);
  const parts=['BDC','EPTV1','EPTV2','NAO_CLASSIFICADO'].map(p=>rows.filter(r=>r.programa===p).reduce((a,r)=>a+BigInt(r.metrics.costMicros),0n));
  assert.equal(parts.reduce((a,b)=>a+b,0n),sums.costMicros);
  for(const records of Object.values(payload.relatorios))for(const row of records){
    assert.equal(row.programa,row.sourceCustomerId==='7182459480'?'NAO_CLASSIFICADO':'BDC');
    assert.equal(row.metrics.trueviewAverageCpv,row.sourceCustomerId==='7182459480'?10046.52:32779.19);
    assert.equal(row.metrics.videoTrueviewViewRateInStream,0.5177);
    assert.equal(row.metrics.videoTrueviewViewRateShorts,undefined);
  }
});
test('complete multiconta payload parity with Python HTTP backend using isolated offline reader',async()=>{
  const reader=new FakeReader(),service=new AdsService({reader,now:()=>time}),responses={};
  for(const account of Object.keys(reference.accounts)){
    responses[account]={};
    for(const query of ['SELECT customer.currency_code, customer.time_zone FROM customer LIMIT 1',
      ...Object.values(reference.inventory),...Object.values(queriesForDates('2026-08-14','2026-11-11'))])
      responses[account][query]=await reader.gaql(account,query);
  }
  const node=await service.fetch(params());
  const python=oracle({action:'service',responses,mapping:reference.mapping,labels:reference.labels,
    now:time.toISOString(),inicio:'2026-08-14',fim:'2026-11-11'});
  for(const payload of [node,python]){
    delete payload.extraido_em;delete payload.consulta.consultado_em;
  }
  assert.deepEqual(node,python);
});
test('frontend financial calculations and rates remain the existing official formulas',()=>{
  const source=readFileSync('frontend/dashboard.js','utf8'),context={Intl,document:{}};vm.createContext(context);
  vm.runInContext(source.slice(0,source.indexOf('  const range='))+'globalThis.finance={metric,sum,officialCPV,normal};})();',context);
  const f=context.finance;
  const first=f.metric({metrics:{videoTrueviewViews:100,trueviewAverageCpv:10046.52,costMicros:'999000000'}});
  const second=f.metric({metrics:{videoTrueviewViews:200,trueviewAverageCpv:32779.19}});
  assert.ok(Math.abs(f.officialCPV(first)-0.01004652)<1e-14);
  assert.ok(Math.abs(f.officialCPV(f.sum([first,second]))-(0.01004652*100+0.03277919*200)/300)<1e-12);
  assert.equal(f.officialCPV(f.metric({metrics:{videoTrueviewViews:0,trueviewAverageCpv:0}})),null);
  const normal=f.normal({metrics:{videoTrueviewViewRateInStream:0.5177}},'formatos');
  assert.equal(normal.formatRates.inStream,0.5177);assert.equal(normal.formatRates.shorts,null);
});
test('reach rows with cost and impressions but zero TrueView are retained without invented CPV',async()=>{
  const reader=new FakeReader(),gaql=reader.gaql.bind(reader);
  reader.gaql=async(account,query)=>{
    const rows=await gaql(account,query);
    if(query.includes('metrics.'))return rows.map(row=>({...row,metrics:{...row.metrics,videoTrueviewViews:'0'}}));
    return rows;
  };
  const payload=await new AdsService({reader,now:()=>time}).fetch(params());
  const rows=payload.relatorios.campanhas;
  assert.equal(rows.length,3);assert.equal(rows.reduce((n,r)=>n+BigInt(r.metrics.costMicros),0n),1792020566n);
  assert.equal(rows.reduce((n,r)=>n+Number(r.metrics.impressions),0),470635);
  assert.ok(rows.every(row=>row.metrics.videoTrueviewViews==='0'));
});
test('cache TTL, refresh minimum, cross-period inventory reuse and concurrent duplicate fill',async()=>{
  let seconds=0;const reader=new FakeReader(),service=new AdsService({reader,now:()=>time,monotonic:()=>seconds});
  await Promise.all([service.fetch(params()),service.fetch(params())]);
  const initial=reader.calls.length;assert.equal(initial,26);
  assert.equal((await service.fetch(params(),true)).consulta.origem,'cache_memoria');assert.equal(reader.calls.length,initial);
  await service.fetch(params('2026-08-13','2026-11-10'));assert.equal(reader.calls.length-initial,18);
  seconds=61;const before=reader.calls.length;await service.fetch(params(),true);assert.equal(reader.calls.length-before,26);
  seconds=962;const count=reader.calls.length;await service.fetch(params());assert.equal(reader.calls.length-count,26);
});
test('mandatory inventory/report failure and currency mismatch cannot produce or cache partial results',async()=>{
  for(const failure of [(a,q)=>a==='5498287982'&&q===reference.inventory.assets,(a,q)=>a==='5498287982'&&q.includes('metrics.')]){
    const reader=new FakeReader();reader.failure=failure;const service=new AdsService({reader,now:()=>time});
    await assert.rejects(service.fetch(params()));assert.equal(service.cache.size,0);assert.equal(service.inventoryCache.size,0);
  }
  const reader=new FakeReader();reader.currency='USD';const service=new AdsService({reader,now:()=>time});
  await assert.rejects(service.fetch(params()),/moedas diferentes/);assert.equal(service.cache.size,0);
});
test('date validation and São Paulo D-1 preserve unrestricted custom ranges',()=>{
  assert.ok(resolvePeriod(params('2023-01-01','2026-11-11'),time).dias>365);
  assert.equal(resolvePeriod(new URLSearchParams('dias=7'),new Date('2026-11-12T02:59:00Z')).fim,'2026-11-10');
  for(const query of ['inicio=2026-02-30&fim=2026-03-01','inicio=2026-11-11','inicio=2026-11-12&fim=2026-11-12',
    'inicio=2026-11-11&fim=2026-11-01','inicio=2026-01-01&fim=2026-11-11&dias=7','dias=7&dias=90'])
    assert.throws(()=>resolvePeriod(new URLSearchParams(query),time),RangeError);
});
