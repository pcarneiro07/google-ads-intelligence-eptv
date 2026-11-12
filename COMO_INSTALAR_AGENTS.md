# Instalação dos AGENTS.md no projeto existente

Este pacote contém **somente documentação/instruções para Codex**. Não altera código, credenciais, testes existentes ou configuração de Ads.

## Instalação no Windows
1. Pare o Codex da sessão anterior e salve eventuais alterações pendentes.
2. Baixe `Google-Ads-Intelligence-Codex-AGENTS.zip` para a pasta Downloads.
3. No PowerShell, a partir de `C:\Dev`:

```powershell
cd C:\Dev
$zip = Join-Path $env:USERPROFILE 'Downloads\Google-Ads-Intelligence-Codex-AGENTS.zip'
Expand-Archive -LiteralPath $zip -DestinationPath 'C:\Dev' -Force
```

O ZIP contém a pasta `Google-Ads-Intelligence-EPTV-V4` com `AGENTS.md` na raiz, arquivos aninhados em `backend`, `frontend`, `tests`, `scripts` e `docs/BASELINE_VALIDADA.md`.

Caso o projeto já possua algum `AGENTS.md`, faça backup desse arquivo antes de extrair o ZIP. Nada aqui deve substituir contratos locais já definidos sem revisão.

## Conferência

```powershell
cd C:\Dev\Google-Ads-Intelligence-EPTV-V4
Get-ChildItem -Path . -Filter AGENTS.md -Recurse -File | Select-Object FullName
```

Abra o Codex **a partir da raiz do projeto**. Se já estava aberto, inicie uma nova sessão para garantir a leitura dos arquivos.

Prompt inicial sugerido:

> Leia os AGENTS.md aplicáveis e docs/BASELINE_VALIDADA.md. Analise a arquitetura V6.1 e identifique riscos de regressão e oportunidades de melhoria. Primeiro faça apenas uma revisão; não altere código, credenciais, dados ou infraestrutura até eu aprovar um plano.

A extensão `.agents/skills` é usada para skills do Codex, não é necessária para as instruções de repositório deste pacote.
