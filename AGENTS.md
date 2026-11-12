# Google Ads Intelligence — orientações para o Codex

## Missão e situação atual
- Projeto corporativo EPTV: análise de campanhas do Google Ads, com foco em campanhas de vídeo e nos programas BDC, EPTV1 e EPTV2.
- Base de trabalho: **V6.1**, com leitura dinâmica da API, duas contas, múltiplas redes, filtros e conciliação. Não retroceder para snapshots ou dados fictícios em produção.
- O usuário confirmou que **os dados de referência foram validados**. Consulte `docs/BASELINE_VALIDADA.md` antes de alterar agregações, métricas, filtros, datas, contas ou redes.
- Preservar o visual Google, a navegação simples, os três círculos e demais animações, com boa legibilidade e desempenho.

## Estrutura real do projeto
- `backend/extrair_google_ads.py`: autenticação de conta de serviço, cliente REST e consultas GAQL já operacionais.
- `backend/dashboard_server.py`: servidor HTTP local, rotas `/api/status`, `/api/relatorios` e `/api/atualizar`, consultas multiconta e cache em memória.
- `backend/programas.json`: classificação manual de campanha por ID quando necessária.
- `frontend/index.html`: interface **efetivamente servida**, com CSS e JavaScript embutidos.
- `frontend/dashboard.js`: cópia de referência do JavaScript; mudanças precisam ser refletidas no código embutido de `index.html`.
- `scripts/`: instalação, validação, extrações legadas e inicialização; para o painel dinâmico usar `05_iniciar_dashboard_local.ps1`.
- `tests/`: testes automatizados com dados simulados. Não são evidência isolada de que consultas novas estão homologadas com dados reais.
- Leia também os `AGENTS.md` específicos nas subpastas.

## Regras obrigatórias
1. **A API e os dados validados são a fonte da verdade.** Não inventar métricas, totais, séries ou resultados. Sem substituições silenciosas por mocks ou estimativas.
2. Preservar o comportamento **somente leitura** das contas Ads. Nunca criar, editar, pausar, excluir ou alterar lances, orçamentos e campanhas sem pedido explícito e nova autorização.
3. Nunca abrir, mostrar, registrar, copiar para o frontend, versionar ou publicar o conteúdo de `backend/credentials.json`, `backend/.env`, tokens, chaves e dumps corporativos. Usar somente nomes das variáveis, nunca seus valores sensíveis.
4. Manter o servidor privado no loopback (`127.0.0.1`). Não publicar endpoints ou dados reais, nem modificar proteção e autenticação para expor o backend na Internet sem escopo e aprovação específicos.
5. Não mudar IDs de conta, MCC, fuso, moeda, período D-1, semântica de rede, classificação por programa ou fórmula de indicador sem checagem metodológica e solicitação explícita.
6. Não quebrar as interfaces públicas usadas pelo frontend; se for necessário mudar o contrato da API, atualizar consumidor e testes na mesma tarefa.
7. Preservar a última versão funcional. Antes de grandes refatorações, verificar `git status` e, na ausência de Git, criar backup nomeado dos arquivos que serão alterados. Não sobrescrever trabalho do usuário.
8. Foco: arquivos completos e caminhos explícitos quando descrever mudanças. Não fornecer somente patches soltos em respostas que o usuário precisa copiar.
9. Não executar chamadas à API real durante testes automatizados. Testes com API de produção ou alterações de deploy precisam ser autorizados à parte.
10. Se uma conta ou relatório falhar, não apresentar somas parciais como se fossem total consolidado.

## Critérios de aceite de qualquer mudança
- Entender e resumir o impacto em métrica, consulta, telas, filtros, segurança e consumo da cota Explorer.
- Manter as quatro áreas: panorama, criativos, público/distribuição, dias/horários, salvo pedido explícito de nova navegação.
- Conferir filtros globais (programa, conta, rede, período) e informar quando alguma dimensão não estiver disponível na granularidade correta.
- Executar testes locais sem credenciais de produção, além de `python -m py_compile` e verificações JS quando houver alterações relevantes.
- Validar acesso negado a caminhos privados e erro claro em caso de API incompleta.
- Ao concluir, listar arquivos alterados, verificações executadas e o que **ainda depende de validação na conta real**. Não afirmar testes reais que não foram executados.

## Comandos úteis (PowerShell, raiz C:\Dev\Google-Ads-Intelligence-EPTV-V4)
```powershell
.\backend\.venv\Scripts\python.exe -m py_compile .\backend\dashboard_server.py .\backend\extrair_google_ads.py
.\backend\.venv\Scripts\python.exe -m pytest .\tests -q
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\05_iniciar_dashboard_local.ps1
```
Se `pytest` não estiver instalado, registrar a dependência; não instalar ou alterar requisitos silenciosamente. O servidor local fica em `http://127.0.0.1:8765/`.
