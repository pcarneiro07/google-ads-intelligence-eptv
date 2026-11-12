"""Export ONLY query templates/configuration from source, never credentials or API data.

AST extraction deliberately avoids importing extrair_google_ads (loads .env).
Run with Python stdlib only. --check fails on source drift.
"""
import ast
import hashlib
import json
from pathlib import Path
import re
import sys
from datetime import date, datetime, timedelta

ROOT = Path(__file__).resolve().parents[1]
FILES = ['backend/extrair_google_ads.py', 'backend/dashboard_server.py',
         'backend/classificacao_programas.py', 'backend/programas.json',
         'backend/rotulos_programas.json', 'frontend/index.html', 'frontend/dashboard.js']


def function(path, name, namespace):
    tree = ast.parse((ROOT / path).read_text(encoding='utf-8'))
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    exec(compile(ast.Module(body=[node], type_ignores=[]), path, 'exec'), namespace)
    return namespace[name]


def export():
    env = {'date': date, 'datetime': datetime, 'timedelta': timedelta, 're': re}
    function(FILES[0], 'report_queries', env)
    queries = function(FILES[1], '_queries_for_dates', env)(1, datetime(2026, 11, 11))
    queries = {k: v.replace('2026-11-11', '__DATE__') for k, v in queries.items()}
    queries = {k: v.replace("BETWEEN '__DATE__' AND '__DATE__'", "BETWEEN '__START__' AND '__END__'") for k, v in queries.items()}
    # Pure module, stdlib only; unlike the extractor, it never loads environment files.
    pure = {}
    exec(compile((ROOT / FILES[2]).read_text(encoding='utf-8'), FILES[2], 'exec'), pure)
    mapping = json.loads((ROOT / FILES[3]).read_text(encoding='utf-8'))
    labels = json.loads((ROOT / FILES[4]).read_text(encoding='utf-8'))
    if not isinstance(mapping, dict) or any(not re.fullmatch(r'(?:\d{10}:)?\d+', k) or v not in pure['PROGRAMS'] for k,v in mapping.items()):
        raise ValueError('Invalid campaign mapping; same validation as Python program_map.')
    if not isinstance(labels, dict) or any(not re.fullmatch(r'customers/\d{10}/labels/\d+', k) or v not in pure['PROGRAMS'] for k,v in labels.items()):
        raise ValueError('Invalid official-label mapping; same validation as Python official_labels.')
    return {
        'version': pure['VERSION'], 'reports': queries, 'inventory': pure['INVENTORY_QUERIES'],
        'accounts': {'7182459480': 'Promo', '5498287982': 'EPTV Institucional'},
        'manager': '9234046127', 'apiVersion': 'v26',
        'mapping': mapping,
        'labels': labels,
        'sourceHashes': {p: hashlib.sha256((ROOT / p).read_text(encoding='utf-8').encode('utf-8')).hexdigest() for p in FILES},
    }


if __name__ == '__main__':
    target = ROOT / 'runtime' / 'reference.json'
    output = json.dumps(export(), ensure_ascii=False, indent=2) + '\n'
    if '--check' in sys.argv:
        if not target.exists() or json.loads(target.read_text(encoding='utf-8')) != json.loads(output):
            sys.exit('Runtime reference is stale: run python migration/export_reference.py and review the diff.')
        print('GAQL, mappings and source fingerprints match the Python reference.')
    else:
        target.parent.mkdir(exist_ok=True)
        target.write_text(output, encoding='utf-8')
        print('Exported query templates and configuration only. No API/credential access.')
