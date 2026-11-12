"""Classificação conservadora, sem métricas nem efeitos de escrita na API."""
from __future__ import annotations

import re
import unicodedata

PROGRAMS = {'BDC', 'EPTV1', 'EPTV2'}
VERSION = '2026-11-12.1'
ALL_STATUS = "IN ('ENABLED','PAUSED','REMOVED')"
INVENTORY_QUERIES = {
    'campaigns': f'SELECT campaign.id, campaign.name, campaign.status, campaign.labels FROM campaign WHERE campaign.status {ALL_STATUS}',
    'labels': 'SELECT label.resource_name, label.name FROM label',
    'ads': ('SELECT campaign.id, ad_group.id, ad_group.name, ad_group.labels, '
            'ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.labels, '
            'ad_group_ad.ad.video_ad.video.asset, ad_group_ad.ad.video_ad.in_feed.headline, '
            'ad_group_ad.ad.video_ad.in_stream.action_headline, '
            'ad_group_ad.ad.video_responsive_ad.headlines, ad_group_ad.ad.video_responsive_ad.long_headlines, '
            'ad_group_ad.ad.video_responsive_ad.descriptions, ad_group_ad.ad.video_responsive_ad.videos, '
            'ad_group_ad.ad.demand_gen_video_responsive_ad.headlines, '
            'ad_group_ad.ad.demand_gen_video_responsive_ad.long_headlines, '
            'ad_group_ad.ad.demand_gen_video_responsive_ad.descriptions, '
            'ad_group_ad.ad.demand_gen_video_responsive_ad.videos, '
            'ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, '
            'ad_group_ad.ad.responsive_display_ad.headlines, ad_group_ad.ad.responsive_display_ad.long_headline, '
            'ad_group_ad.ad.responsive_display_ad.descriptions '
            f'FROM ad_group_ad WHERE campaign.status {ALL_STATUS} AND ad_group.status {ALL_STATUS} '
            f'AND ad_group_ad.status {ALL_STATUS}'),
    'assets': ('SELECT asset.resource_name, asset.youtube_video_asset.youtube_video_id, '
               "asset.youtube_video_asset.youtube_video_title FROM asset WHERE asset.type = 'YOUTUBE_VIDEO'"),
}


def normalized(text):
    return ''.join(c for c in unicodedata.normalize('NFD', str(text).upper())
                   if unicodedata.category(c) != 'Mn')


def name_hits(text):
    """Somente identificadores observados; edição genérica e apresentador não bastam."""
    text = normalized(text)
    # Numeração de vídeos de sintonia não identifica edição de jornal.
    text = re.sub(r'SINAL[ _-]+EPTV[ _-]+\d+', 'SINAL EPTV', text)
    hits = set()
    if re.search(r'(?<![A-Z0-9])BDC(?![A-Z0-9])|(?<![A-Z0-9])BOM[ _-]+DIA[ _-]+CIDADE(?![A-Z0-9])', text):
        hits.add('BDC')
    for n in (1, 2):
        if re.search(rf'(?<![A-Z0-9])EPTV[ _-]*{n}(?![A-Z0-9])', text):
            hits.add(f'EPTV{n}')
    return hits


def decision(program='NAO_CLASSIFICADO', source='sem_evidencia', rule='sem_identificador_inequivoco', evidence=None):
    return {'programa': program, 'origem': source, 'regra': rule,
            'confianca': 'alta' if program in PROGRAMS else 'pendente',
            'estado': 'classificado' if program in PROGRAMS else 'pendente',
            'evidencias': evidence or [], 'versao': VERSION}


def by_text(text, source):
    hits = name_hits(text)
    if len(hits) == 1:
        return decision(next(iter(hits)), source, 'identificador_explicito', [str(text)])
    return decision(source=source, rule='multiplos_programas' if hits else 'sem_identificador_inequivoco', evidence=[str(text)] if hits else [])


def explicit(mapping, account, campaign):
    # Chave com conta evita colisão. Compatibilidade com programas.json legado.
    value = mapping.get(f'{account}:{campaign}', mapping.get(str(campaign)))
    if value:
        return decision(value, 'mapeamento_id', 'id_confirmado', [f'{account}:{campaign}'])
    return None


def label_decision(refs, labels, official):
    found = [(ref, official[ref]) for ref in refs if ref in official]
    # Somente IDs de rótulos explicitamente confirmados; nome livre não é oficial.
    hits = {program for _, program in found}
    if len(hits) == 1:
        return decision(next(iter(hits)), 'rotulo_oficial', 'id_rotulo_confirmado',
                        [{'id': ref, 'nome': labels.get(ref, '')} for ref, _ in found])
    if hits:
        return decision(source='rotulo_oficial', rule='rotulos_conflitantes', evidence=[ref for ref, _ in found])
    return None


def text_values(obj):
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in ('name', 'text', 'headline', 'actionHeadline', 'youtubeVideoTitle') and isinstance(value, str):
                yield value
            elif isinstance(value, (list, dict)):
                yield from text_values(value)
    elif isinstance(obj, list):
        for value in obj:
            yield from text_values(value)


def asset_refs(obj):
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key == 'asset' and isinstance(value, str):
                yield value
            elif isinstance(value, (dict, list)):
                yield from asset_refs(value)
    elif isinstance(obj, list):
        for value in obj:
            yield from asset_refs(value)


def build_inventory(raw, account, mapping, official=None):
    official = official or {}
    labels = {r['label']['resourceName']: r['label'].get('name', '') for r in raw['labels']}
    assets = {r['asset']['resourceName']: r['asset'].get('youtubeVideoAsset', {}) for r in raw['assets']}
    campaigns = {str(r['campaign']['id']): r['campaign'] for r in raw['campaigns']}
    children = {cid: [] for cid in campaigns}
    for row in raw['ads']:
        cid = str(row['campaign']['id'])
        if cid not in campaigns:
            raise RuntimeError('Inventário de classificação incompleto: campanha de anúncio ausente.')
        group = row.get('adGroup') or {}
        aga = row['adGroupAd']; ad = aga['ad']
        texts = list(text_values(ad))
        videos = [assets.get(ref, {}) for ref in asset_refs(ad)]
        texts += list(text_values(videos))
        sources = [by_text(group.get('name', ''), 'grupo_anuncios'),
                   by_text(' | '.join(texts), 'criativo_video')]
        label = label_decision(group.get('labels', []) + aga.get('labels', []), labels, official)
        if label:
            result = label
        else:
            hits = set().union(*(name_hits(t) for t in [group.get('name', ''), *texts]))
            if len(hits) > 1:
                result = decision(source='grupo_criativo', rule='evidencias_conflitantes', evidence=[group.get('name', ''), *texts])
            else:
                result = next((d for d in sources if d['programa'] in PROGRAMS), decision())
        children[cid].append({'id': str(ad['id']), 'grupo_id': str(group.get('id', '')),
                              'classificacao': result, 'videos': videos})
    result = {}
    for cid, campaign in campaigns.items():
        fixed = explicit(mapping, account, cid)
        labelled = label_decision(campaign.get('labels', []), labels, official)
        named = by_text(campaign.get('name', ''), 'nome_campanha')
        ads = children[cid]
        known = {a['classificacao']['programa'] for a in ads if a['classificacao']['programa'] in PROGRAMS}
        conflicts = any(a['classificacao']['regra'] in ('evidencias_conflitantes', 'rotulos_conflitantes') for a in ads)
        classified = fixed or labelled
        if classified is None:
            if conflicts:
                classified = decision(source='grupo_criativo', rule='evidencias_conflitantes',
                                      evidence=[a['id'] for a in ads if a['classificacao']['regra'] in ('evidencias_conflitantes', 'rotulos_conflitantes')])
            elif len(known) > 1 or (named['programa'] in PROGRAMS and known - {named['programa']}):
                classified = decision(source='campanha_mista', rule='requer_granularidade_anuncio', evidence=sorted(known | ({named['programa']} & PROGRAMS)))
            elif named['programa'] in PROGRAMS:
                classified = named
            elif name_hits(campaign.get('name', '')):
                classified = named
            elif ads and len(known) == 1 and all(a['classificacao']['programa'] in PROGRAMS for a in ads):
                classified = decision(next(iter(known)), 'consenso_anuncios', 'todos_anuncios_mesmo_programa',
                                      [a['id'] for a in ads])
            else:
                classified = decision(source='inventario', rule='evidencia_parcial' if known else 'sem_identificador_inequivoco')
        result[cid] = {'campanha': campaign, 'classificacao': classified, 'anuncios': ads}
    return result


def fetch_inventory(reader, account, mapping, official=None):
    # Quatro SearchStream completos, sem data/status ativo/LIMIT. Nenhum dump em disco.
    raw = {name: reader.gaql(query) for name, query in INVENTORY_QUERIES.items()}
    return build_inventory(raw, account, mapping, official)
