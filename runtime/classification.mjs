// Port of backend/classificacao_programas.py. Differential tests enforce parity.
export const programs = new Set(['BDC', 'EPTV1', 'EPTV2']);
export const normalized = text => String(text).toUpperCase().normalize('NFD').replace(/\p{Mn}/gu, '');
export function nameHits(text) {
  text = normalized(text).replace(/SINAL[ _-]+EPTV[ _-]+\d+/g, 'SINAL EPTV');
  const hits = new Set();
  if (/(?<![A-Z0-9])BDC(?![A-Z0-9])|(?<![A-Z0-9])BOM[ _-]+DIA[ _-]+CIDADE(?![A-Z0-9])/.test(text)) hits.add('BDC');
  for (const n of [1, 2]) if (new RegExp(`(?<![A-Z0-9])EPTV[ _-]*${n}(?![A-Z0-9])`).test(text)) hits.add(`EPTV${n}`);
  return hits;
}
export function buildInventory(raw, account, mapping, official, version) {
  const decision = (programa='NAO_CLASSIFICADO', origem='sem_evidencia', regra='sem_identificador_inequivoco', evidencias=[]) => ({
    programa, origem, regra, confianca: programs.has(programa)?'alta':'pendente',
    estado: programs.has(programa)?'classificado':'pendente', evidencias, versao:version,
  });
  const byText = (text, source) => {
    const hits=nameHits(text);
    return hits.size===1?decision([...hits][0],source,'identificador_explicito',[String(text)]):
      decision(undefined,source,hits.size?'multiplos_programas':undefined,hits.size?[String(text)]:[]);
  };
  const labels=Object.fromEntries(raw.labels.map(r=>[r.label.resourceName,r.label.name||'']));
  const assets=Object.fromEntries(raw.assets.map(r=>[r.asset.resourceName,r.asset.youtubeVideoAsset||{}]));
  const campaigns=Object.fromEntries(raw.campaigns.map(r=>[String(r.campaign.id),r.campaign]));
  const children=Object.fromEntries(Object.keys(campaigns).map(cid=>[cid,[]]));
  const labelDecision = refs => {
    const found=refs.filter(ref=>Object.hasOwn(official,ref)), hits=new Set(found.map(ref=>official[ref]));
    if(hits.size===1)return decision([...hits][0],'rotulo_oficial','id_rotulo_confirmado',found.map(id=>({id,nome:labels[id]||''})));
    return hits.size?decision(undefined,'rotulo_oficial','rotulos_conflitantes',found):null;
  };
  function* texts(obj) {
    if(Array.isArray(obj)){for(const value of obj)yield* texts(value);}
    else if(obj&&typeof obj==='object')for(const [key,value] of Object.entries(obj)){
      if(['name','text','headline','actionHeadline','youtubeVideoTitle'].includes(key)&&typeof value==='string')yield value;
      else if(value&&typeof value==='object')yield* texts(value);
    }
  }
  function* refs(obj) {
    if(Array.isArray(obj)){for(const value of obj)yield* refs(value);}
    else if(obj&&typeof obj==='object')for(const [key,value] of Object.entries(obj)){
      if(key==='asset'&&typeof value==='string')yield value;
      else if(value&&typeof value==='object')yield* refs(value);
    }
  }
  for(const row of raw.ads){
    const cid=String(row.campaign.id), group=row.adGroup||{}, aga=row.adGroupAd, ad=aga.ad;
    if(!children[cid])throw new Error('Inventário de classificação incompleto: campanha de anúncio ausente.');
    const videos=[...refs(ad)].map(ref=>assets[ref]||{}), values=[...texts(ad),...texts(videos)];
    const sources=[byText(group.name||'','grupo_anuncios'),byText(values.join(' | '),'criativo_video')];
    const label=labelDecision([...(group.labels||[]),...(aga.labels||[])]);
    const hits=new Set([group.name||'',...values].flatMap(text=>[...nameHits(text)]));
    const result=label||(hits.size>1?decision(undefined,'grupo_criativo','evidencias_conflitantes',[group.name||'',...values]):
      sources.find(d=>programs.has(d.programa))||decision());
    children[cid].push({id:String(ad.id),grupo_id:String(group.id||''),classificacao:result,videos});
  }
  const result={};
  for(const [cid,campaign] of Object.entries(campaigns)){
    const fixed=mapping[`${account}:${cid}`]??mapping[cid];
    const named=byText(campaign.name||'','nome_campanha'), ads=children[cid];
    const known=new Set(ads.map(a=>a.classificacao.programa).filter(p=>programs.has(p)));
    const conflicts=ads.filter(a=>['evidencias_conflitantes','rotulos_conflitantes'].includes(a.classificacao.regra));
    let classified=fixed?decision(fixed,'mapeamento_id','id_confirmado',[`${account}:${cid}`]):labelDecision(campaign.labels||[]);
    if(!classified){
      if(conflicts.length)classified=decision(undefined,'grupo_criativo','evidencias_conflitantes',conflicts.map(a=>a.id));
      else if(known.size>1||(programs.has(named.programa)&&[...known].some(p=>p!==named.programa)))
        classified=decision(undefined,'campanha_mista','requer_granularidade_anuncio',[...new Set([...known,...(programs.has(named.programa)?[named.programa]:[])])].sort());
      else if(programs.has(named.programa)||nameHits(campaign.name||'').size)classified=named;
      else if(ads.length&&known.size===1&&ads.every(a=>programs.has(a.classificacao.programa)))
        classified=decision([...known][0],'consenso_anuncios','todos_anuncios_mesmo_programa',ads.map(a=>a.id));
      else classified=decision(undefined,'inventario',known.size?'evidencia_parcial':'sem_identificador_inequivoco');
    }
    result[cid]={campanha:campaign,classificacao:classified,anuncios:ads};
  }
  return result;
}

export function enrich(row, inventory, account){
  const cid=String(row.campaign?.id||''), item=inventory[cid];
  if(!item)throw new Error('Inventário de classificação incompleto: campanha de relatório ausente.');
  const result={...row,programa:item.classificacao.programa,classificacaoPrograma:item.classificacao,sourceCustomerId:account};
  if(row.metrics?.costMicros!==undefined)result.costInAccountCurrency=Number(row.metrics.costMicros)/1e6;
  const adId=String(row.adGroupAd?.ad?.id||'');
  if(adId){
    const evidence=item.anuncios.find(a=>a.id===adId);
    if(!evidence)throw new Error('Inventário de classificação incompleto: anúncio de relatório ausente.');
    result.evidenciaProgramaAnuncio=evidence;
  }
  return result;
}
