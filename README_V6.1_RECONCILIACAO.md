# Google Ads Intelligence EPTV — V6.1 (API dinâmica reconciliada)

Esta atualização **substitui somente a interface e o servidor local da V6**. Não é necessária uma nova credencial, token, instalação Python ou geração de snapshots.

## O que muda

- Consulta via Google Ads API `searchStream` sob demanda, com cache em RAM (15 min) e atualização manual.
- Consolida as duas contas validadas na auditoria: **Promo `7182459480`** e **EPTV Institucional `5498287982`**, com MCC `9234046127`.
- Usa **todas as redes** como padrão e permite visualizar apenas **YouTube**, **Display/CONTENT** ou **Google TV**. Selecione ambas as contas e todas as redes para comparar o consolidado com a tela do Google Ads.
- Filtros independentes de **programa (BDC, EPTV1, EPTV2, Outros)**, conta, rede e período.
- CPV **oficial** `metrics.trueview_average_cpv` convertido de micros para BRL. Onde agrega campanhas, usa ponderação pelas visualizações TrueView. O custo total por TrueView é um cálculo diferente, mantido apenas como indicador auxiliar nos recortes horários e dispositivos, com nome explícito.
- **In-stream, in-feed, Shorts** e quartis (25, 50, 75, 100%) oficiais por **campanha e rede**, sem médias simples entre campanhas.
- Barras de programas alternáveis entre **impressões (padrão), TrueView e investimento**, preservando campanhas de alcance com zero TrueView.
- Evolução diária usa eixo de **calendário real**, sem comprimir dias sem veiculação.
- Falha em qualquer uma das contas ou em qualquer relatório cancela o resultado integral (sem mostrar consolidação incompleta).

## Instalação Windows (sem mexer nas credenciais)

1. **Pare** o servidor V6 no PowerShell com `Ctrl+C`.
2. Abra o PowerShell e faça backup:

```powershell
cd C:\Dev\Google-Ads-Intelligence-EPTV-V4
Copy-Item .\backend\dashboard_server.py .\backend\dashboard_server_v6_backup.py -Force
Copy-Item .\frontend\index.html .\frontend\index_v6_backup.html -Force
```

3. Baixe `Google-Ads-Intelligence-EPTV-V6.1-RECONCILIADO.zip` para Downloads e extraia na pasta **C:\Dev**:

```powershell
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\Google-Ads-Intelligence-EPTV-V6.1-RECONCILIADO.zip" -DestinationPath C:\Dev -Force
```

4. Confira no arquivo `backend\.env` (sem apagar as outras linhas):

```ini
GOOGLE_ADS_CUSTOMER_ID=7182459480
GOOGLE_ADS_LOGIN_CUSTOMER_ID=9234046127
GOOGLE_ADS_CUSTOMER_IDS=7182459480,5498287982
```

O terceiro campo é opcional nesta versão (já possui esses dois IDs como padrão), mas vale deixá-lo explícito. `credentials.json` continua o mesmo. **Nunca o compartilhe ou publique.**

5. Valide a sintaxe e inicie:

```powershell
.\backend\.venv\Scripts\python.exe -m py_compile .\backend\dashboard_server.py
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\05_iniciar_dashboard_local.ps1
```

6. Abra `http://127.0.0.1:8765/` no seu navegador.

## Conciliação funcional

Para conferir a reprodução da auditoria no **período de 14/08/2026 a 11/11/2026**, com o calendário no dia 12/11/2026:

- **Período:** 90 dias
- **Conta:** Promo + Institucional
- **Rede:** Todas as redes
- **Programa:** Todos

Referências da auditoria oficial: **470.635 impressões; 50.543 TrueView; 82 cliques; R$ 1.792,02**. A V6.1 exibe cliques na faixa de indicadores complementares, impressões e TrueView nos cards e o custo total na visão geral. Como a seleção de período é rolante até D-1, essa conciliação exata não é garantida em datas posteriores. Também pode mudar por ajustes tardios de métricas no Google Ads.

Filtros úteis para conferir: Promo/YouTube (439.628 impressões, 48.117 TrueView); Institucional/YouTube (3.395 impressões, 759 TrueView); Promo/Display (27.612 impressões, 1.667 TrueView). Cada recorte exclui as redes ou contas não selecionadas.

## Limitações honestas

- A versão está **validada localmente com dados simulados de teste**, e ainda **não foi executada contra a API real após essas alterações**. Confirme os resultados no notebook corporativo antes de dar o sistema como homologado.
- Nem todas as campanhas ou redes têm taxas in-stream, in-feed ou Shorts. Dados ausentes aparecem como “—”; métricas de formatos não são combinadas por média simples.
- Nomes das campanhas servem como classificação preliminar por programa. O arquivo `backend\programas.json` é a fonte para classificação manual por ID, caso necessário.
- Idade/gênero/cidades/dispositivos são relatórios com granularidades próprias, não somá-los para obter o total geral. O dado de localização pode usar IDs quando o nome da cidade não está disponível.
- A consulta em 2 contas consome aproximadamente **16 chamadas** (8 relatórios × 2 contas) mais metadados e eventuais pesquisas de nomes de cidades, por período a cada expiração do cache; respeite as cotas de API. Para grandes volumes pode haver necessidade de paginação ou otimização posterior.
- O servidor continua **exclusivamente em 127.0.0.1**. Não é publicação para colegas via Internet; nem o frontend nem este ZIP incluem credenciais.

## Segurança

Os arquivos distribuídos são `backend/dashboard_server.py`, `frontend/index.html`, `frontend/dashboard.js` (fonte de referência; o HTML possui o JavaScript embutido), `scripts/05_iniciar_dashboard_local.ps1`, este README e `tests/test_v61.py`. **Não substituem** `backend/extrair_google_ads.py`, `.env`, `credentials.json` ou `programas.json`.
