# Google Ads Intelligence — EPTV · Pacote V4

Este ZIP reúne o **protótipo visual V4** e o **extrator inicial do Google Ads API**, em pastas separadas.

## Conta informada
- **Nome:** EPTV
- **ID exibido no Google Ads:** `923-404-6127`
- **CUSTOMER_ID pré-configurado:** `9234046127` em `backend/.env.exemplo`

**Atenção ao tipo de conta:** se a EPTV for uma conta gerenciadora (MCC), esse número deve ser usado como `GOOGLE_ADS_LOGIN_CUSTOMER_ID` e você deve preencher `GOOGLE_ADS_CUSTOMER_ID` com o identificador da subconta anunciante. O pacote assume, por padrão, que 9234046127 é a conta anunciante, pois ainda não verificamos o tipo de conta.

## Pastas
- `frontend/index.html` — protótipo V4 navegável e responsivo, com **dados demonstrativos**.
- `frontend/vercel.json` — configuração de deploy estático (publique **somente a pasta frontend**).
- `backend/extrair_google_ads.py` — consultas GAQL de leitura para campanhas, criativos, idade, gênero, cidades, dispositivos e dia/hora.
- `backend/.env.exemplo` — configuração já preenchida com o ID informado.
- `backend/programas.json` — mapeamento de IDs de campanha para BDC, EPTV1 e EPTV2 (ainda vazio).
- `scripts/` — atalhos PowerShell para instalar, validar, extrair e abrir a interface.

## Passo a passo no Windows
1. Descompacte o ZIP, de preferência em `C:\Dev\Google-Ads-Intelligence-EPTV-V4`.
2. No PowerShell, na pasta descompactada, execute: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\01_instalar.ps1`
3. No Google Cloud, crie uma conta de serviço, habilite a API e obtenha permissão para contas de produção (Explorer, quando necessário).
4. No Google Ads, dê permissão **Somente leitura** ao e-mail da conta de serviço na conta correta.
5. Salve a chave JSON privada em `backend\credentials.json` **somente no seu computador**. Caso o uso de chaves seja proibido pela TI, use um fluxo de autenticação autorizado em vez de contornar a política.
6. Revise `backend\.env`, criado automaticamente no passo 2. Ajuste os dois IDs se estiver usando MCC.
7. Valide: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\02_validar.ps1`
8. Extraia 30 dias: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\03_extrair_30_dias.ps1`
9. Abra o protótipo: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\04_abrir_dashboard.ps1`

Para listar consultas antes de autenticar: `backend\.venv\Scripts\python.exe backend\extrair_google_ads.py --mostrar-consultas`

## O que já funciona e o que falta
- **Funciona localmente:** interface V4 e navegação/animacões/filtros com dados fictícios; extrator Python e estrutura de autenticação prontos para primeiro teste na sua conta.
- **Depende de acesso:** habilitação da Google Ads API, aprovação de acesso a produção, credenciais e permissão da conta EPTV.
- **Ainda não integrado:** a V4 **não consome o JSON gerado pelo extrator** e não apresenta dados reais automaticamente. A próxima etapa é construir uma API interna protegida, tratar as granularidades distintas e adaptar os gráficos.
- **Exemplos de GAQL podem precisar de ajuste** dependendo da campanha e compatibilidade entre métricas e segmentos; o extrator salva erros separadamente por relatório.
- Gênero e idade são visões distintas, não uma matriz combinada. Cidades podem voltar como IDs geográficos. Horários dependem do fuso da conta.

## Segurança
- Nunca envie `backend/.env`, `backend/credentials.json` ou `backend/dados_privados/` ao GitHub, Vercel, em mensagens ou para colegas.
- **Na Vercel, publique só `frontend/`.** A interface estática não precisa receber as credenciais do Google Ads.
- O script não altera anúncios ou campanhas.

Documentação oficial: https://developers.google.com/google-ads/api/docs/get-started/make-first-call e https://developers.google.com/google-ads/api/docs/api-policy/developer-token
