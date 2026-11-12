"""Dados SIMULADOS com totais coerentes com a auditoria de 90 dias, nenhuma API real."""
import sys
from pathlib import Path
from decimal import Decimal
from collections import defaultdict
from unittest.mock import patch
import json

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
import dashboard_server as app
from classificacao_programas import build_inventory, INVENTORY_QUERIES

ACCOUNTS = {
 '7182459480': [
  ('YOUTUBE',439628,48117,50,1502711448,'[Manut] [Jornalismo] [Outubro]', '23152772320'),
  ('CONTENT',27612,1667,32,235159118,'[Manut] [Jornalismo] [Outubro]', '23152772320')],
 '5498287982': [
  ('YOUTUBE',3395,759,0,54150000,'EPTV_BDC_VIEWS_PULAVEL', '24450345081')]
}
class Reader:
 calls=[]
 def __init__(self,cid,mid,key):
  self.cid=cid
  assert mid=='9234046127'
 def gaql(self,q):
  self.calls.append((self.cid,q))
  if 'FROM customer ' in q:
   return [{'customer':{'currencyCode':'BRL','timeZone':'America/Sao_Paulo'}}]
  if 'FROM geo_target_constant ' in q:
   return []
  if q in INVENTORY_QUERIES.values():
   kind=next(k for k,v in INVENTORY_QUERIES.items() if v==q)
   if kind in ('labels','assets'):return []
   rows=[]
   for _,_,_,_,_,name,cid in ACCOUNTS[self.cid]:
    row={'campaign':{'id':cid,'name':name}}
    if kind=='ads':row.update({'adGroup':{'id':'10','name':name},'adGroupAd':{'ad':{'id':cid+'99'}}})
    if row not in rows:rows.append(row)
   return rows
  res=[]
  for network, imp,views,clicks,cost,name,id in ACCOUNTS[self.cid]:
   data={'campaign':{'id':id,'name':name},'segments':{'adNetworkType':network,'date':'2026-09-10'},
         'metrics':{'impressions':str(imp),'videoTrueviewViews':str(views),'clicks':str(clicks),'costMicros':str(cost),'trueviewAverageCpv':10046.52 if self.cid=='7182459480' else 32779.19,
                    'videoTrueviewViewRateInStream':0.5177,'videoTrueviewViewRateInFeed':0.0655,'videoQuartileP25Rate':0.6362}}
   if 'FROM ad_group_ad ' in q:
    data['adGroupAd']={'ad':{'id':id+'99','type':'VIDEO'},'status':'ENABLED'}
   if 'FROM age_range_view ' in q:data['adGroupCriterion']={'ageRange':{'type':'AGE_RANGE_25_34'}}
   if 'FROM gender_view ' in q:data['adGroupCriterion']={'gender':{'type':'FEMALE'}}
   if 'FROM geographic_view ' in q:data['segments']['geoTargetCity']='geoTargetConstants/1023191'
   if 'segments.day_of_week' in q:data['segments'].update({'dayOfWeek':'THURSDAY','hour':9})
   if 'segments.device' in q:data['segments']['device']='MOBILE'
   if 'WHERE segments.date' not in q:raise AssertionError('No period')
   res.append(data)
  return res

def test_reconciles_and_cache(monkeypatch):
 app.CACHE.clear();app.CLASSIFICATION_CACHE.clear();app.GEO_NAMES.clear();Reader.calls=[]
 monkeypatch.setattr(app,'AdsReader',Reader)
 monkeypatch.setattr(app,'settings',lambda:('7182459480','9234046127',Path('/tmp/test-dummy.json')))
 monkeypatch.setattr(app,'program_map',lambda:{})
 monkeypatch.setattr(app,'_resolve_city_names',lambda reader,reports:{})
 monkeypatch.setenv('GOOGLE_ADS_CUSTOMER_IDS','7182459480,5498287982')
 data=app.fetch_live(90)
 assert data['filtro_rede']=='ALL'
 assert data['customer_ids']==['7182459480','5498287982']
 assert set(data['relatorios'])==set(app.REPORTS)
 assert all('sourceCustomerId' in x for rows in data['relatorios'].values() for x in rows)
 assert all('YOUTUBE' not in q.split('WHERE')[1] for cid,q in Reader.calls if 'FROM campaign ' in q)
 campaigns=data['relatorios']['campanhas']
 sums={'impressions':sum(int(r['metrics'].get('impressions',0)) for r in campaigns),
       'views':sum(int(r['metrics'].get('videoTrueviewViews',0)) for r in campaigns),
       'clicks':sum(int(r['metrics'].get('clicks',0)) for r in campaigns),
       'costMicros':sum(int(r['metrics'].get('costMicros',0)) for r in campaigns)}
 assert sums=={'impressions':470635,'views':50543,'clicks':82,'costMicros':1792020566}
 assert {r['sourceCustomerId'] for r in campaigns}==set(ACCOUNTS)
 assert len([r for r in campaigns if r['segments']['adNetworkType']=='YOUTUBE'])==2
 assert any('metrics.video_trueview_view_rate_shorts' in q for _,q in Reader.calls)
 assert all('metrics.trueview_average_cpv' in q for cid,q in Reader.calls if 'FROM ad_group_ad ' in q and 'metrics.' in q)
 calls=len(Reader.calls)
 cached=app.fetch_live(90)
 assert cached['consulta']['origem']=='cache_memoria' and len(Reader.calls)==calls
 assert app.fetch_live(90,force=True)['consulta']['origem']=='cache_memoria'


def test_failure_not_cached(monkeypatch):
 class FailOnAccount(Reader):
  def gaql(self,q):
   if self.cid=='5498287982' and 'FROM campaign ' in q:
    raise RuntimeError('Forbidden')
   return super().gaql(q)
 app.CACHE.clear()
 monkeypatch.setattr(app,'AdsReader',FailOnAccount)
 monkeypatch.setattr(app,'settings',lambda:('7182459480','9234046127',Path('/tmp/test-dummy.json')))
 monkeypatch.setattr(app,'program_map',lambda:{})
 monkeypatch.setenv('GOOGLE_ADS_CUSTOMER_IDS','7182459480,5498287982')
 import pytest
 with pytest.raises(RuntimeError,match='Forbidden'):app.fetch_live(90)
 assert not app.CACHE


# Execução adicional sem pytest: python -m unittest discover -s tests -p test_v61.py -v
import unittest
from copy import deepcopy
from classificacao_programas import name_hits
from extrair_google_ads import enriched_row


class LocalPatch:
 def __init__(self): self.patches=[]
 def setattr(self,obj,name,value):
  p=patch.object(obj,name,value);p.start();self.patches.append(p)
 def setenv(self,name,value):
  p=patch.dict('os.environ',{name:value});p.start();self.patches.append(p)
 def close(self):
  for p in reversed(self.patches):p.stop()


def inventory_fixture(names=('EPTV1',), campaign='Campanha genérica'):
 return {'campaigns':[{'campaign':{'id':'123','name':campaign}}], 'labels':[], 'assets':[],
         'ads':[{'campaign':{'id':'123'},'adGroup':{'id':str(i),'name':name},
                 'adGroupAd':{'ad':{'id':str(i+100),'name':name}}} for i,name in enumerate(names)]}


class ClassificationTests(unittest.TestCase):
 def setUp(self):
  self.mp=LocalPatch();self.addCleanup(self.mp.close)
  app.CACHE.clear();app.CLASSIFICATION_CACHE.clear()
 def test_existing_reconciliation_and_cache(self):
  test_reconciles_and_cache(self.mp)
 def test_existing_http_security(self):
  from test_v6 import test_server_local_and_no_secrets
  test_server_local_and_no_secrets(self.mp)
 def test_existing_single_account_cache(self):
  from test_v6 import test_dynamic_7_reports_and_cache
  test_dynamic_7_reports_and_cache(self.mp)
 def test_identifiers_and_false_positives(self):
  for text,expected in [('EPTV 1','EPTV1'),('EPTV -2','EPTV2'),('Jornal da EPTV 1° edição','EPTV1'),
                        ('BOM DIA CIDADE','BDC'),('[CHAMADAS_BDC]','BDC')]:
   self.assertEqual(name_hits(text),{expected})
  for text in ('SINAL EPTV 1','SINAL EPTV 2','Jornalismo','Jonatan Morel','Primeira Edição', 'Segunda Edição','EPTV12','XEPTV1'):
   self.assertEqual(name_hits(text),set())
 def test_consensus_and_ad_trace(self):
  raw=inventory_fixture();inv=build_inventory(raw,'7182459480',{})
  self.assertEqual(inv['123']['classificacao']['programa'],'EPTV1')
  self.assertEqual(inv['123']['classificacao']['origem'],'consenso_anuncios')
  row={'campaign':{'id':'123'},'adGroupAd':{'ad':{'id':'100'}},'metrics':{'costMicros':'1234567','impressions':'100'}}
  before=deepcopy(row);out=enriched_row(row,{},account='7182459480',inventory=inv)
  self.assertEqual(out['metrics'],row['metrics']);self.assertEqual(row,before)
  self.assertEqual(out['evidenciaProgramaAnuncio']['classificacao']['programa'],'EPTV1')
 def test_partial_and_mixed_never_split_metrics(self):
  for names in [('EPTV1','genérico'),('EPTV1','EPTV2'),('EPTV1 BDC',)]:
   inv=build_inventory(inventory_fixture(names),'7182459480',{})
   self.assertEqual(inv['123']['classificacao']['programa'],'NAO_CLASSIFICADO')
   rows=[{'campaign':{'id':'123'},'metrics':{'costMicros':cost}} for cost in ('5','9')]
   out=[enriched_row(r,{},inventory=inv) for r in rows]
   self.assertEqual(len(out),2);self.assertEqual(sum(int(r['metrics']['costMicros']) for r in out),14)
 def test_explicit_account_mapping_precedes_name(self):
  raw=inventory_fixture(('EPTV2',),'EPTV2')
  mapping={'7182459480:123':'EPTV1','123':'BDC'}
  self.assertEqual(build_inventory(raw,'7182459480',mapping)['123']['classificacao']['programa'],'EPTV1')
  self.assertEqual(build_inventory(raw,'5498287982',mapping)['123']['classificacao']['programa'],'BDC')
 def test_official_label_requires_confirmation(self):
  raw=inventory_fixture(('genérico',))
  ref='customers/7182459480/labels/1'
  raw['labels']=[{'label':{'resourceName':ref,'name':'EPTV2'}}]
  raw['campaigns'][0]['campaign']['labels']=[ref]
  self.assertEqual(build_inventory(raw,'7182459480',{})['123']['classificacao']['programa'],'NAO_CLASSIFICADO')
  self.assertEqual(build_inventory(raw,'7182459480',{}, {ref:'EPTV2'})['123']['classificacao']['origem'],'rotulo_oficial')
 def test_conflicting_labels_pending(self):
  raw=inventory_fixture();refs=['customers/7182459480/labels/1','customers/7182459480/labels/2']
  raw['campaigns'][0]['campaign']['labels']=refs
  self.assertEqual(build_inventory(raw,'7182459480',{},dict(zip(refs,['BDC','EPTV1'])))['123']['classificacao']['regra'],'rotulos_conflitantes')
 def test_video_evidence_and_conflict(self):
  raw=inventory_fixture(('genérico',));ad=raw['ads'][0]['adGroupAd']['ad']
  ad['videoResponsiveAd']={'videos':[{'asset':'video1'}]}
  raw['assets']=[{'asset':{'resourceName':'video1','youtubeVideoAsset':{'youtubeVideoId':'x','youtubeVideoTitle':'Juliana | EPTV1 | EPTV'}}}]
  self.assertEqual(build_inventory(raw,'7182459480',{})['123']['classificacao']['programa'],'EPTV1')
  ad['name']='EPTV2'
  self.assertEqual(build_inventory(raw,'7182459480',{})['123']['classificacao']['programa'],'NAO_CLASSIFICADO')
 def test_campaign_child_conflict_pending(self):
  inv=build_inventory(inventory_fixture(('EPTV1',),'BDC'),'7182459480',{})
  self.assertEqual(inv['123']['classificacao']['programa'],'NAO_CLASSIFICADO')
  inv=build_inventory(inventory_fixture(('EPTV1 BDC',),'EPTV1'),'7182459480',{})
  self.assertEqual(inv['123']['classificacao']['programa'],'NAO_CLASSIFICADO')
 def test_missing_entity_aborts(self):
  with self.assertRaisesRegex(RuntimeError,'incompleto'):
   enriched_row({'campaign':{'id':'missing'}},{},inventory={})
  inv=build_inventory(inventory_fixture(),'7182459480',{})
  with self.assertRaisesRegex(RuntimeError,'anúncio'):
   enriched_row({'campaign':{'id':'123'},'adGroupAd':{'ad':{'id':'missing'}}},{},inventory=inv)
 def configure(self,reader=Reader):
  self.mp.setattr(app,'AdsReader',reader)
  self.mp.setattr(app,'settings',lambda:('7182459480','9234046127',Path('/dummy.json')))
  self.mp.setattr(app,'program_map',lambda:{})
  self.mp.setattr(app,'official_labels',lambda:{})
  self.mp.setenv('GOOGLE_ADS_CUSTOMER_IDS','7182459480,5498287982')
 def test_inventory_failure_not_cached(self):
  class Failure(Reader):
   def gaql(self,q):
    if self.cid=='5498287982' and q==INVENTORY_QUERIES['assets']:raise RuntimeError('Inventário indisponível')
    return super().gaql(q)
  self.configure(Failure)
  with self.assertRaisesRegex(RuntimeError,'Inventário'):app.fetch_live(90)
  self.assertFalse(app.CACHE);self.assertFalse(app.CLASSIFICATION_CACHE)
 def test_http_failure_clear_without_partial_consolidation(self):
  from http.server import ThreadingHTTPServer
  from threading import Thread
  from urllib.request import Request, urlopen
  from urllib.error import HTTPError
  server=ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
  thread=Thread(target=server.serve_forever,daemon=True);thread.start()
  try:
   with patch.object(app,'fetch_live',side_effect=RuntimeError('Relatório obrigatório indisponível')):
    with self.assertRaises(HTTPError) as error:
     urlopen(Request(f'http://127.0.0.1:{server.server_port}/api/relatorios?dias=90',headers={'X-Ads-Request':'dashboard'}),timeout=3)
    self.assertEqual(error.exception.code,502)
    body=json.loads(error.exception.read())
    self.assertIn('Relatório obrigatório',body['erro']);self.assertNotIn('relatorios',body)
  finally:
   server.shutdown();server.server_close();thread.join(timeout=3)
 def test_report_failure_not_cached(self):
  class Failure(Reader):
   def gaql(self,q):
    if self.cid=='5498287982' and 'FROM campaign ' in q and 'metrics.' in q:raise RuntimeError('Relatório indisponível')
    return super().gaql(q)
  self.configure(Failure)
  with self.assertRaisesRegex(RuntimeError,'Relatório'):app.fetch_live(90)
  self.assertFalse(app.CACHE);self.assertFalse(app.CLASSIFICATION_CACHE)
 def test_inventory_reused_across_periods(self):
  self.configure();Reader.calls=[]
  app.fetch_live(90);app.fetch_live(30)
  self.assertEqual(sum(q in INVENTORY_QUERIES.values() for _,q in Reader.calls),8)
 def test_all_reports_same_classification(self):
  self.configure();data=app.fetch_live(90)
  by_id={r['campaign']['id']:r['classificacaoPrograma'] for r in data['relatorios']['campanhas']}
  for rows in data['relatorios'].values():
   for row in rows:self.assertEqual(row['classificacaoPrograma'],by_id[row['campaign']['id']])
 def test_queries_unbounded_metadata(self):
  for q in INVENTORY_QUERIES.values():
   self.assertNotIn('LIMIT',q);self.assertNotIn('segments.date',q)
  self.assertIn('REMOVED',INVENTORY_QUERIES['ads'])


class CalendarPeriodTests(unittest.TestCase):
 def setUp(self):
  from datetime import datetime
  self.clock=patch.object(app,'now_local',return_value=datetime(2026,11,12,12))
  self.clock.start();self.addCleanup(self.clock.stop)
  self.mp=LocalPatch();self.addCleanup(self.mp.close)
  self.mp.setattr(app,'AdsReader',Reader)
  self.mp.setattr(app,'settings',lambda:('7182459480','9234046127',Path('/dummy.json')))
  self.mp.setattr(app,'program_map',lambda:{})
  self.mp.setattr(app,'official_labels',lambda:{})
  self.mp.setenv('GOOGLE_ADS_CUSTOMER_IDS','7182459480,5498287982')
  app.CACHE.clear();app.CLASSIFICATION_CACHE.clear();Reader.calls=[]
 def test_arbitrary_and_single_day_ranges(self):
  for start,end,days in [('2026-11-01','2026-11-11',11),('2026-08-14','2026-11-11',90),('2026-11-11','2026-11-11',1)]:
   data=app.fetch_live(inicio=start,fim=end)
   self.assertEqual((data['periodo_inicio'],data['periodo_fim'],data['dias']),(start,end,days))
   for _,q in Reader.calls:
    if 'metrics.' in q:
     self.assertIn('segments.date BETWEEN',q)
   Reader.calls=[]
 def test_same_dates_in_every_report(self):
  app.fetch_live(inicio='2026-09-03',fim='2026-09-19')
  queries=[q for _,q in Reader.calls if 'metrics.' in q]
  self.assertEqual(len(queries),16)
  self.assertTrue(all("segments.date BETWEEN '2026-09-03' AND '2026-09-19'" in q for q in queries))
 def test_invalid_dates_do_not_call_api(self):
  for params in ({'inicio':'2026-02-30','fim':'2026-03-01'}, {'inicio':'2026-11-11'},
                 {'inicio':'2026-11-12','fim':'2026-11-12'}, {'inicio':'2026-11-11','fim':'2026-11-01'},
                 {'inicio':'2026-1-01','fim':'2026-01-03'},
                 {'days':90,'inicio':'2026-08-14','fim':'2026-11-11'}):
   with self.assertRaises(ValueError):app.fetch_live(**params)
  self.assertEqual(Reader.calls,[])
 def test_multiyear_interval_has_no_duration_limit(self):
  data=app.fetch_live(inicio='2023-01-01',fim='2026-11-11')
  self.assertGreater(data['dias'],365)
  self.assertEqual((data['periodo_inicio'],data['periodo_fim']),('2023-01-01','2026-11-11'))
  queries=[q for _,q in Reader.calls if 'metrics.' in q]
  self.assertEqual(len(queries),16)
  self.assertTrue(all("segments.date BETWEEN '2023-01-01' AND '2026-11-11'" in q for q in queries))
  self.assertEqual(app.fetch_live(inicio='2023-01-01',fim='2026-11-11')['consulta']['origem'],'cache_memoria')
 def test_cache_uses_both_dates_and_legacy_equivalence(self):
  first=app.fetch_live(90);calls=len(Reader.calls)
  cached=app.fetch_live(inicio='2026-08-14',fim='2026-11-11')
  self.assertEqual(cached['consulta']['origem'],'cache_memoria');self.assertEqual(len(Reader.calls),calls)
  changed=app.fetch_live(inicio='2026-08-13',fim='2026-11-10')
  self.assertEqual(changed['consulta']['origem'],'api')
  self.assertEqual(len(app.CACHE),2)
  self.assertEqual(first['relatorios']['campanhas'],changed['relatorios']['campanhas'])
 def test_http_custom_get_post_and_invalid_parameters(self):
  from http.server import ThreadingHTTPServer
  from threading import Thread
  from urllib.request import Request, urlopen
  from urllib.error import HTTPError
  srv=ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
  thread=Thread(target=srv.serve_forever,daemon=True);thread.start()
  base=f'http://127.0.0.1:{srv.server_port}'
  try:
   for path,method in [('/api/relatorios','GET'),('/api/atualizar','POST')]:
    req=Request(base+path+'?inicio=2026-11-01&fim=2026-11-11',method=method,headers={'X-Ads-Request':'dashboard','Origin':base})
    with urlopen(req,timeout=3) as response:
     self.assertEqual(json.load(response)['dias'],11)
   for query in ('inicio=2026-11-01','inicio=&fim=2026-11-11','inicio=2026-11-01&fim=2026-11-11&dias=7',
                 'inicio=2026-11-01&fim=2026-11-11&fim=2026-11-10','inicio=2026-02-30&fim=2026-03-01'):
    with self.assertRaises(HTTPError) as error:
     urlopen(Request(base+'/api/relatorios?'+query,headers={'X-Ads-Request':'dashboard'}),timeout=3)
    self.assertEqual(error.exception.code,400)
  finally:
   srv.shutdown();srv.server_close();thread.join(timeout=3)
