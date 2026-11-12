"""Testes unitários com cliente Google Ads SIMULADO — não consomem quota."""
import json
from pathlib import Path
import sys
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import urlopen, Request
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
import dashboard_server as app
from classificacao_programas import INVENTORY_QUERIES

METRIC = {'impressions': '1000', 'videoTrueviewViews': '200', 'costMicros': '125000000', 'clicks': '15'}
SAMPLE = {'campaign':{'id':'23631548854','name':'[CHAMADAS_BDC] [JULHO_26]'},'metrics':METRIC}

class FakeReader:
    calls = []
    def __init__(self, cid, mid, key):
        assert cid == '7182459480'
        assert mid == '9234046127'
    def gaql(self, query):
        self.calls.append(query)
        if query in INVENTORY_QUERIES.values():
            kind=next(k for k,v in INVENTORY_QUERIES.items() if v==query)
            if kind in ('labels','assets'):return []
            if kind=='campaigns':return [SAMPLE]
            return [dict(SAMPLE,adGroup={'id':'10','name':'BDC'},adGroupAd={'ad':{'id':'123'}})]
        if 'FROM customer ' in query:
            return [{'customer':{'currencyCode':'BRL','timeZone':'America/Sao_Paulo'}}]
        if 'FROM geo_target_constant ' in query:
            return [{'geoTargetConstant': {'resourceName':'geoTargetConstants/1023191','canonicalName':'Campinas, São Paulo, Brasil'}}]
        if 'FROM age_range_view ' in query:
            return [dict(SAMPLE, adGroupCriterion={'ageRange':{'type':'AGE_RANGE_25_34'}})]
        if 'FROM gender_view ' in query:
            return [dict(SAMPLE, adGroupCriterion={'gender':{'type':'FEMALE'}})]
        if 'FROM geographic_view ' in query:
            return [dict(SAMPLE, segments={'geoTargetCity':'geoTargetConstants/1023191'})]
        if 'FROM ad_group_ad ' in query:
            return [dict(SAMPLE, adGroupAd={'ad':{'id':'123','type':'VIDEO'},'status':'ENABLED'})]
        if 'segments.day_of_week' in query:
            return [dict(SAMPLE, segments={'dayOfWeek':'MONDAY','hour':8})]
        if 'segments.device' in query:
            return [dict(SAMPLE, segments={'device':'MOBILE'})]
        return [dict(SAMPLE, segments={'date':'2026-07-23'})]


def set_fake(monkeypatch):
    monkeypatch.setenv('GOOGLE_ADS_CUSTOMER_IDS','7182459480')
    app.CLASSIFICATION_CACHE.clear()
    app.CACHE.clear(); app.GEO_NAMES.clear(); app.LAST_REQUEST.clear(); FakeReader.calls = []
    monkeypatch.setattr(app, 'AdsReader', FakeReader)
    monkeypatch.setattr(app, 'settings', lambda: ('7182459480', '9234046127', Path('/tmp/dummy-test-credentials.json')))
    monkeypatch.setattr(app, 'program_map', lambda: {})


def test_dynamic_7_reports_and_cache(monkeypatch):
    set_fake(monkeypatch)
    data = app.fetch_live(365)
    assert set(data['relatorios']) == set(app.REPORTS)
    assert data['consulta']['origem'] == 'api'
    assert data['relatorios']['campanhas'][0]['programa'] == 'BDC'
    assert data['metadata']['currency_code'] == 'BRL'
    assert data['metadata']['city_names']['geoTargetConstants/1023191'].startswith('Campinas')
    assert len(FakeReader.calls) == 14  # 8 reports + currency + geo + 4 inventory
    data2=app.fetch_live(365)
    assert data2['consulta']['origem'] == 'cache_memoria'
    assert len(FakeReader.calls) == 14
    data3=app.fetch_live(365,force=True)
    assert data3['consulta']['origem'] == 'cache_memoria'  # force anti-spam 60 s
    assert len(FakeReader.calls) == 14
    data4=app.fetch_live(90)
    assert data4['consulta']['origem'] == 'api'
    assert len(FakeReader.calls) == 23  # 8 reports + currency; inventory and geo reused
    assert len(data4['relatorios']['campanhas']) == 1
    assert 'segments.date BETWEEN' in FakeReader.calls[-4] or any('segments.date BETWEEN' in q for q in FakeReader.calls)


def test_server_local_and_no_secrets(monkeypatch):
    set_fake(monkeypatch)
    srv = ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
    t=threading.Thread(target=srv.serve_forever,daemon=True);t.start()
    base = f'http://127.0.0.1:{srv.server_port}'
    def fetch(path, hdr=None, method='GET'):
        req=Request(base+path,headers=hdr or {},method=method)
        try:
            with urlopen(req,timeout=5) as r:
                return r.status, r.read().decode('utf-8')
        except HTTPError as e:
            return e.code, e.read().decode('utf-8')
    try:
        status, body = fetch('/api/status')
        assert status == 200 and json.loads(body)['modo'] == 'api_dinamica'
        assert 'private_key' not in body and 'token' not in body
        status, _ = fetch('/api/relatorios?dias=365')
        assert status == 403
        status, body = fetch('/api/relatorios?dias=365', {'X-Ads-Request':'dashboard'})
        assert status == 200 and json.loads(body)['relatorios']['campanhas']
        for private_path in ('/backend/credentials.json','/backend/.env','/.env','/backend/dados_privados/','/../backend/.env'):
            status, _ = fetch(private_path)
            assert status == 404
        status, _ = fetch('/api/relatorios?dias=5', {'X-Ads-Request':'dashboard'})
        assert status == 400
        status, _ = fetch('/api/atualizar?dias=365', {'X-Ads-Request':'dashboard'}, 'POST')
        assert status == 403
        status, _ = fetch('/api/atualizar?dias=365', {'X-Ads-Request':'dashboard','Origin':base}, 'POST')
        assert status == 200
        status, _ = fetch('/api/relatorios?dias=365', {'X-Ads-Request':'dashboard','Host':'evil.example'})
        assert status == 403
        status, body = fetch('/')
        assert status == 200 and 'refreshDataBtn' in body and '/api/relatorios' in body
        assert 'uploadSnapshot' not in body
    finally:
        srv.shutdown();srv.server_close();t.join(timeout=3)
