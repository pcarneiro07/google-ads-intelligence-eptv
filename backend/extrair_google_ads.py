"""Primeira integração de leitura do Google Ads Intelligence.

Uso:
  python extrair_google_ads.py --validar
  python extrair_google_ads.py --extrair --dias 30
  python extrair_google_ads.py --mostrar-consultas

Necessita GOOGLE_ADS_CUSTOMER_ID e uma chave de conta de serviço em credentials.json.
Nunca publica credenciais ou resultados de campanha automaticamente.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta, datetime
from decimal import Decimal
import json
import os
from pathlib import Path
import re
import sys
from typing import Any
from classificacao_programas import by_text, explicit

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
SCOPE = 'https://www.googleapis.com/auth/adwords'
BASE = 'https://googleads.googleapis.com'
API_VERSION = os.getenv('GOOGLE_ADS_API_VERSION', 'v26').strip()
ALLOWED_PROGRAMS = {'BDC', 'EPTV1', 'EPTV2'}


def ids(valor: str, nome: str, required: bool = True) -> str:
    limpo = valor.replace('-', '').strip()
    if not limpo and not required:
        return ''
    if not re.fullmatch(r'\d{10}', limpo):
        raise ValueError(f'{nome} deve conter exatamente 10 dígitos (hífens são opcionais).')
    return limpo


def settings() -> tuple[str, str, Path]:
    cid = ids(os.getenv('GOOGLE_ADS_CUSTOMER_ID', ''), 'GOOGLE_ADS_CUSTOMER_ID')
    mid = ids(os.getenv('GOOGLE_ADS_LOGIN_CUSTOMER_ID', ''), 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', required=False)
    key = Path(os.getenv('GOOGLE_ADS_CREDENTIALS_FILE', 'credentials.json'))
    if not key.is_absolute():
        key = ROOT / key
    if not key.is_file():
        raise FileNotFoundError(f'Credencial não encontrada: {key}. Coloque o JSON baixado do Google Cloud nesse caminho.')
    if not re.fullmatch(r'v\d+', API_VERSION):
        raise ValueError('GOOGLE_ADS_API_VERSION inválida. Exemplo: v26')
    return cid, mid, key


class AdsReader:
    def __init__(self, customer_id: str, login_customer_id: str, key_path: Path):
        self.customer_id = customer_id
        self.login_customer_id = login_customer_id
        from google.oauth2 import service_account
        self.credentials = service_account.Credentials.from_service_account_file(str(key_path), scopes=[SCOPE])
        self.session = requests.Session()

    def _headers(self) -> dict[str, str]:
        if not self.credentials.valid:
            from google.auth.transport.requests import Request
            self.credentials.refresh(Request())
        result = {'Authorization': f'Bearer {self.credentials.token}', 'Content-Type': 'application/json'}
        if self.login_customer_id:
            result['login-customer-id'] = self.login_customer_id
        # Desde setembro/2026, novas integrações não precisam de developer-token.
        return result

    @staticmethod
    def _formatar_erro_api(payload: Any) -> tuple[str, str]:
        """Lê respostas de erro do REST, inclusive arrays de searchStream.

        O Google Ads pode devolver um objeto ``error``, uma lista de objetos
        ou detalhes aninhados (``GoogleAdsFailure``). Não assume um formato só.
        Retorna uma descrição curta e o requestId, sem imprimir credenciais.
        """
        mensagens: list[str] = []
        ids_solicitacao: list[str] = []

        def percorrer(obj: Any, profundidade: int = 0) -> None:
            if profundidade > 8 or len(mensagens) >= 10:
                return
            if isinstance(obj, list):
                for item in obj[:15]:
                    percorrer(item, profundidade + 1)
                return
            if not isinstance(obj, dict):
                return

            rid = obj.get('requestId') or obj.get('request_id')
            if isinstance(rid, str) and rid and rid not in ids_solicitacao:
                ids_solicitacao.append(rid)

            codigo = obj.get('errorCode')
            if isinstance(codigo, dict):
                codigo = ', '.join(str(x) for x in codigo.values())
            if not codigo:
                codigo = obj.get('status') or obj.get('code')

            msg = obj.get('message')
            if isinstance(msg, str) and msg.strip():
                item = f'{codigo}: {msg}' if codigo else msg
                if item not in mensagens:
                    mensagens.append(item[:850])

            for chave in ('error', 'details', 'errors'):
                if chave in obj:
                    percorrer(obj[chave], profundidade + 1)

        percorrer(payload)
        if not mensagens:
            # Nunca interpolar o JSON cru inteiro: ele pode conter dados internos.
            mensagens = ['O servidor retornou um erro sem mensagem legível.']
        return ' | '.join(mensagens[:5])[:1800], (ids_solicitacao[0] if ids_solicitacao else '')

    @staticmethod
    def _orientacao_http(corpo_erro: str) -> str:
        """Apenas uma sugestão para diagnosticar, sem presumir a causa."""
        s = corpo_erro.upper()
        if 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' in s or 'DEVELOPER_TOKEN_NOT_APPROVED' in s:
            return 'Dica: confira se o projeto Google Cloud possui acesso Explorer (produção) à Google Ads API.'
        if any(t in s for t in ('USER_PERMISSION_DENIED', 'NOT_ADS_USER', 'CUSTOMER_NOT_FOUND', 'CUSTOMER_NOT_ENABLED', 'USER_DOES_NOT_HAVE_ACCESS')):
            return ('Dica: confira se o e-mail da conta de serviço tem acesso à conta Ads, '
                    'se o CUSTOMER_ID é anunciante e se LOGIN_CUSTOMER_ID é a MCC correta (quando houver).')
        if 'API_KEY_SERVICE_BLOCKED' in s or 'SERVICE_DISABLED' in s or 'API_NOT_ENABLED' in s:
            return 'Dica: habilite a Google Ads API no projeto Google Cloud que criou a conta de serviço.'
        if 'UNAUTHENTICATED' in s or 'INVALID_CREDENTIALS' in s:
            return 'Dica: revise as credenciais da conta de serviço e sua autorização.'
        if 'INVALID_ARGUMENT' in s or 'UNRECOGNIZED_FIELD' in s or 'PROHIBITED_FIELD' in s:
            return 'Dica: a API rejeitou a consulta GAQL; confira versão e campos solicitados.'
        return 'Dica: veja a mensagem acima e o request-id para identificar o motivo da rejeição.'

    def gaql(self, query: str) -> list[dict[str, Any]]:
        url = f'{BASE}/{API_VERSION}/customers/{self.customer_id}/googleAds:searchStream'
        response = self.session.post(url, headers=self._headers(), json={'query': query}, timeout=(15, 180))
        try:
            payload = response.json()
        except ValueError:
            payload = None

        if not response.ok:
            detalhe, id_json = self._formatar_erro_api(payload)
            request_id = (response.headers.get('request-id')
                          or response.headers.get('google-ads-request-id')
                          or id_json or 'não informado')
            # Se não veio JSON, mostrar um trecho do texto, sem cabeçalhos ou tokens.
            if payload is None:
                detalhe = (response.text or '')[:350] or 'Resposta sem corpo legível.'
            dica = self._orientacao_http(detalhe)
            raise RuntimeError(f'HTTP {response.status_code} | request-id={request_id} | {detalhe}\n{dica}')

        if not isinstance(payload, list):
            raise RuntimeError('A API retornou sucesso HTTP, mas um JSON inesperado (esperava lista SearchStream).')

        resultado: list[dict[str, Any]] = []
        for indice, lote in enumerate(payload):
            if not isinstance(lote, dict):
                raise RuntimeError(f'Formato inválido de resposta SearchStream no lote {indice}.')
            if 'error' in lote:
                detalhe, id_json = self._formatar_erro_api(lote)
                raise RuntimeError(f'Erro interno em lote SearchStream | request-id={id_json or "não informado"} | {detalhe}')
            linhas = lote.get('results', [])
            if not isinstance(linhas, list):
                raise RuntimeError(f'Campo results inválido no lote SearchStream {indice}.')
            resultado.extend(linhas)
        return resultado


def report_queries(dias: int, somente_youtube: bool = False) -> dict[str, str]:
    if dias < 1 or dias > 365:
        raise ValueError('--dias deve estar entre 1 e 365')
    fim = date.today() - timedelta(days=1)  # D-1: evita incluir um dia incompleto.
    inicio = fim - timedelta(days=dias - 1)
    periodo = f"segments.date BETWEEN '{inicio.isoformat()}' AND '{fim.isoformat()}'"
    if somente_youtube:
        periodo += " AND segments.ad_network_type = 'YOUTUBE'"
    met = 'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.video_trueview_views'
    rede = 'segments.ad_network_type'
    return {
        'campanhas': f'SELECT campaign.id, campaign.name, campaign.status, segments.date, {rede}, {met} FROM campaign WHERE {periodo} ORDER BY segments.date',
        'criativos': f'SELECT campaign.id, campaign.name, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status, {rede}, {met} FROM ad_group_ad WHERE {periodo}',
        'dispositivos': f'SELECT campaign.id, campaign.name, segments.device, {rede}, {met} FROM campaign WHERE {periodo}',
        'idade': f'SELECT campaign.id, campaign.name, ad_group_criterion.age_range.type, {rede}, {met} FROM age_range_view WHERE {periodo}',
        'genero': f'SELECT campaign.id, campaign.name, ad_group_criterion.gender.type, {rede}, {met} FROM gender_view WHERE {periodo}',
        'cidades': f'SELECT campaign.id, campaign.name, segments.geo_target_city, {rede}, {met} FROM geographic_view WHERE {periodo}',
        'dia_hora': f'SELECT campaign.id, campaign.name, segments.day_of_week, segments.hour, {rede}, {met} FROM campaign WHERE {periodo}',
    }


def programa_por_campanha(campaign_id: str, campaign_name: str, manual: dict[str, str]) -> str:
    if campaign_id in manual:
        return manual[campaign_id]
    return by_text(campaign_name, 'nome_campanha')['programa']


def program_map() -> dict[str, str]:
    p = ROOT / 'programas.json'
    raw = json.loads(p.read_text(encoding='utf-8')) if p.is_file() else {}
    if not isinstance(raw, dict):
        raise ValueError('programas.json precisa ser um objeto {"id_campanha": "BDC"}.')
    for k, v in raw.items():
        if not re.fullmatch(r'(?:\d{10}:)?\d+', str(k)) or str(v) not in ALLOWED_PROGRAMS:
            raise ValueError(f'Mapeamento inválido em programas.json: {k} -> {v}')
    return {str(k): str(v) for k,v in raw.items()}


def enriched_row(row: dict[str, Any], mapping: dict[str, str], *, account: str = '', inventory: dict | None = None) -> dict[str, Any]:
    campaign = row.get('campaign', {})
    cid = str(campaign.get('id', ''))
    name = str(campaign.get('name', ''))
    result = dict(row)
    metrics = dict(row.get('metrics') or {})
    if 'costMicros' in metrics:
        # API retorna unidades micros: converter para a moeda da conta (não assumir BRL).
        result['costInAccountCurrency'] = float(Decimal(str(metrics['costMicros'])) / Decimal('1000000'))
    if inventory is not None:
        if cid not in inventory:
            raise RuntimeError('Inventário de classificação incompleto: campanha de relatório ausente.')
        item = inventory[cid]
        classification = item['classificacao']
        ad_id = str((row.get('adGroupAd') or {}).get('ad', {}).get('id', ''))
        if ad_id:
            evidence = next((a for a in item['anuncios'] if a['id'] == ad_id), None)
            if evidence is None:
                raise RuntimeError('Inventário de classificação incompleto: anúncio de relatório ausente.')
            # Evidência individual não altera a partição dos totais de campanha.
            result['evidenciaProgramaAnuncio'] = evidence
    else:
        classification = explicit(mapping, account, cid) or by_text(name, 'nome_campanha')
    result['programa'] = classification['programa']
    result['classificacaoPrograma'] = classification
    return result


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def main() -> int:
    parser = argparse.ArgumentParser(description='Extração local de leitura da API Google Ads (v26).')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--validar', action='store_true', help='Valida acesso e lista ID/nome das campanhas.')
    group.add_argument('--extrair', action='store_true', help='Extrai relatórios separados para JSON local.')
    group.add_argument('--mostrar-consultas', action='store_true', help='Mostra GAQL sem exigir credenciais.')
    parser.add_argument('--dias', type=int, default=30, help='Dias completos até ontem. Padrão: 30.')
    parser.add_argument('--somente-youtube', action='store_true', help='Filtra rede de distribuição YOUTUBE (exclui inventário de outras redes).')
    args = parser.parse_args()
    queries = report_queries(args.dias, somente_youtube=args.somente_youtube)
    if args.mostrar_consultas:
        for k, v in queries.items():
            print(f'\n[{k}]\n{v}')
        return 0

    customer_id, login_customer_id, key_path = settings()
    reader = AdsReader(customer_id, login_customer_id, key_path)
    if args.validar:
        result = reader.gaql('SELECT campaign.id, campaign.name, campaign.status FROM campaign ORDER BY campaign.id LIMIT 100')
        print(f'Conexão OK. Campanhas encontradas: {len(result)}')
        for row in result:
            c = row.get('campaign', {})
            print(f"  {c.get('id', '—')}: {c.get('name', '—')} [{c.get('status', '?')}]")
        if len(result) == 100:
            print('Mostrando as primeiras 100 campanhas.')
        return 0

    mapping = program_map()
    out = ROOT / 'dados_privados'
    payload = {'origem': 'Google Ads API', 'versao_api': API_VERSION, 'customer_id': customer_id,
               'extraido_em': datetime.now().astimezone().isoformat(), 'dias': args.dias,
               'filtro_rede': 'YOUTUBE' if args.somente_youtube else 'TODAS',
               'observacoes': ['Relatórios de granularidades diferentes não devem ser somados entre si.',
                               'video_trueview_views mede visualizações TrueView, não todas as interações.',
                               'A dimensão cidades retorna GeoTargetConstant IDs, que precisam ser resolvidos para nomes.'],
               'relatorios': {}, 'erros': {}}
    for report, query in queries.items():
        print(f'Consultando {report}...', flush=True)
        try:
            data = [enriched_row(r, mapping) for r in reader.gaql(query)]
            payload['relatorios'][report] = data
            print(f'  OK: {len(data)} linhas')
        except Exception as exc:
            payload['erros'][report] = str(exc)
            print(f'  FALHOU: {exc}', file=sys.stderr)
    write_json(out / 'google_ads_snapshot.json', payload)
    print(f"\nSnapshot salvo em: {out / 'google_ads_snapshot.json'}")
    if payload['erros']:
        print(f"Atenção: {len(payload['erros'])} relatórios falharam. Veja 'erros' no JSON; os demais foram preservados.")
        return 2
    print('Todos os relatórios concluídos com sucesso.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, FileNotFoundError, RuntimeError, requests.RequestException) as exc:
        print('ERRO:', exc, file=sys.stderr)
        sys.exit(1)
