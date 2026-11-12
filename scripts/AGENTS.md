# Scripts Windows — PowerShell

- Aplicável a `.ps1` desta pasta. Preservar execução via PowerShell no Windows e caminhos relativos à raiz do projeto, inclusive quando o nome da pasta contém espaços.
- Para V6.1 dinâmica, inicialização principal: `05_iniciar_dashboard_local.ps1`; não voltar a exigir snapshots de V5.
- Scripts antigos (`02_validar.ps1`, `03_extrair_30_dias.ps1`, `04_*`) podem ter função de diagnóstico/legado; não apagá-los nem torná-los rotina obrigatória sem justificativa.
- Não imprimir valores de `.env`, conteúdo de `credentials.json`, tokens nem variáveis sensíveis. Mensagens de erro devem apontar arquivo/requisito sem revelar segredo.
- Não baixar dependências, alterar política global do PowerShell, modificar agendamentos, subir serviços ou publicar no Vercel sem pedido explícito.
- Usar `$ErrorActionPreference = 'Stop'`, verificar `$LASTEXITCODE` quando invocar Python e encerrar corretamente em caso de falha.
- Preferir operação idempotente, com backup para substituições e instruções reproduzíveis para a pasta `C:\Dev\Google-Ads-Intelligence-EPTV-V4`.
- Em qualquer nova rotina automática, explicar impacto em chamadas à API e cotas.
