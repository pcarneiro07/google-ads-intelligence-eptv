(() => {
  'use strict';
  const $ = (s,root=document) => root.querySelector(s);
  const $$ = (s,root=document) => [...root.querySelectorAll(s)];
  const safe = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const numeric = v => { const n = Number(v??0); return Number.isFinite(n) && n>=0 ? n : 0; };
  const empty = () => ({impressions:0, views:0, cost:0, clicks:0, cpvWeighted:0, cpvViews:0});
  const add = (o,r) => { for(const k of ['impressions','views','cost','clicks','cpvWeighted','cpvViews']) o[k]+=r[k]||0;return o; };
  const sum = rows => rows.reduce((a,r)=>add(a,r),empty());
  const fmt = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0});
  const n = v => fmt.format(v||0);
  const short = v => v>=1e6?(v/1e6).toLocaleString('pt-BR',{maximumFractionDigits:2})+' mi':v>=1e3?(v/1e3).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil':n(v);
  const per = v => (v*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
  const states={program:'ALL',account:'ALL',network:'ALL',programMetric:'impressions',formatKey:'',period:365,page:'overview',trend:'views',heat:'views',search:'',sort:'views',picked:{d:1,h:8},motion:true};
  const programs=[{id:'BDC',name:'BDC',color:'#4285f4'},{id:'EPTV1',name:'EPTV1',color:'#34a853'},{id:'EPTV2',name:'EPTV2',color:'#f9ab00'},{id:'OUTROS',name:'Outros / não classificados',color:'#8b93a6'}];
  const weekdays=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const dayMap={SUNDAY:0,MONDAY:1,TUESDAY:2,WEDNESDAY:3,THURSDAY:4,FRIDAY:5,SATURDAY:6};
  const deviceName={MOBILE:'Celular',DESKTOP:'Computador',TABLET:'Tablet',CONNECTED_TV:'TV conectada',OTHER:'Outro',UNKNOWN:'Não informado'};
  const ageName={AGE_RANGE_18_24:'18–24',AGE_RANGE_25_34:'25–34',AGE_RANGE_35_44:'35–44',AGE_RANGE_45_54:'45–54',AGE_RANGE_55_64:'55–64',AGE_RANGE_65_UP:'65+',AGE_RANGE_UNDETERMINED:'Não determinado'};
  const genderName={MALE:'Masculino',FEMALE:'Feminino',UNDETERMINED:'Não determinado'};
  const dateLimits={max:''};let raw=null, loaded=null, data=null, model=null, heat=[];
  states.inicio='';states.fim='';
  const scope=r=>(states.program==='ALL'||(states.program==='OUTROS'?r.program==='OUTROS':r.program===states.program))&&(states.account==='ALL'||r.account===states.account)&&(states.network==='ALL'||r.network===states.network);
  const money=v=>{if(v==null||!Number.isFinite(v))return '—';let code=data?.metadata?.currency_code||'';if(code&&/^[A-Z]{3}$/.test(code))return new Intl.NumberFormat('pt-BR',{style:'currency',currency:code,maximumFractionDigits:2,minimumFractionDigits:2}).format(v);return v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+' (moeda da conta)';};
  const cpv=r=>r.views>0?r.cost/r.views:null;
  const rate=r=>r.impressions>0?r.views/r.impressions:null;
  const officialCPV=r=>r.cpvViews>0 ? r.cpvWeighted/r.cpvViews : null;
  const officialCPVLabel=r=>officialCPV(r)===null?'—':money(officialCPV(r));
  const asMoneyRatio=r=>cpv(r)===null?'—':money(cpv(r));
  const asRate=r=>rate(r)===null?'—':per(rate(r));
  const metric=r=>{
    const m=r?.metrics||{},views=numeric(m.videoTrueviewViews);
    const rawCPV=m.trueviewAverageCpv==null?null:Number(m.trueviewAverageCpv);
    // O campo CPV vem em micros da moeda da conta; fazer a conversão ANTES de exibir.
    const hasOfficial=views>0&&rawCPV!==null&&Number.isFinite(rawCPV)&&rawCPV>=0;
    return {impressions:numeric(m.impressions),views,clicks:numeric(m.clicks),cost:numeric(m.costMicros)/1e6,
      cpvWeighted:hasOfficial?(rawCPV/1e6)*views:0,cpvViews:hasOfficial?views:0};
  };
  // O backend é a única autoridade, inclusive quando a decisão é pendente.
  const classify=r=>['BDC','EPTV1','EPTV2'].includes(r.programa)?r.programa:'OUTROS';
  const programColor=p=>programs.find(a=>a.id===p)?.color||'#8b93a6';
  const normal=(r,report)=>{
    const c=r.campaign||{}, s=r.segments||{}, ad=r.adGroupAd?.ad||{}, account=String(r.sourceCustomerId||''),network=String(s.adNetworkType||'UNSPECIFIED');
    let key='';
    if(report==='criativos')key=account+'|'+String(c.id||'')+'|'+String(ad.id||'');
    else if(report==='formatos')key=account+'|'+String(c.id||'')+'|'+network;
    else if(report==='dispositivos')key=String(s.device||'UNKNOWN');
    else if(report==='idade')key=String(r.adGroupCriterion?.ageRange?.type||'UNDETERMINED');
    else if(report==='genero')key=String(r.adGroupCriterion?.gender?.type||'UNDETERMINED');
    else if(report==='cidades')key=String(s.geoTargetCity||'NÃO_INFORMADA');
    else if(report==='dia_hora')key=String(s.dayOfWeek||'')+'|'+String(s.hour??'');
    return {...metric(r),program:classify(r),classification:r.classificacaoPrograma||{},adEvidence:r.evidenciaProgramaAnuncio||null,account,network,campaignId:String(c.id??''),campaignName:String(c.name??''),date:String(s.date||''),key,adId:String(ad.id||''),adType:String(ad.type||'NÃO INFORMADO'),adStatus:String(r.adGroupAd?.status||''),
      formatRates:report==='formatos'?{
        inStream:r.metrics?.videoTrueviewViewRateInStream??null,
        inFeed:r.metrics?.videoTrueviewViewRateInFeed??null,
        shorts:r.metrics?.videoTrueviewViewRateShorts??null,
        p25:r.metrics?.videoQuartileP25Rate??null,p50:r.metrics?.videoQuartileP50Rate??null,
        p75:r.metrics?.videoQuartileP75Rate??null,p100:r.metrics?.videoQuartileP100Rate??null}:null};
  };
  const group=(rows,keyfn)=>{
    let m=new Map();for(const r of rows){const k=keyfn(r);if(!m.has(k))m.set(k,empty());add(m.get(k),r)}return m;
  };
  const buildModel=()=>{
    const r=data?.relatorios||{};
    const get=k=>(r[k]||[]).map(x=>normal(x,k)).filter(scope);
    const c=get('campanhas');
    return {campaigns:c, total:sum(c), byDate:group(c,x=>x.date), byProg:group(c,x=>x.program),byCampaign:group(c,x=>x.account+'|'+x.campaignId),
      creative:get('criativos'),device:get('dispositivos'), age:get('idade'),gender:get('genero'),city:get('cidades'),hours:get('dia_hora'), formats:get('formatos')};
  };
  const range=()=>{
    if(!data)return 'Sem dados';
    const fmt=d=>{const [y,m,day]=String(d||'').split('-');return `${day}/${m}/${y}`};
    return fmt(data.periodo_inicio)+' a '+fmt(data.periodo_fim);
  };
  const status=(msg,good=false)=>{const b=$('#dataBanner');b.textContent=msg;b.classList.toggle('ok',good)};
  const validate=d=>{
    if(!d||typeof d!=='object'||!d.relatorios||d.filtro_rede!=='ALL'||d.erros&&Object.keys(d.erros).length)throw new Error('Resposta da API inválida, parcial ou com erro de rede.');
    for(let k of ['campanhas','criativos','dispositivos','idade','genero','cidades','dia_hora','formatos'])if(!Array.isArray(d.relatorios[k]))throw new Error('Relatório ausente: '+k);
    if(!Array.isArray(d.customer_ids)||d.customer_ids.some(x=>!/^\d{10}$/.test(String(x))))throw new Error('ID do anunciante inválido na resposta.');
    const count=dateCount(d.periodo_inicio,d.periodo_fim);
    if(count<1||count!==Number(d.dias)||d.periodo_fim>dateLimits.max)throw new Error('Intervalo inválido na resposta da API.');
    if(d.relatorios.campanhas.some(x=>!x.segments?.date))throw new Error('Campanhas sem data: impossível gerar evolução confiável.');
    return d;
  };
  const dateCount=(inicio,fim)=>{
    const parse=s=>{
      if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return NaN;
      const value=Date.parse(s+'T00:00:00Z');
      return Number.isFinite(value)&&new Date(value).toISOString().slice(0,10)===s?value:NaN;
    };
    return (parse(fim)-parse(inicio))/86400000+1;
  };
  const updateDateControls=()=>{
    for(const id of ['dateStart','dateEnd']){$('#'+id).max=dateLimits.max;$('#'+id).disabled=!!inflight;}
    $('#applyDatesBtn').disabled=!!inflight||!dateLimits.max;
    $('#dateHelp').textContent='Até ontem • sem limite de duração';
  };
  let requestNumber=0, lastLoadAt=0, inflight=null;
  const loadPeriod=async (inicio, fim, opts={})=>{
    const days=dateCount(inicio,fim);
    if(!Number.isFinite(days)||days<1||fim>dateLimits.max){
      status('Selecione datas válidas, com início até o fim e término até ontem.');
      return;
    }
    const reqNo=++requestNumber;
    if(inflight)inflight.abort();
    inflight=new AbortController();
    updateDateControls();
    $('#refreshDataBtn').disabled=true;
    status(opts.force?'Solicitando atualização direta à Google Ads API…':'Consultando '+days+' dias na Google Ads API (cache rápido quando disponível)…');
    try{
      const res=await fetch((opts.force?'/api/atualizar':'/api/relatorios')+'?'+new URLSearchParams({inicio,fim}),
        {method:opts.force?'POST':'GET',cache:'no-store',signal:inflight.signal,
         headers:{'X-Ads-Request':'dashboard'}});
      const payload=await res.json();
      if(!res.ok)throw new Error(payload.erro||'Falha ao consultar a API (HTTP '+res.status+')');
      if(reqNo!==requestNumber)return;
      const validated=validate(payload);
      if(validated.periodo_inicio!==inicio||validated.periodo_fim!==fim)throw new Error('A API retornou um período diferente do solicitado');
      data=validated;
      states.period=days;states.inicio=inicio;states.fim=fim;
      lastLoadAt=Date.now();
      refresh();
    }catch(e){
      if(reqNo!==requestNumber||e.name==='AbortError')return;
      data=null;refresh();
      status('Não foi possível consultar '+days+' dias: '+e.message+'. A versão anterior não foi substituída por números incompletos.');
    }finally{if(reqNo===requestNumber){inflight=null;$('#refreshDataBtn').disabled=false;updateDateControls();}}
  };
  const clearViews=()=>{
    for(let id of ['kpiGrid','trendChart','programChart','insightGrid','creativeGrid','ageBars','genderBars','cities','deviceLegend','heatmap','hourDetail','weekBars','hourInsights','formatMetrics'])$('#'+id).innerHTML='';
    $('#deviceDonut').style.background='#edf3fd';$('#deviceDominant').textContent='—';
    $('#trendCaption').textContent='Sem dados carregados';$('#creativeMeta').textContent='';$('#rangeBadge').textContent='—';
  };
  const renderNav=()=>{$$('.navbtn').forEach(b=>{let active=b.dataset.page===states.page;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});$$('.view').forEach(v=>v.classList.toggle('active',v.id===states.page));$('#breadcrumb').textContent={overview:'Visão geral',creative:'Criativos',audience:'Público e regiões',hours:'Dias e horários'}[states.page]};
  const renderKpis=()=>{
    const r=model.total, f=sum(model.formats);let defs=[
      ['Investimento',money(r.cost),'Investimento consolidado da seleção','¤','#4285f4','#ebf3ff'],
      ['Visualizações TrueView',short(r.views),'Visualizações reportadas pelo Google Ads','▶','#34a853','#e9f9f0'],
      ['Impressões',short(r.impressions),'Entrega total das campanhas','◉','#ee973b','#fff3e3'],
      ['CPV médio TrueView',officialCPVLabel(f),'API oficial • ponderado pelas TrueView','↘','#845cda','#f2edff']];
    $('#kpiGrid').innerHTML=defs.map(([label,val,sub,icon,col,bg],i)=>`<article class="kpi" style="--kcol:${col};--kbg:${bg};animation:enter .4s both;animation-delay:${i*.07}s"><div class="kpiicon">${icon}</div><div class="kpilabel">${label}</div><div class="kpivalue">${safe(val)}</div><div class="kpisub">${safe(sub)}</div></article>`).join('');
  };
  const renderTrend=()=>{
    // Eixo horizontal representa cada dia de calendário, inclusive os dias sem entrega.
    if(!data?.periodo_inicio||!data?.periodo_fim)return;
    const first=new Date(data.periodo_inicio+'T12:00:00Z'),last=new Date(data.periodo_fim+'T12:00:00Z');
    const points=[];
    for(let at=new Date(first);at<=last;at.setUTCDate(at.getUTCDate()+1)){
      const d=at.toISOString().slice(0,10);
      points.push([d,model.byDate.get(d)||empty()]);
    }
    if(!points.length)return;
    const w=850,h=255,l=58,t=20,rr=18,b=35,ph=h-t-b,pw=w-l-rr;
    const max=Math.max(1,...points.map(p=>p[1][states.trend]))*1.12;
    const coords=points.map(([d,o],i)=>({x:l+pw*(i/Math.max(1,points.length-1)),y:t+ph-ph*o[states.trend]/max,d,v:o[states.trend]}));
    const line=coords.map((q,i)=>(i?'L':'M')+q.x.toFixed(1)+' '+q.y.toFixed(1)).join(' ');
    const axes=Array.from({length:5},(_,i)=>{let y=t+i*ph/4;return `<line stroke="#e8eff8" x1="${l}" x2="${w-rr}" y1="${y}" y2="${y}"/><text x="${l-9}" y="${y+4}" text-anchor="end" font-size="11" fill="#8d9ab0">${safe(short(max*(4-i)/4))}</text>`}).join('');
    const marks=coords.filter((q,i)=>points.length<=30||i%Math.max(1,Math.floor(points.length/12))===0||i===points.length-1).map(q=>`<circle cx="${q.x}" cy="${q.y}" r="3" fill="#fff" stroke="#4285f4" stroke-width="2"><title>${q.d}: ${states.trend==='views'?n(q.v)+' visualizações':money(q.v)}</title></circle>`).join('');
    const ticks=coords.filter((q,i)=>i===0||i===coords.length-1||i%Math.max(1,Math.floor(coords.length/5))===0).map(q=>`<text x="${q.x}" y="${h-9}" text-anchor="middle" font-size="10" fill="#8d9ab0">${q.d.slice(8)}/${q.d.slice(5,7)}</text>`).join('');
    $('#trendChart').innerHTML=`<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto" role="img" aria-label="Evolução diária em calendário">${axes}<path d="${line}" stroke="#4285f4" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" class="animated-trend"/>${marks}${ticks}</svg>`;
    $('#trendCaption').textContent=`${points.length} dias de calendário • ${model.byDate.size} dias com entrega • dias sem registros são zero, não estimativas.`;
  };
  const bars=(items,renderName)=>{
    if(!items.length)return '<p class="empty-message">Sem registros para este filtro.</p>';
    const type=states.programMetric;
    const max=Math.max(1,...items.map(v=>v.r[type]||0));
    return items.map(o=>`<div class="realbarrow"><div class="realbarhead"><span><b>${safe(renderName(o))}</b></span><span>${type==='cost'?safe(money(o.r.cost)):short(o.r[type])+' '+(type==='views'?'TrueView':'impressões')}</span></div><div class="realtrack"><span style="width:${o.r[type]?Math.max(1,o.r[type]/max*100):0}%;background:${programColor(o.p||'BDC')}"></span></div></div>`).join('');
  };
  const renderProgram=()=>{
    const all=states.program==='ALL'?programs.map(p=>({...p,p:p.id,r:model.byProg.get(p.id)||empty()})):
      ([ ...model.byCampaign].sort((a,b)=>b[1][states.programMetric]-a[1][states.programMetric]).slice(0,8).map(([id,r])=>({name:model.campaigns.find(c=>c.account+'|'+c.campaignId===id)?.campaignName||id,p:states.program,id,r})));
    $('#compareTitle').textContent=states.program==='ALL'?'Participação por programa':'Campanhas com maior entrega';
    $('#compareSubtitle').textContent='Comparação por '+({cost:'investimento',impressions:'impressões',views:'TrueView'}[states.programMetric]);
    $('#programChart').innerHTML=bars(all,o=>o.name);
    $$('#programMetric [data-metric]').forEach(b=>b.classList.toggle('active',b.dataset.metric===states.programMetric));
  };
  const renderFormats=()=>{
    const list=model.formats.filter(x=>x.views>0).sort((a,b)=>b.views-a.views);
    const select=$('#formatCampaignSelect');if(!select)return;
    select.innerHTML=list.map(x=>`<option value="${safe(x.key)}">${safe(x.campaignName)} • ${safe((data.metadata.account_names||{})[x.account]||x.account)} • ${safe(x.network)}</option>`).join('');
    if(!list.some(x=>x.key===states.formatKey))states.formatKey=list[0]?.key||'';
    select.value=states.formatKey;
    const r=list.find(x=>x.key===states.formatKey);
    const target=$('#formatMetrics');
    if(!r){target.innerHTML='<p class="empty-message">Sem visualizações TrueView para esta seleção.</p>';return}
    const fmt=v=>v===null||v===undefined?'—':per(Number(v));
    const vals=[['CPV médio oficial',officialCPVLabel(r)],['In-stream',fmt(r.formatRates?.inStream)],['In-feed',fmt(r.formatRates?.inFeed)],['Shorts',fmt(r.formatRates?.shorts)],['25% assistido',fmt(r.formatRates?.p25)],['50% assistido',fmt(r.formatRates?.p50)],['75% assistido',fmt(r.formatRates?.p75)],['100% assistido',fmt(r.formatRates?.p100)]];
    target.innerHTML=vals.map(([k,v])=>`<div class="format-kpi"><small>${safe(k)}</small><strong>${safe(v)}</strong></div>`).join('');
    $('#formatSummary').textContent=`${short(r.views)} TrueView • ${safe(r.campaignName)} • ${safe(r.network)}. Taxas oficiais desta campanha e rede; não são médias simples de outras campanhas.`;
  };
  const renderInsights=()=>{
    const all=model.total,unknown=model.byProg.get('OUTROS')||empty();
    let things=[['Redes com entrega',String(new Set(model.campaigns.filter(r=>r.impressions>0).map(r=>r.network)).size),'Redes com impressões na seleção','#4285f4'],['Cliques na seleção',short(all.clicks),'Não equivalem a visualizações TrueView','#34a853'],['Campanhas sem classificação',short(unknown.impressions)+' impressões',states.program==='ALL'?'Acompanhar para classificar BDC/EPTV1/EPTV2':'Classificação fora da seleção','#f9ab00']];
    $('#insightGrid').innerHTML=things.map(([name,v,detail,color])=>`<article class="insight" style="border-top:4px solid ${color}"><span class="insight-kicker">${safe(name)}</span><strong>${safe(v)}</strong><p>${safe(detail)}</p></article>`).join('');
  };
  const currentCreatives=()=>{
    const m=new Map();for(const row of model.creative){if(!m.has(row.key))m.set(row.key,{key:row.key,id:row.adId,account:row.account,program:row.program,name:row.campaignName,type:row.adType,status:row.adStatus,classification:row.classification,adEvidence:row.adEvidence,r:empty()});add(m.get(row.key).r,row)}return [...m.values()];
  };
  const renderCreatives=()=>{
    const text=states.search.toLowerCase();let list=currentCreatives().filter(x=>(x.name+' '+x.id+' '+x.type).toLowerCase().includes(text));
    list.sort((a,b)=>states.sort==='cpv'?(officialCPV(a.r)??Infinity)-(officialCPV(b.r)??Infinity):states.sort==='rate'?(rate(b.r)??-1)-(rate(a.r)??-1):b.r[states.sort]-a.r[states.sort]);
    $('#creativeMeta').textContent=`${n(list.length)} anúncios encontrados • Fonte: IDs de anúncio e campanhas da Google Ads API. Miniaturas não estão disponíveis neste extrato.`;
    $('#creativeGrid').innerHTML=list.length?list.slice(0,80).map(x=>`<button type="button" class="realcreative" data-ad="${safe(x.key)}" style="--pcolor:${programColor(x.program)}"><div class="realtile"><div class="realtileicon">▶</div><span>ANÚNCIO ${safe(x.id)}</span></div><div class="realbody"><span class="realbadge">${safe(x.program)}</span><span class="realbadge">${safe(x.type)}</span><h3>${safe(x.name||'Campanha sem nome')}</h3><div class="realnumbers"><div><small>TrueView</small><strong>${short(x.r.views)}</strong></div><div><small>CPV oficial</small><strong>${safe(officialCPVLabel(x.r))}</strong></div></div><small class="realhint">Detalhar anúncio</small></div></button>`).join(''):'<p class="empty-message">Nenhum anúncio no período ou na pesquisa.</p>';
    $$('#creativeGrid [data-ad]').forEach(b=>b.onclick=()=>openDrawer(b.dataset.ad));
  };
  const renderBars=(source,dest,names)=>{
    const m=group(source,r=>r.key);let arr=[...m].sort((a,b)=>b[1].views-a[1].views),max=Math.max(1,...arr.map(o=>o[1].views)),sumViews=arr.reduce((a,o)=>a+o[1].views,0);
    $('#'+dest).innerHTML=arr.length?arr.map(([key,r])=>`<div class="realbarrow"><div class="realbarhead"><span><b>${safe(names[key]||key)}</b></span><span>${short(r.views)} · ${sumViews?per(r.views/sumViews):'—'}</span></div><div class="realtrack"><span style="width:${r.views/max*100}%;background:${dest==='ageBars'?'#4285f4':'#34a853'}"></span></div></div>`).join(''):'<p class="empty-message">Sem registros neste período.</p>';
  };
  const renderCities=()=>{
    const rows=[...group(model.city,r=>r.key)].sort((a,b)=>b[1].views-a[1].views).slice(0,12),max=Math.max(1,...rows.map(x=>x[1].views));
    $('#cities').innerHTML=rows.length?rows.map(([key,r],i)=>`<div class="realbarrow"><div class="realbarhead"><b>${i+1}. ${safe((data?.metadata?.city_names||{})[key]||('Localidade ID '+key))}</b><span>${short(r.views)} TrueView</span></div><div class="realtrack"><span style="width:${r.views/max*100}%;background:#7758e8"></span></div></div>`).join('')+'<p class="panelnote">IDs geográficos preservados quando o nome da cidade ainda não foi resolvido.</p>':'<p class="empty-message">Sem registros geográficos.</p>';
  };
  const renderDevices=()=>{
    const list=[...group(model.device,r=>r.key)].sort((a,b)=>b[1].views-a[1].views),total=list.reduce((a,x)=>a+x[1].views,0),colors=['#4285f4','#34a853','#fbbc04','#ea4335','#8b93a6'];let progress=0;
    $('#deviceDonut').style.background=list.length&&total?`conic-gradient(${list.map(([k,r],i)=>{let start=progress;progress+=r.views/total*100;return `${colors[i%colors.length]} ${start.toFixed(2)}% ${progress.toFixed(2)}%`}).join(',')})`:'#eef3fb';
    $('#deviceDominant').textContent=list.length?deviceName[list[0][0]]||list[0][0]:'—';
    $('#deviceLegend').innerHTML=list.length?list.map(([key,r],i)=>`<div class="device-line"><span class="dlabel"><i style="--dc:${colors[i%colors.length]}"></i>${safe(deviceName[key]||key)}</span><span><b>${total?per(r.views/total):'—'}</b><small>Custo total/TrueView ${safe(asMoneyRatio(r))}</small></span></div>`).join(''):'<p class="empty-message">Sem registros.</p>';
  };
  const renderHeat=()=>{
    heat=Array.from({length:7},()=>Array.from({length:24},()=>empty()));
    for(let r of model.hours){let [day,h]=r.key.split('|'),d=dayMap[day],hour=Number(h);if(d===undefined||!Number.isInteger(hour)||hour<0||hour>23)continue;add(heat[d][hour],r)}
    let values=heat.flat().filter(r=>r.views>0).map(r=>states.heat==='views'?r.views:cpv(r)).filter(v=>v!==null),max=Math.max(1,...values),min=Math.min(...values,0);
    let html='<div class="head"></div>'+Array.from({length:24},(_,h)=>`<div class="head">${String(h).padStart(2,'0')}</div>`).join('');
    for(let d=0;d<7;d++){html+=`<div class="weekday">${weekdays[d]}</div>`;for(let h=0;h<24;h++){
      const r=heat[d][h],v=states.heat==='views'?r.views:cpv(r);let level=v===null||r.views===0?0:Math.max(.12,Math.min(1,(v-min)/Math.max(1,max-min)));
      const rgb=states.heat==='views'?'66,133,244':'234,67,53';
      html+=`<button type="button" class="heatcell ${states.picked.d===d&&states.picked.h===h?'picked':''}" data-day="${d}" data-hour="${h}" style="background:${level?`rgba(${rgb},${(.14+.8*level).toFixed(2)})`:'#f1f4f9'}" title="${weekdays[d]} ${h}h: ${n(r.views)} TrueView, custo total/TrueView ${safe(asMoneyRatio(r))}" aria-label="${weekdays[d]} ${h}h: ${n(r.views)} visualizações"></button>`;
    }}
    $('#heatmap').innerHTML=html;
    $$('#heatmap .heatcell').forEach(b=>b.onclick=()=>{states.picked={d:Number(b.dataset.day),h:Number(b.dataset.hour)};renderHeat()});
    $('#heatLegend').innerHTML=`<span>${states.heat==='views'?'Menos TrueView':'Menor custo total/TrueView'}</span>`+[.15,.3,.5,.75,.95].map(a=>`<span style="background:rgba(${states.heat==='views'?'66,133,244':'234,67,53'},${a})"></span>`).join('')+`<span>${states.heat==='views'?'Mais TrueView':'Maior custo total/TrueView'}</span>`;
    const r=heat[states.picked.d][states.picked.h];
    $('#hourDetail').innerHTML=`<div><div class="big">${weekdays[states.picked.d]} • ${String(states.picked.h).padStart(2,'0')}h</div><p>Acumulado do intervalo no período selecionado</p></div><div class="hours-numbers"><div><small>TrueView</small><b>${short(r.views)}</b></div><div><small>Investimento</small><b>${safe(money(r.cost))}</b></div><div><small>Custo total / TrueView</small><b>${safe(asMoneyRatio(r))}</b></div></div>`;
    const days=heat.map(row=>sum(row).views),dmax=Math.max(1,...days);
    $('#weekBars').innerHTML=days.map((v,i)=>`<div class="daycol" title="${weekdays[i]}: ${n(v)} TrueView"><div class="daybar" style="--dh:${v?Math.max(2,v/dmax*100):0}%"><strong class="dayvalue">${n(v)}</strong></div><span>${weekdays[i]}</span></div>`).join('');
    const cells=heat.flatMap((row,d)=>row.map((r,h)=>({r,d,h}))).filter(x=>x.r.views>0);
    const peak=[...cells].sort((a,b)=>b.r.views-a.r.views)[0];
    const avg= model.hours.length?sum(model.hours):empty();
    const hourRatio= avg.views?peak.r.views/avg.views:0;
    $('#hourInsights').innerHTML=peak?`<div class="realbarrow"><b>Maior entrega</b><p>${weekdays[peak.d]} às ${peak.h}h • ${n(peak.r.views)} TrueView</p></div><div class="realbarrow"><b>Participação no período</b><p>${per(hourRatio)} das visualizações registradas no horário</p></div><div class="realbarrow"><b>Leitura</b><p>Volume não indica causalidade nem melhor horário para publicação.</p></div>`:'<p class="empty-message">Sem veiculação registrada para o período.</p>';
  };
  const openDrawer=key=>{
    const c=currentCreatives().find(x=>x.key===key);if(!c)return;
    $('#drawerContent').innerHTML=`<h2>Anúncio ${safe(c.id)}</h2><p>${safe(c.program)} · ${safe(c.type)} · ${states.period} dias</p><div class="drawer-section"><h3>Campanha</h3><p>${safe(c.name)}</p></div><div class="summary-metrics"><div><small>TrueView</small><b>${n(c.r.views)}</b></div><div><small>Investimento</small><b>${safe(money(c.r.cost))}</b></div><div><small>CPV oficial</small><b>${safe(officialCPVLabel(c.r))}</b></div><div><small>TrueView / impressões (bruto)</small><b>${asRate(c.r)}</b></div></div><div class="drawer-section"><h3>Metodologia</h3><p class="tiptext">Dados reais agregados da Google Ads API. Os filtros usam o programa da campanha em todas as telas. Evidências de campanhas mistas não distribuem investimento entre programas. Não compare eficiência de objetivos diferentes como se fossem equivalentes.</p></div>`;
    const d=c.classification, e=c.adEvidence;
    $('#drawerContent').innerHTML+=`<div class="drawer-section"><h3>Classificação auditável</h3><p>Origem: ${safe(d.origem||'indisponível')} • Regra: ${safe(d.regra||'indisponível')} • Confiança: ${safe(d.confianca||'pendente')}</p><p>${safe(JSON.stringify(d.evidencias||[]))}</p>${e?`<p>Evidência do anúncio: ${safe(e.classificacao.programa)} • ${safe(e.classificacao.regra)}. Esta evidência não substitui o programa da campanha.</p><p>${safe(e.videos.map(v=>[v.youtubeVideoId,v.youtubeVideoTitle].filter(Boolean).join(' — ')).join('; '))}</p>`:''}</div>`;
    $('#drawerOverlay').classList.add('show');$('#drawerClose').focus();
  };
  const closeDrawer=()=>$('#drawerOverlay').classList.remove('show');
  const render=()=>{
    updateDateControls();renderNav();
    if(!data){clearViews();return;}
    model=buildModel();
    $('#rangeBadge').textContent=range();
    $('#overview-sub').textContent=`${states.program==='ALL'?'Todos os programas':states.program==='OUTROS'?'Campanhas não classificadas':states.program} • ${states.account==='ALL'?'Duas contas':(data.metadata.account_names||{})[states.account]||states.account} • ${states.network==='ALL'?'Todas as redes':states.network} • ${range()}.`;
    $('#sourceBadge').textContent=`V6.1 • ADS API • ${data.consulta?.origem==='cache_memoria'?'CACHE':'DIRETO'}`;
    $('#sourceBadge').classList.add('live');
    const meta=data.metadata||{};
    const c=model.total;
    const pending=new Set(model.campaigns.filter(r=>r.program==='OUTROS').map(r=>r.account+'|'+r.campaignId)).size;
    const originLabel=data.consulta?.origem==='cache_memoria'?`Cache em memória (${Math.floor((data.consulta?.idade_segundos||0)/60)} min)`:'Consulta direta à API';
    const timeLabel=data.consulta?.consultado_em?new Date(data.consulta.consultado_em).toLocaleString('pt-BR'):'';
    status(`${originLabel} • ${timeLabel} • ${range()} • ${n(c.impressions)} impressões • ${meta.currency_code?'Moeda: '+meta.currency_code:'Moeda não confirmada'} • ${states.account==='ALL'?'2 contas':meta.account_names?.[states.account]||states.account} • ${states.network==='ALL'?'Todas as redes':states.network} • ${pending} campanha(s) em Outros / pendentes; filtro por campanha`,true);
    renderKpis();renderTrend();renderProgram();renderFormats();renderInsights();renderCreatives();
    renderBars(model.age,'ageBars',ageName);renderBars(model.gender,'genderBars',genderName);renderCities();renderDevices();renderHeat();
  };
  const refresh=render;
  const exportCSV=()=>{
    if(!data||!model)return;
    let head=[],rows=[];
    const from=r=>[r.account,r.network,r.program,r.campaignId,r.campaignName,r.impressions,r.views,r.cost.toFixed(6),r.clicks];
    if(states.page==='overview'){head=['Conta','Rede','Programa','ID_Campanha','Campanha','Impressoes','TrueView','Custo_Moeda_Conta','Cliques']; rows=model.campaigns.map(from)}
    else if(states.page==='creative'){head=['Conta','Programa','ID_Anuncio','Campanha','Tipo','Impressoes','TrueView','Custo_Moeda_Conta','Cliques'];rows=currentCreatives().map(x=>[x.account,x.program,x.id,x.name,x.type,x.r.impressions,x.r.views,x.r.cost.toFixed(6),x.r.clicks])}
    else if(states.page==='audience'){head=['Relatorio','Conta','Rede','Programa','Categoria','Impressoes','TrueView','Custo_Moeda_Conta','Cliques']; rows=[...['age','gender','city','device'].flatMap((k,i)=>model[k].map(r=>[['Idade','Gênero','Cidade_ID','Dispositivo'][i],r.account,r.network,r.program,r.key,r.impressions,r.views,r.cost.toFixed(6),r.clicks]))]}
    else {head=['Conta','Rede','Programa','Dia','Hora','Impressoes','TrueView','Custo_Moeda_Conta','Cliques'];rows=model.hours.map(r=>[r.account,r.network,r.program,r.key.split('|')[0],r.key.split('|')[1],r.impressions,r.views,r.cost.toFixed(6),r.clicks])}
    const csv=[head,...rows].map(a=>a.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`ads_eptv_${states.page}_${states.program}_${states.inicio}_${states.fim}_${states.account}_${states.network}_${data?.metadata?.currency_code||'MOEDA_NAO_INFORMADA'}.csv`;a.click();URL.revokeObjectURL(url);
  };
  $('#accountFilter').onchange=e=>{states.account=e.target.value;render()};
  $('#networkFilter').onchange=e=>{states.network=e.target.value;render()};
  $('#programMetric').onclick=e=>{const b=e.target.closest('[data-metric]');if(b){states.programMetric=b.dataset.metric;renderProgram()}};
  $('#formatCampaignSelect').onchange=e=>{states.formatKey=e.target.value;renderFormats()};
  $('#programFilter').onclick=e=>{let b=e.target.closest('[data-prog]');if(!b)return;states.program=b.dataset.prog;$$('#programFilter button').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b))});refresh()};
  $('#periodFilter').onsubmit=e=>{e.preventDefault();loadPeriod($('#dateStart').value,$('#dateEnd').value)};
  $$('.navbtn').forEach(b=>b.onclick=()=>{states.page=b.dataset.page;renderNav();window.scrollTo({top:0,behavior:states.motion?'smooth':'auto'})});
  $('#creativeSearch').oninput=e=>{states.search=e.target.value;model&&renderCreatives()};
  $('#creativeSort').onchange=e=>{states.sort=e.target.value;model&&renderCreatives()};
  $('#trendMetric').onclick=e=>{let b=e.target.closest('[data-metric]');if(!b)return;states.trend=b.dataset.metric;model&&renderTrend();$$('#trendMetric button').forEach(x=>x.classList.toggle('active',x===b))};
  $('#heatMetric').onclick=e=>{let b=e.target.closest('[data-metric]');if(!b)return;states.heat=b.dataset.metric;model&&renderHeat();$$('#heatMetric button').forEach(x=>x.classList.toggle('active',x===b))};
  $('#downloadBtn').onclick=exportCSV;
  $('#motionBtn').onclick=()=>{states.motion=!states.motion;document.documentElement.dataset.motion=states.motion?'on':'off';$('#motionText').textContent=states.motion?'Efeitos ligados':'Efeitos desligados'};
  $('#drawerClose').onclick=closeDrawer;$('#drawerOverlay').onclick=e=>{if(e.target.id==='drawerOverlay')closeDrawer()};
  const showInfo=()=>{$('#infoModal').classList.add('show');$('#infoClose').focus()};
  const closeInfo=()=>$('#infoModal').classList.remove('show');
  $('#infoBtn').onclick=showInfo;$('#footerInfo').onclick=showInfo;$('#infoClose').onclick=closeInfo;$('#infoModal').onclick=e=>{if(e.target.id==='infoModal')closeInfo()};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDrawer();closeInfo()}});
  $('#refreshDataBtn').onclick=()=>{if(states.inicio)loadPeriod(states.inicio,states.fim,{force:true})};
  const boot=async()=>{
    status('Conectando ao servidor local e preparando as duas contas da Google Ads API…');
    try{
      const req=await fetch('/api/status',{cache:'no-store'});
      const res=await req.json();
      if(!req.ok)throw new Error(res.erro||'Servidor local indisponível');
      if(res.modo!=='api_dinamica')throw new Error('Servidor antigo encontrado. Reinicie o painel com o script da V6.1.');
      if(!res.intervalo_personalizado||!/^\d{4}-\d{2}-\d{2}$/.test(res.data_maxima))throw new Error('Reinicie o servidor para habilitar o calendário');
      dateLimits.max=res.data_maxima;
      const first=new Date(dateLimits.max+'T00:00:00Z');first.setUTCDate(first.getUTCDate()-364);
      $('#dateStart').value=first.toISOString().slice(0,10);$('#dateEnd').value=dateLimits.max;
      await loadPeriod($('#dateStart').value,$('#dateEnd').value);
    }catch(e){status('Falha ao inicializar consultas: '+e.message+' • Execute scripts\\05_iniciar_dashboard_local.ps1 com a atualização V6.1.');}
    renderNav();updateDateControls();
  };
  const autoRefresh=()=>{if(!document.hidden&&lastLoadAt&&Date.now()-lastLoadAt>=15*60*1000&&!inflight)loadPeriod(states.inicio,states.fim);};
  window.setInterval(autoRefresh,5*60*1000);
  document.addEventListener('visibilitychange',autoRefresh);
  boot();
})();
