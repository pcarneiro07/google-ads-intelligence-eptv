"""Google Ads Intelligence V6.1 — multiconta e multirrede, com métricas oficiais.

Requisitos no mesmo diretório backend:
  extrair_google_ads.py (o arquivo de autenticação já validado)
  .env e credentials.json (NUNCA servir/publicar)
  programas.json (opcional, classificação manual de campanhas)

Este servidor é local e estritamente somente leitura na Google Ads API.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import threading
import time
from urllib.parse import parse_qs, urlsplit

from extrair_google_ads import AdsReader, settings, report_queries, enriched_row, program_map
from classificacao_programas import fetch_inventory, VERSION as CLASSIFICATION_VERSION

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / 'frontend' / 'index.html'
PORT = int(os.getenv('ADS_DASHBOARD_PORT', '8765'))
PERIODS = (7, 30, 90, 365)
REPORTS = ('campanhas', 'criativos', 'dispositivos', 'idade', 'genero', 'cidades', 'dia_hora', 'formatos')
ACCOUNT_LABELS = {'7182459480': 'Promo', '5498287982': 'EPTV Institucional'}
# Cache SOMENTE na memória do processo; não cria JSON nem snapshot no disco.
CACHE_SECONDS = max(300, min(3600, int(os.getenv('ADS_DASHBOARD_CACHE_SECONDS', '900'))))
MIN_REFRESH_SECONDS = 60
CACHE: dict[tuple, dict] = {}
CLASSIFICATION_CACHE: dict[tuple, dict] = {}
GEO_NAMES: dict[str, str] = {}
LAST_REQUEST: dict[tuple, float] = {}
LOCK = threading.RLock()


def now_local() -> datetime:
    # Conta EPTV operada no Brasil; períodos sempre fechados em D-1 (São Paulo).
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo('America/Sao_Paulo'))
    except Exception:
        # Para instalações Windows sem base tzdata; horário apenas para corte de data.
        return datetime.now(timezone(timedelta(hours=-3)))


def sanitize_error(exc: Exception) -> str:
    msg = str(exc)
    # Nunca retornar headers de autenticação, refresh/access tokens ou chaves privadas.
    msg = re.sub(r'(?i)(bearer\s+)[^\s]+', r'\1[REDACTED]', msg)
    msg = re.sub(r'(?i)(access_token|refresh_token|private_key)\s*[=:]\s*[^\s,]+', r'\1=[REDACTED]', msg)
    return msg[:750] or type(exc).__name__


def _fetch_details(reader: AdsReader) -> tuple[str | None, str | None]:
    try:
        rows = reader.gaql('SELECT customer.currency_code, customer.time_zone FROM customer LIMIT 1')
        c = rows[0].get('customer', {}) if rows else {}
        return c.get('currencyCode'), c.get('timeZone')
    except Exception:
        return None, None


def _resolve_city_names(reader: AdsReader, reports: dict) -> dict:
    # Resolva somente os IDs mais usados, evitando várias chamadas desnecessárias.
    usage = Counter()
    for r in reports.get('cidades', []):
        key = str((r.get('segments') or {}).get('geoTargetCity') or '')
        if re.fullmatch(r'geoTargetConstants/\d+', key):
            usage[key] += int((r.get('metrics') or {}).get('videoTrueviewViews') or 0)
    ids = [k for k, _ in usage.most_common(80) if k not in GEO_NAMES]
    # Máximo 3 operações opcionais por consulta de 7 relatórios.
    for start in range(0, len(ids), 30):
        chunk = ids[start:start + 30]
        ids_gaql = ', '.join("'" + v + "'" for v in chunk)
        query = ('SELECT geo_target_constant.resource_name, '
                 'geo_target_constant.canonical_name, geo_target_constant.name '
                 'FROM geo_target_constant WHERE geo_target_constant.resource_name '
                 'IN (' + ids_gaql + ')')
        try:
            for row in reader.gaql(query):
                loc = row.get('geoTargetConstant') or {}
                if loc.get('resourceName') and (loc.get('canonicalName') or loc.get('name')):
                    GEO_NAMES[str(loc['resourceName'])] = str(loc.get('canonicalName') or loc['name'])
        except Exception:
            # Resolução geográfica é opcional; IDs continuam íntegros no JSON.
            break
    return {key: GEO_NAMES[key] for key in usage if key in GEO_NAMES}


def configured_accounts(primary_id: str) -> tuple[str, ...]:
    # IDs corroborados na auditoria da MCC; podem ser alterados por variável local.
    raw = os.getenv('GOOGLE_ADS_CUSTOMER_IDS', '7182459480,5498287982')
    values = [x.strip().replace('-', '') for x in raw.split(',') if x.strip()]
    if not values or any(not re.fullmatch(r'\d{10}', x) for x in values):
        raise ValueError('GOOGLE_ADS_CUSTOMER_IDS requer IDs de 10 dígitos separados por vírgula')
    return tuple(dict.fromkeys(values))


def _queries_for_dates(days: int, end_date: datetime) -> dict[str, str]:
    from_date = (end_date.date() - timedelta(days=days - 1)).isoformat()
    to_date = end_date.date().isoformat()
    # Usar apenas o modelo legado; o intervalo real é aplicado abaixo em todos
    # os relatórios, sem herdar o limite de dias da CLI antiga.
    result = report_queries(1, somente_youtube=False)
    # report_queries usa date.today() do sistema; fixar o corte para São Paulo.
    for k, q in result.items():
        updated, count = re.subn(
            r"segments\.date BETWEEN '\d{4}-\d{2}-\d{2}' AND '\d{4}-\d{2}-\d{2}'",
            f"segments.date BETWEEN '{from_date}' AND '{to_date}'", q, count=1)
        if count != 1:
            raise ValueError(f'Consulta {k} não tem intervalo de datas validável.')
        result[k] = updated
    # Dados oficiais por campanha e por rede. Taxas por formato NÃO são aditivas.
    intervalo = f"segments.date BETWEEN '{from_date}' AND '{to_date}'"
    result['formatos'] = (
        'SELECT campaign.id, campaign.name, segments.ad_network_type, '
        'metrics.video_trueview_views, metrics.trueview_average_cpv, '
        'metrics.video_trueview_view_rate_in_stream, metrics.video_trueview_view_rate_in_feed, '
        'metrics.video_trueview_view_rate_shorts, metrics.video_quartile_p25_rate, '
        'metrics.video_quartile_p50_rate, metrics.video_quartile_p75_rate, '
        f'metrics.video_quartile_p100_rate FROM campaign WHERE {intervalo}'
    )
    # CPV oficial no nível do anúncio (em micros da moeda da conta).
    result['criativos'] = result['criativos'].replace(
        'metrics.video_trueview_views', 'metrics.video_trueview_views, metrics.trueview_average_cpv')
    return result


def resolve_period(days=None, *, inicio=None, fim=None):
    last_date = now_local().date() - timedelta(days=1)
    if inicio is not None or fim is not None:
        if days is not None or inicio is None or fim is None:
            raise ValueError('Informe início e fim juntos, sem combinar com dias.')
        try:
            if not all(isinstance(v, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', v) for v in (inicio, fim)):
                raise ValueError
            start, end = date.fromisoformat(inicio), date.fromisoformat(fim)
        except ValueError:
            raise ValueError('Datas inválidas. Use AAAA-MM-DD.') from None
    else:
        days = 365 if days is None else days
        if days not in PERIODS:
            raise ValueError('Período inválido. Use 7, 30, 90 ou 365 dias, ou informe início e fim.')
        end = last_date
        start = end - timedelta(days=days - 1)
    count = (end - start).days + 1
    if count < 1:
        raise ValueError('A data inicial não pode ser posterior à data final.')
    if end > last_date:
        raise ValueError('A data final deve ser até ontem (America/Sao_Paulo).')
    return start, end, count


def _cache_key(period: tuple) -> tuple:
    cid, mid, _ = settings()
    mapping_path = Path(__file__).resolve().parent / 'programas.json'
    mapping_stamp = mapping_path.stat().st_mtime_ns if mapping_path.exists() else 0
    label_path = Path(__file__).resolve().parent / 'rotulos_programas.json'
    label_stamp = label_path.stat().st_mtime_ns if label_path.exists() else 0
    return (cid, mid, configured_accounts(cid), period, now_local().date().isoformat(), mapping_stamp,
            label_stamp, CLASSIFICATION_VERSION)


def official_labels() -> dict:
    path = Path(__file__).resolve().parent / 'rotulos_programas.json'
    raw = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    if not isinstance(raw, dict) or any(
            not re.fullmatch(r'customers/\d{10}/labels/\d+', k) or v not in {'BDC', 'EPTV1', 'EPTV2'}
            for k, v in raw.items()):
        raise ValueError('rotulos_programas.json requer IDs oficiais de rótulo e programas válidos.')
    return raw


def fetch_live(days: int | None = None, *, force: bool = False, inicio=None, fim=None) -> dict:
    start, end, days = resolve_period(days, inicio=inicio, fim=fim)
    key = _cache_key((start.isoformat(), end.isoformat()))
    with LOCK:
        now = time.monotonic()
        # Armazenamento apenas volátil; a chave inclui período e contas.
        entry = CACHE.get(key)
        age = now - entry['at'] if entry else float('inf')
        if entry and ((not force and age < CACHE_SECONDS) or (force and age < MIN_REFRESH_SECONDS)):
            result = dict(entry['payload'])
            result['consulta'] = {'origem': 'cache_memoria', 'idade_segundos': round(age),
                                  'cache_ttl_segundos': CACHE_SECONDS,
                                  'consultado_em': entry['consulted_at']}
            return result

        main_id, manager_id, key_path = settings()
        accounts = configured_accounts(main_id)
        if not manager_id and len(accounts) > 1:
            raise ValueError('Uma MCC é necessária para ler duas contas. Configure GOOGLE_ADS_LOGIN_CUSTOMER_ID.')
        end_date = datetime.combine(end, datetime.min.time())
        queries = _queries_for_dates(days, end_date)
        mapping = program_map()
        labels = official_labels()
        inventories = {}
        pending_inventories = {}
        reports = {name: [] for name in REPORTS}
        currency_by_account: dict[str,str] = {}
        timezones: dict[str,str] = {}
        last_reader = None
        # Falha em qualquer conta/relatório aborta a leitura; jamais apresentar subtotal como total.
        for cid in accounts:
            reader = AdsReader(cid, manager_id, key_path)
            last_reader = reader
            currency, tz = _fetch_details(reader)
            if not currency:
                raise RuntimeError(f'Moeda não retornada pela conta {cid}. Total consolidado não é seguro.')
            currency_by_account[cid] = currency
            timezones[cid] = tz or ''
            inventory_key = (cid, manager_id, str(key_path), key[4], key[5:])
            cached_inventory = CLASSIFICATION_CACHE.get(inventory_key)
            if cached_inventory and not force and time.monotonic() - cached_inventory['at'] < CACHE_SECONDS:
                inventory = cached_inventory['inventory']
            else:
                inventory = fetch_inventory(reader, cid, mapping, labels)
                pending_inventories[inventory_key] = {'at': time.monotonic(), 'inventory': inventory}
            inventories[cid] = inventory
            for name in REPORTS:
                for row in reader.gaql(queries[name]):
                    e = enriched_row(row, mapping, account=cid, inventory=inventory)
                    e['sourceCustomerId'] = cid
                    reports[name].append(e)
        if len(set(currency_by_account.values())) != 1:
            raise RuntimeError('Contas com moedas diferentes: não é seguro consolidar investimento.')
        city_names = _resolve_city_names(last_reader, reports) if last_reader else {}
        consulted_at = now_local().isoformat()
        start_date = (end_date.date() - timedelta(days=days-1)).isoformat()
        currency = next(iter(currency_by_account.values()))
        payload = {
            'origem': 'Google Ads API — múltiplas contas e redes',
            'versao_api': os.getenv('GOOGLE_ADS_API_VERSION', 'v26'),
            'customer_id': main_id,
            'customer_ids': list(accounts),
            'extraido_em': consulted_at,
            'dias': days,
            'periodo_inicio': start_date,
            'periodo_fim': end_date.date().isoformat(),
            'filtro_rede': 'ALL',
            'observacoes': [
                'Agregados calculados somente a partir de campanhas; não somar relatórios dimensionais.',
                'Taxas de formato e quartis oficiais são mostradas por campanha/rede sem média simples.',
                'CPV oficial recebido em micros e convertido para a moeda da conta.',
                'Dados demográficos podem ter cobertura parcial. Sem snapshots em disco.',
                'Campanhas mistas/conflitantes permanecem pendentes em todas as dimensões; evidência por anúncio não rateia métricas.'
            ],
            'metadata': {
                'currency_code': currency,
                'currency_by_account': currency_by_account,
                'time_zones': timezones,
                'time_zone': next(iter(timezones.values()), ''),
                'account_names': {cid: ACCOUNT_LABELS.get(cid, cid) for cid in accounts},
                'city_names': city_names,
                'classificacao_programas': {
                    'versao': CLASSIFICATION_VERSION,
                    'granularidade_filtros': 'campanha',
                    'campanhas': {cid: {campaign: item['classificacao'] for campaign, item in inv.items()}
                                  for cid, inv in inventories.items()},
                },
            },
            'relatorios': reports,
            'erros': {},
        }
        # Manter simultaneamente períodos já consultados enquanto válidos.
        for old_key, old_entry in list(CACHE.items()):
            if (time.monotonic() - old_entry['at'] >= CACHE_SECONDS
                    or old_key[4] != key[4] or old_key[5:] != key[5:]):
                CACHE.pop(old_key, None)
        for old_key, entry in list(CLASSIFICATION_CACHE.items()):
            if time.monotonic() - entry['at'] >= CACHE_SECONDS or old_key[3:] != (key[4], key[5:]):
                CLASSIFICATION_CACHE.pop(old_key, None)
        CLASSIFICATION_CACHE.update(pending_inventories)
        CACHE[key] = {'payload': payload, 'at': time.monotonic(), 'consulted_at': consulted_at}
        result = dict(payload)
        result['consulta'] = {'origem': 'api', 'idade_segundos': 0, 'cache_ttl_segundos': CACHE_SECONDS,
                               'consultado_em': consulted_at}
        return result


class Handler(BaseHTTPRequestHandler):
    server_version = 'AdsLocalV6.1/1.0'

    def send_data(self, obj: object, status: int = 200):
        body = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        return self.send_bytes(body, 'application/json; charset=utf-8', status)

    def send_bytes(self, body: bytes, mime: str, status: int = 200):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Security-Policy',
                         "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
                         "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
                         "frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _authorized_host(self) -> bool:
        return self.headers.get('Host', '') in {f'127.0.0.1:{self.server.server_port}',
                                                   f'localhost:{self.server.server_port}'}

    def _period(self) -> dict:
        params = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
        if any(len(params.get(k, [])) > 1 for k in ('dias', 'inicio', 'fim')):
            raise ValueError('Parâmetros de período duplicados.')
        if 'inicio' in params or 'fim' in params:
            if 'dias' in params or not params.get('inicio') or not params.get('fim'):
                raise ValueError('Informe início e fim juntos, sem combinar com dias.')
            result = {'inicio': params['inicio'][0], 'fim': params['fim'][0]}
            resolve_period(**result)
            return result
        raw = params.get('dias', ['365'])[0]
        if raw not in tuple(str(x) for x in PERIODS):
            raise ValueError('Período inválido: use 7, 30, 90 ou 365, ou início e fim.')
        return {'days': int(raw)}

    def do_GET(self):
        if not self._authorized_host():
            return self.send_data({'erro': 'Host não permitido'}, 403)
        path = urlsplit(self.path).path
        if path in ('/', '/index.html'):
            return self.send_bytes(HTML.read_bytes(), 'text/html; charset=utf-8')
        if path == '/api/status':
            try:
                cid, mid, key = settings()
                return self.send_data({'modo': 'api_dinamica', 'credenciais_configuradas': key.is_file(),
                                       'customer_id': cid, 'customer_ids': configured_accounts(cid), 'gerenciadora_configurada': bool(mid),
                                       'periodos': PERIODS, 'rede': 'ALL',
                                       'intervalo_personalizado': True,
                                       'data_maxima': (now_local().date() - timedelta(days=1)).isoformat(),
                                       'max_dias_intervalo': None,
                                       'cache_segundos': CACHE_SECONDS})
            except Exception as exc:
                return self.send_data({'erro': sanitize_error(exc), 'modo': 'api_dinamica'}, 503)
        if path == '/api/relatorios':
            if self.headers.get('X-Ads-Request') != 'dashboard':
                return self.send_data({'erro':'Requisição não autorizada'}, 403)
            try:
                return self.send_data(fetch_live(**self._period()))
            except ValueError as exc:
                return self.send_data({'erro': str(exc)}, 400)
            except Exception as exc:
                return self.send_data({'erro': sanitize_error(exc), 'tipo': type(exc).__name__}, 502)
        return self.send_data({'erro': 'Rota não encontrada'}, 404)

    def do_POST(self):
        if not self._authorized_host():
            return self.send_data({'erro': 'Host não permitido'}, 403)
        if urlsplit(self.path).path != '/api/atualizar':
            return self.send_data({'erro': 'Método indisponível'}, 405)
        # Impede sites externos de dispararem operações da API a partir do navegador.
        origin = self.headers.get('Origin', '')
        if origin not in (f'http://127.0.0.1:{self.server.server_port}',
                          f'http://localhost:{self.server.server_port}') or self.headers.get('X-Ads-Request') != 'dashboard':
            return self.send_data({'erro': 'Origem não permitida'}, 403)
        try:
            return self.send_data(fetch_live(**self._period(), force=True))
        except ValueError as exc:
            return self.send_data({'erro': str(exc)}, 400)
        except Exception as exc:
            return self.send_data({'erro': sanitize_error(exc), 'tipo': type(exc).__name__}, 502)

    def do_OPTIONS(self):
        return self.send_data({'erro': 'Não permitido'}, 405)

    def log_message(self, fmt, *args):
        # Log de rota e status. Sem parâmetros de token (não existem nas rotas expostas).
        print('[AdsV6] %s %s' % (self.address_string(), fmt % args))


def main():
    print('Google Ads Intelligence V6.1 — API dinâmica multiconta • somente leitura • local')
    print(f'URL: http://127.0.0.1:{PORT}/')
    print(f'Cache de memória: {CACHE_SECONDS // 60} minutos • API sempre consultada ao expirar')
    print('Ctrl+C encerra. Credenciais nunca são disponibilizadas pelo HTTP.')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()


if __name__ == '__main__':
    main()
