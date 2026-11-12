# Linha de base homologada — Google Ads Intelligence EPTV

> Fonte: conciliação confirmada pelo usuário em 12/11/2026, comparando retorno real da API com a tela oficial do Google Ads.
> Esta é uma **referência de auditoria de período fechado**, não um alvo que todo dashboard futuro precisa mostrar.

## Escopo exato
- Janela **14/08/2026 a 11/11/2026** (90 dias completos no momento da auditoria).
- Gerenciadora (MCC): **EPTV `9234046127`**.
- Anunciantes incluídos: **Promo `7182459480`**, **EPTV Institucional `5498287982`**.
- Redes incluídas no total conciliado: **YOUTUBE + CONTENT** (não foi observada GOOGLE_TV nessa janela das duas contas).
- Moeda de ambas as contas na auditoria: **BRL**.
- Todos os programas/campanhas dessas contas no período, sem restringir a BDC/EPTV1/EPTV2.

## Totais que fecharam com diferença zero
| Indicador | Promo — YouTube | Promo — CONTENT | Institucional — YouTube | Total conciliado |
|---|---:|---:|---:|---:|
| Impressões | 439.628 | 27.612 | 3.395 | **470.635** |
| Visualizações TrueView | 48.117 | 1.667 | 759 | **50.543** |
| Cliques | 50 | 32 | 0 | **82** |
| Custo (BRL, arredondado) | R$ 1.502,71 | R$ 235,16 | R$ 54,15 | **R$ 1.792,02** |

O valor oficial conciliado resulta de micros de custo, com arredondamento apenas na apresentação. Evitar somar parcelas já arredondadas como prova de igualdade em centavos.

## Exemplo de CPV oficial e taxas por formato
- Promo, campanha `23152772320` `[Manut] [Jornalismo] [Outubro]`: `metrics.trueview_average_cpv` bruto ≈ **10046,52 micros** → **R$ 0,01005**; in-stream **51,77%**, in-feed **6,55%**, Shorts indisponível.
- Institucional, campanha `24450345081` `EPTV_BDC_VIEWS_PULAVEL`: **32779,19 micros** → **R$ 0,03278**; in-stream **59,67%**, in-feed e Shorts indisponíveis.
- Os percentuais por formato não são derivados de `TrueView / impressões totais`. Quartis de vídeo não devem ser agregados por média simples.

## Implicações para desenvolvimento
1. Baseline fechado é referência para testes reproduzíveis, **não para 90 dias móveis após 12/11/2026**.
2. Nenhuma alteração deve gerar total consolidado diferente para as **mesmas contas, redes, filtros, período e definições**, salvo correções tardias do provedor explicitadas.
3. `campanhas` é a base dos totais; outras visões têm granularidades e cobertura diferentes.
4. As campanhas BDC/EPTV1/EPTV2 precisam de classificação por ID, com não classificados separados.
5. Registro de teste simulado com esses totais não é prova de que uma implementação nova consultou corretamente a API real.
