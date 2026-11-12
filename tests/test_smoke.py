"""Execute com pytest em ambiente de testes; os dados abaixo são apenas fixtures, não são exportados ao dashboard real."""
import json
from pathlib import Path
from http.server import ThreadingHTTPServer
from threading import Thread
from urllib.request import urlopen, Request
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import dashboard_server


def fixture(days):
    metrics={'impressions':'1000','videoTrueviewViews':'200','costMicros':'125000000','clicks':'15'}
    def row(name, camp, program, extra):
        return {'campaign':{'id':str(camp),'name':name}, 'metrics':metrics, 'programa':program, **extra}
    reports={k:[] for k in ('campanhas','criativos','dispositivos','idade','genero','cidades','dia_hora')}
    if days>=90:
        reports['campanhas']=[row('BDC TESTE',123,'BDC',{'segments':{'date':'2026-10-11'}}),row('EPTV1 [MANUT]',124,'EPTV1',{'segments':{'date':'2026-10-12'}}),row('MISTO',125,'NAO_CLASSIFICADO',{'segments':{'date':'2026-10-12'}})]
        reports['criativos']=[row('BDC TESTE',123,'BDC',{'adGroupAd':{'ad':{'id':'999','type':'VIDEO'},'status':'ENABLED'}})]
        reports['dispositivos']=[row('BDC TESTE',123,'BDC',{'segments':{'device':'MOBILE'}})]
        reports['idade']=[row('BDC TESTE',123,'BDC',{'adGroupCriterion':{'ageRange':{'type':'AGE_RANGE_25_34'}}})]
        reports['genero']=[row('BDC TESTE',123,'BDC',{'adGroupCriterion':{'gender':{'type':'MALE'}}})]
        reports['cidades']=[row('BDC TESTE',123,'BDC',{'segments':{'geoTargetCity':'123456'}})]
        reports['dia_hora']=[row('BDC TESTE',123,'BDC',{'segments':{'dayOfWeek':'MONDAY','hour':8}})]
    return {'origem':'Google Ads API', 'customer_id':'7182459480','extraido_em':'2026-11-12T12:00:00-03:00','dias':days,'filtro_rede':'YOUTUBE','relatorios':reports,'erros':{},'metadata':{'currency_code':'BRL','time_zone':'America/Sao_Paulo'}}


def test_server(tmp_path,monkeypatch):
    monkeypatch.setattr(dashboard_server, 'settings', lambda: ('7182459480','9234046127',Path('/dummy.json')))
    s=ThreadingHTTPServer(('127.0.0.1',0), dashboard_server.Handler)
    thread=Thread(target=s.serve_forever, daemon=True);thread.start()
    try:
        with urlopen(f'http://127.0.0.1:{s.server_port}/api/status') as r:
            obj=json.load(r);assert obj['periodos']==[7,30,90,365]
        try:
            with urlopen(Request(f'http://127.0.0.1:{s.server_port}/api/snapshot/365',headers={'Host':'attacker.example'})) as r:
                assert False
        except Exception as e:
            assert '403' in str(e)
        with urlopen(f'http://127.0.0.1:{s.server_port}/backend/credentials.json') as r:
            assert False
    except Exception as e:
        if '404' not in str(e): raise
    finally:
        s.shutdown();s.server_close();thread.join(timeout=3)

if __name__=='__main__':
    import tempfile
    from types import SimpleNamespace
    from pytest import MonkeyPatch
    with tempfile.TemporaryDirectory() as d:
        m=MonkeyPatch();test_server(Path(d),m);m.undo();print('smoke test OK')
