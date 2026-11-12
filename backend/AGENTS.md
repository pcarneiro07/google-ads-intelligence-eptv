# Backend — Google Ads Intelligence V6.1

## Fronteiras técnicas
- Ler `../AGENTS.md` e `../docs/BASELINE_VALIDADA.md` antes de alterar extrator, servidor ou GAQL.
- `extrair_google_ads.py` já autentica com o escopo `https://www.googleapis.com/auth/adwords` usando conta de serviço; preservar `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `GOOGLE_ADS_CUSTOMER_IDS` e `GOOGLE_ADS_CREDENTIALS_FILE`.
- Conta gerenciadora: `9234046127`. Anunciantes atuais: Promo `7182459480` e EPTV Institucional `5498287982`. Nenhuma alteração de contas sem confirmação.
- Consultas por período fechado até **D-1 em America/Sao_Paulo**. `7`, `30`, `90` e `365` dias são presets atuais; não misturar períodos de relatórios diferentes.
- O `dashboard_server.py` busca 8 relatórios por conta: `campanhas`, `criativos`, `dispositivos`, `idade`, `genero`, `cidades`, `dia_hora`, `formatos`.
- A consulta dinâmica usa `googleAds:searchStream` / GAQL, cache **somente em memória** (TTL padrão 900 s) e limitação de atualização forçada (mínimo 60 s). Evitar chamadas redundantes e sobrecarga da cota Explorer.

## Invariantes de dados
- **Totais gerais:** calcular apenas sobre o relatório `campanhas`, com filtros explícitos; jamais somar entre tabelas de diferentes granularidades.
- `metrics.cost_micros`: dividir por 1.000.000 para obter valor na moeda da conta. `metrics.trueview_average_cpv`: também converter de micros. CPV oficial ≠ custo total dividido por TrueView; rotular qualquer derivado separadamente.
- `metrics.video_trueview_views` não é sinônimo de todas as reproduções ou de cliques.
- Taxas `video_trueview_view_rate_in_stream`, `_in_feed`, `_shorts` e quartis de vídeo são métricas oficiais por formato; **não somar nem tirar média simples** de taxas. Quando não houver denominadores válidos para agregação ponderada, mostrar indisponível em vez de estimar.
- Campanhas de alcance podem ter impressões e custo com TrueView zero. Não ocultar sua contribuição para investimento e alcance.
- Separar contas e redes (`YOUTUBE`, `CONTENT`, `GOOGLE_TV` etc.) até a camada de filtros. Consolidar custo apenas se a moeda das contas coincidir.
- Programa é classificação de campanha, não dado nativo garantido da API: preferir mapeamento confirmado por ID em `programas.json`; sinalizar não classificados, não forçar BDC/EPTV1/EPTV2.
- Datas e células sem veiculação: não reordenar ou comprimir o tempo, nem preencher eventos com estimativas.
- Se qualquer conta ou consulta obrigatória falhar, retornar erro explícito sem cachear resultado incompleto.

## Segurança e mudanças
- Nunca expor `credentials.json`, `.env`, tokens ou conteúdo de `dados_privados` em rotas, logs, respostas, frontend, screenshot ou artefatos.
- Manter o servidor ligado apenas a `127.0.0.1`; não interpretar `X-Ads-Request` como autenticação suficiente para exposição externa.
- Preservar contratos JSON de `/api/status`, `/api/relatorios?dias=` e `/api/atualizar?dias=`; qualquer mudança de esquema exige testes e atualização conjunta do frontend.
- Sanitizar mensagens de erro, sem ocultar tipo/código útil para suporte. Evitar incluir cabeçalhos Authorization em logs.
- Testar com mocks; validação real exige autorização explícita, e o usuário já validou a linha de base descrita no documento de referência.
