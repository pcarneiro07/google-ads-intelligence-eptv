"""Offline parity oracle; stdin/stdout contain synthetic test records only."""
import json
import sys
import os
import runpy
import types
from datetime import datetime
from decimal import Decimal
from typing import Any
from export_reference import ROOT, function, export

sys.stdin.reconfigure(encoding='utf-8')
pure = {}
exec(compile((ROOT/'backend/classificacao_programas.py').read_text(encoding='utf-8'), 'classification', 'exec'), pure)
env = {**pure, 'Any': Any, 'Decimal': Decimal}
enrich = function('backend/extrair_google_ads.py', 'enriched_row', env)
request = json.load(sys.stdin)
if request['action'] == 'inventory':
    output = pure['build_inventory'](request['raw'], request['account'], request.get('mapping', {}), request.get('labels', {}))
elif request['action'] == 'enrich':
    output = enrich(request['row'], {}, account=request['account'], inventory=request['inventory'])
    output['sourceCustomerId'] = request['account']  # dashboard_server.fetch_live attaches this after enriching.
elif request['action'] == 'reference':
    output = export()
elif request['action'] == 'service':
    # Replace the extractor module before loading the HTTP backend: no dotenv,
    # credentials, network, or import of production authentication is possible.
    module = types.ModuleType('extrair_google_ads')
    query_env = {'date': __import__('datetime').date, 'timedelta': __import__('datetime').timedelta}
    module.report_queries = function('backend/extrair_google_ads.py', 'report_queries', query_env)
    module.enriched_row = enrich
    module.program_map = lambda: request.get('mapping', {})
    module.settings = lambda: ('7182459480', '9234046127', ROOT/'synthetic-unused-key')
    class Reader:
        def __init__(self, cid, *_): self.cid = cid
        def gaql(self, query): return request['responses'][self.cid].get(query, [])
    module.AdsReader = Reader
    sys.modules['extrair_google_ads'] = module
    sys.path.insert(0, str(ROOT/'backend'))
    os.environ['GOOGLE_ADS_CUSTOMER_IDS'] = '7182459480,5498287982'
    os.environ['ADS_DASHBOARD_CACHE_SECONDS'] = '900'
    app = runpy.run_path(str(ROOT/'backend/dashboard_server.py'))
    globals_ = app['fetch_live'].__globals__
    globals_['now_local'] = lambda: datetime.fromisoformat(request['now'].replace('Z', '+00:00'))
    globals_['official_labels'] = lambda: request.get('labels', {})
    output = app['fetch_live'](inicio=request['inicio'], fim=request['fim'])
else:
    raise ValueError('Offline oracle action invalid')
print(json.dumps(output, ensure_ascii=True))
