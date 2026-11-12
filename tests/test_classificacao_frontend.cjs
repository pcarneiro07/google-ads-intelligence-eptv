// Dados SIMULADOS, nenhum acesso de rede ou credencial.
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const source=fs.readFileSync('frontend/dashboard.js','utf8');
const html=fs.readFileSync('frontend/index.html','utf8');
assert.equal(html.split('<script>')[1].split('</script>')[0].trim(),source.trim());
const prefix=source.slice(0,source.indexOf('  const range='));
const context={Intl,document:{}};vm.createContext(context);
vm.runInContext(prefix+`globalThis.test={classify,normal,buildModel,states,setData:v=>{data=v}};})();`,context);
const api=context.test;
assert.equal(api.classify({programa:'NAO_CLASSIFICADO',campaign:{name:'EPTV1'}}),'OUTROS');
assert.equal(api.classify({campaign:{name:'EPTV2'}}),'OUTROS');
const reports={};
for(const name of ['campanhas','criativos','dispositivos','idade','genero','cidades','dia_hora','formatos']) {
 reports[name]=['BDC','EPTV1','EPTV2','NAO_CLASSIFICADO'].flatMap((programa,i)=>['A','B'].flatMap(account=>['YOUTUBE','CONTENT'].map(network=>({
  programa,sourceCustomerId:account,campaign:{id:String(i),name:'EPTV1'},segments:{adNetworkType:network,date:'2026-09-10'},
  adGroupAd:{ad:{id:String(i)}},metrics:{costMicros:'1000001',impressions:'10',videoTrueviewViews:'2',clicks:'1'}
 }))));
}
api.setData({relatorios:reports});
for(const account of ['ALL','A','B']) for(const network of ['ALL','YOUTUBE','CONTENT']) {
 Object.assign(api.states,{account,network,program:'ALL'});
 const total=api.buildModel().total;let parts={cost:0,impressions:0,views:0,clicks:0};
 for(const program of ['BDC','EPTV1','EPTV2','OUTROS']) {
  api.states.program=program;const model=api.buildModel();
  assert.ok(model.campaigns.every(r=>r.program===program));
  for(const key of ['creative','device','age','gender','city','hours','formats']) {
   assert.equal(model[key].length,model.campaigns.length);
   assert.ok(model[key].every(r=>r.program===program));
  }
  for(const key in parts)parts[key]+=model.total[key];
 }
 for(const key in parts)assert.ok(Math.abs(parts[key]-total[key])<1e-8,`${account}/${network}/${key}`);
}
console.log('OK: script servido sincronizado; autoridade backend; filtros em 8 relatórios e 9 combinações conta/rede; partição sem duplicação.');

// Calendário: validar datas, contrato, atualização e resposta de outro intervalo.
assert.ok(html.includes('type="date" id="dateStart"'));
assert.ok(html.includes('type="date" id="dateEnd"'));
assert.ok(!html.includes('data-period='));
const nodes=new Map();
const dom={querySelector:s=>{if(!nodes.has(s))nodes.set(s,{disabled:false,textContent:'',classList:{toggle(){}}});return nodes.get(s)}};
const requests=[];
let responsePeriod={periodo_inicio:'2026-11-01',periodo_fim:'2026-11-11',dias:11};
const dateContext={Intl,Date,document:dom,AbortController,URLSearchParams,
 fetch:async(url,options)=>{requests.push([url,options]);return {ok:true,json:async()=>({
  ...responsePeriod,relatorios:{campanhas:[],criativos:[],dispositivos:[],idade:[],genero:[],cidades:[],dia_hora:[],formatos:[]},
  customer_ids:['7182459480','5498287982'],filtro_rede:'ALL',erros:{}
 })}}};
vm.createContext(dateContext);
vm.runInContext(source.slice(0,source.indexOf('  const clearViews='))+`
 const refresh=()=>{};
 globalThis.calendar={dateCount,loadPeriod,states,limits:dateLimits,getData:()=>data};})();`,dateContext);
const calendar=dateContext.calendar;calendar.limits.max='2026-11-11';
assert.equal(calendar.dateCount('2026-11-01','2026-11-11'),11);
assert.equal(calendar.dateCount('2026-11-11','2026-11-11'),1);
assert.ok(Number.isNaN(calendar.dateCount('2026-02-30','2026-03-01')));
(async()=>{
 await calendar.loadPeriod('2026-11-01','2026-11-11');
 assert.equal(requests.length,1);
 assert.equal(requests[0][0],'/api/relatorios?inicio=2026-11-01&fim=2026-11-11');
 assert.equal(calendar.states.period,11);assert.equal(calendar.states.inicio,'2026-11-01');
 await calendar.loadPeriod('2026-11-01','2026-11-11',{force:true});
 assert.equal(requests[1][0],'/api/atualizar?inicio=2026-11-01&fim=2026-11-11');
 assert.equal(requests[1][1].method,'POST');
 for(const [start,end] of [['2026-11-12','2026-11-12'],['2026-11-11','2026-11-01'],['2026-02-30','2026-03-01']])await calendar.loadPeriod(start,end);
 assert.equal(requests.length,2);
 responsePeriod={periodo_inicio:'2023-01-01',periodo_fim:'2026-11-11',dias:calendar.dateCount('2023-01-01','2026-11-11')};
 await calendar.loadPeriod('2023-01-01','2026-11-11');
 assert.equal(requests.length,3);assert.ok(calendar.states.period>365);
 assert.equal(calendar.getData().periodo_inicio,'2023-01-01');
 assert.equal(requests[2][0],'/api/relatorios?inicio=2023-01-01&fim=2026-11-11');
 responsePeriod={periodo_inicio:'2026-10-01',periodo_fim:'2026-10-11',dias:11};
 await calendar.loadPeriod('2026-11-01','2026-11-11');
 assert.equal(calendar.getData(),null);
 assert.match(nodes.get('#dataBanner').textContent,/diferente do solicitado/);
 console.log('OK: calendário, validação de datas, GET/POST, intervalo exato e bloqueio de resposta divergente.');
})().catch(error=>{console.error(error);process.exitCode=1});
