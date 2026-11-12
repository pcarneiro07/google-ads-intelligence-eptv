# Consulta por calendário

Os botões de 7/30/90/365 dias foram substituídos por Data inicial, Data final e Aplicar. O intervalo inclui ambas as datas, admite um único dia e não tem limite de duração imposto pelo dashboard. A data máxima vem do servidor: ontem em America/Sao_Paulo. O carregamento inicial continua abrangendo os últimos 365 dias completos, apenas como seleção inicial editável.

Editar os campos não consulta a API. Aplicar envia o intervalo aos oito relatórios das duas contas; o botão de atualização e a atualização automática reutilizam o intervalo efetivamente carregado. Programa, conta e rede continuam sendo filtros globais. As quatro telas, classificação, fórmulas, fontes de métricas e animações foram preservadas. O CSV inclui as duas datas no nome.

## Contrato e cache

- GET `/api/relatorios?inicio=2026-08-14&fim=2026-11-11`.
- POST `/api/atualizar?inicio=2026-08-14&fim=2026-11-11`, com as mesmas proteções de origem e cabeçalhos existentes.
- `/api/status` informa `intervalo_personalizado`, `data_maxima` e `max_dias_intervalo=null` (sem limite de duração).
- Chamadas legadas com `dias=7/30/90/365` continuam funcionando. Não combinar `dias` com `inicio/fim`.
- Datas inválidas, parâmetros repetidos/incompletos, datas futuras e ordem invertida recebem HTTP 400 antes de consultar a API. Intervalos de vários anos são aceitos sem truncamento nos oito relatórios.
- O cache identifica início **e** fim. Um intervalo personalizado equivalente ao preset reutiliza o mesmo resultado. O inventário de classificação continua reutilizável entre períodos. TTL e proteção de atualização forçada permanecem iguais.
- A resposta deve corresponder exatamente às datas solicitadas; o frontend rejeita intervalos divergentes. Falhas não apresentam resultado parcial como consolidado.

Não há novas consultas GAQL por carregamento: muda apenas o intervalo dos relatórios existentes. Cada intervalo distinto não armazenado em cache demanda a leitura habitual das duas contas; o inventário só é renovado quando necessário. Intervalos maiores podem retornar mais linhas e exigir mais tempo/memória, sujeitos à disponibilidade e aos limites operacionais da API. Não há corte silencioso para 365 dias. O botão Aplicar evita chamadas a cada edição dos campos. O servidor permanece no loopback, em modo somente leitura.

## Verificações

Executados sem chamadas à API real:

- 24 testes em `backend/.venv/Scripts/python.exe -m unittest discover -s tests -p test_v61.py -q`, incluindo intervalo 01/01/2023–11/11/2026 aplicado às 16 consultas de métricas das duas contas, com reutilização de cache.
- `node tests/test_classificacao_frontend.cjs`: filtros, sincronização do script embutido, calendário, GET/POST, datas inválidas e rejeição de resposta com intervalo diferente.
- `node --check frontend/dashboard.js`.
- `python -m py_compile backend/dashboard_server.py backend/extrair_google_ads.py tests/test_v61.py`.

Os testes incluem mesmo intervalo nos 16 relatórios multiconta, consulta de um único dia, janela homologada de 90 dias, isolamento de cache entre intervalos com a mesma duração, compatibilidade legada, rotas privadas e falhas sem resultado parcial. A reconciliação simulada anterior continua passando; não comprova uma nova conciliação na conta real. Pytest permanece ausente e nenhuma dependência foi instalada. Não houve teste visual de navegador/mobile nem nova validação com a conta real nesta mudança.

Arquivos alterados: `backend/dashboard_server.py`, `frontend/dashboard.js`, `frontend/index.html`, `tests/test_v61.py`, `tests/test_classificacao_frontend.cjs` e este documento. Backups anteriores: `backups/calendario_20261112_165505/` (calendário) e `backups/sem_limite_20261112_165939/` (remoção do limite). Reiniciar o servidor local existente para carregar o novo contrato; depois recarregar a página.
