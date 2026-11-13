# Revisão da migração V6.1 para Snowflake App Runtime

**Atualização de pipeline:** consulte [Homologação pelo GitHub Actions](HOMOLOGACAO_ACTIONS.md) para o fluxo Ubuntu, validação sem publicação e configuração administrativa atual. As verificações abaixo registram também etapas anteriores da migração.

**Estado:** código e arquivos preparados para revisão; nenhum GitHub remoto, upload, provisionamento, chamada real Google Ads ou deploy foi executado nesta tarefa. Os nomes de recursos do manifesto/SQL são propostas, não objetos descobertos na conta.

## Compatibilidade e arquitetura

O App Runtime atualmente aceita Node.js; suporte Python está planejado. O servidor Python não pode ser publicado diretamente apenas acrescentando um manifesto. A implementação prepara um backend Node separado, mantendo HTML/CSS/JavaScript atuais, sem Streamlit, Next.js obrigatório ou subprocesso Python no container. A conta deve ser paga, estar em região comercial suportada e ter App Runtime habilitado; isso ainda depende de confirmação da EPTV. [Limitações oficiais](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/limitations)

Node 22 é o alvo do CI, com compatibilidade declarada 22–24. Os testes locais rodaram em Node 24. A CLI preparada para CI é 3.33.0; não foi instalada ou executada localmente. [Preparação oficial](https://www.snowflake.com/en/developers/guides/getting-started-snowflake-app-runtime/)

| Área | Adaptação preparada | Preservação |
|---|---|---|
| Frontend | Cópia do HTML no build; ajuste apenas de mensagens de hospedagem | CSS, gráficos, animações, quatro telas, filtros, CSV, calendário sem limite e rótulos semanais |
| Backend | `runtime/server.mjs` e `service.mjs` | Rotas, relatórios, filtros e validação de período |
| GAQL | Contrato `runtime/reference.json` gerado por AST do Python | Oito consultas de métricas e quatro inventários exatos, sem LIMIT 100 ou filtro de campanhas ativas |
| Classificação | Porta em `runtime/classification.mjs`, com regressão diferencial | Hierarquia, seis mapeamentos recentes, evidências, confiança e pendências sem rateio |
| Google OAuth | JWT RS256 no servidor a partir do Secret | Conta de serviço, escopo adwords, MCC, anunciantes e REST searchStream somente leitura |
| Cache | RAM, TTL 900 s configurável em 300–3600 s, refresh mínimo 60 s | Intervalo completo na chave, inventário entre períodos, serialização, falha sem consolidado parcial |
| Usuários | SSO/ingresso autenticado e RBAC Snowflake | Audiência corporativa autorizada; filtros não são permissões de segurança |

## Referência local e integridade

A pasta não tinha Git. Foi criado um histórico inicial somente com fontes apropriadas para publicação, e a referência está em `local-v6.1`; o trabalho está em `migration/snowflake-app-runtime`. Backups, credenciais, ferramentas e documentos legados continuam no disco. Nenhum arquivo funcional de `backend/` ou `frontend/` foi alterado na migração.

O exportador extrai funções por AST e não importa o autenticador, carrega `.env`, abre chave ou usa rede. O JSON gerado contém somente consultas, versão, contas, mapeamentos e fingerprints, **não resultados reais**. `--check` e os testes detectam deriva. Hashes normalizam finais de linha para Windows/Linux.

Mantidos Promo `7182459480`, Institucional `5498287982`, MCC `9234046127`, API v26, todas as redes, D-1 em America/Sao_Paulo e calendário sem limite artificial de duração. Os mapeamentos por conta/ID seguem em `backend/programas.json`, e no contrato derivado. Não surgiram regras por apresentador, primeira/segunda edição isoladas ou vídeos `SINAL EPTV 1/2`.

A hierarquia continua IDs confirmados → rótulos oficiais confirmados → nome inequívoco → evidências de grupos/criativos/vídeos → pendente. Campanhas mistas/conflitantes permanecem integralmente pendentes em todas as dimensões. A evidência individual do anúncio não distribui custo ou performance da campanha.

Referência homologada de **14/08/2026–11/11/2026**, ambas as contas e todas as redes: **R$ 1.792,02 / 470.635 impressões / 50.543 TrueView / 82 cliques**. Preservados CPV oficial, conversão de micros, taxas por formato, quartis ausentes e campanhas com TrueView zero. A regressão reproduz os totais com dados sintéticos; não representa nova homologação real no Snowflake.

## Secrets e External Access Integration

O administrador deve provisionar `EPTV_APPS.ADS_SECRETS.GOOGLE_ADS_SERVICE_ACCOUNT`, tipo `GENERIC_STRING`, com o JSON da conta de serviço vindo do cofre corporativo. Não inserir seu conteúdo no SQL versionado, GitHub, `.env` de build, argumento de comando ou log. Se a política Google Cloud proibir chaves, o fluxo de identidade precisará ser redesenhado e homologado antes do deploy.

O manifesto monta o Secret sob o nome `GOOGLE_ADS_SERVICE_ACCOUNT`. O servidor lê `/secrets/GOOGLE_ADS_SERVICE_ACCOUNT/secret_string` a cada uso, detecta rotação e invalida o token associado à chave anterior. Tokens/chaves não são retornados ao navegador. O endpoint OAuth é fixo e redirects externos são recusados. [Arquivos de Secrets e ambiente](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/runtime-environment)

A network rule permite somente `oauth2.googleapis.com:443` e `googleads.googleapis.com:443`. A EAI proposta, `EPTV_GOOGLE_ADS_EAI`, referencia regra e Secret. A conta de serviço precisa ter **somente leitura** nas duas contas Ads; o escopo OAuth não substitui essa permissão. O cliente implementa apenas GAQL SELECT via `googleAds:searchStream`, sem endpoints de mutação.

## Acesso e permissões

Na nuvem, o processo usa `HOSTNAME` e `PORT` injetados pelo Snowflake, atrás do ingresso autenticado. O Python local continua em `127.0.0.1`. O preview Node também fica no loopback. O modo Snowflake verifica marcadores de execução da plataforma, não sendo um modo de exposição pública avulsa.

O servidor restringe hosts a `*.snowflakecomputing.app`, exige contexto de sessão do ingresso e valida Origin e `X-Ads-Request` no POST. O header `Sf-Context-Current-User-Token` **não autentica por si só**: a fronteira de confiança é o proxy gerenciado do Snowflake. Confirmar em homologação o formato de Host/Origin e desse header. Se a plataforma usar valores diferentes, ajustar ao comportamento verificado, sem liberar hosts arbitrários. Não há CORS aberto.

Só são servidos `/`, `/index.html`, `/api/status`, `/api/relatorios` e `/api/atualizar`. Código, manifesto, contrato, chaves e exports não são arquivos públicos. Erros não retornam corpo bruto Google nem stack trace. Falha de conta, inventário, relatório ou moeda aborta a atualização completa.

O roteiro `migration/snowflake-setup.sql` **não foi executado**. Preferir setup administrativo do App Runtime para database compartilhada, não database pessoal. O administrador deve reconciliar os grants do roteiro com a política da conta. [Privilégios oficiais](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/privileges)

| Papel/objeto proposto | Uso |
|---|---|
| `EPTV_ADS_APP_OWNER` | Role proprietária definitiva e deploy de homologação; não ACCOUNTADMIN/SYSADMIN no runtime |
| `EPTV_ADS_APP_VIEWER` | Audiência corporativa, sem READ do Secret ou deploy |
| `EPTV_APPS.ADS_REVIEW` | Aplicação/artefatos de homologação |
| `EPTV_APPS.ADS_BUILDS` | Build remoto explícito; confirmar CREATE SERVICE nesse schema |
| `EPTV_APPS.ADS_SECRETS` | Secret/network rule; READ do Secret e USAGE da EAI só ao proprietário |
| `EPTV_APPS_QUERY_WH` | Warehouse existente aprovado, USAGE ao proprietário |

O roteiro inclui CREATE APPLICATION SERVICE, grants de stage/repositório quando necessários ao caminho CLI, BIND SERVICE ENDPOINT e USAGE dos objetos. O setup da plataforma pode já fornecer parte desses privilégios. A role que criar o serviço deve ser a proprietária definitiva: não contar com transferência de ownership depois.

Conceder USAGE da aplicação somente à audiência autorizada, nunca `PUBLIC`. Todos os usuários com acesso poderão consultar as duas contas Ads fornecidas pela aplicação. Não há isolamento de contas por identidade nem políticas de linha Snowflake aplicadas a esses dados externos. [Segurança e audiência](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/security)

## GitHub privado e Actions

Ainda falta definir organização, repositório privado, colaboradores e proteção de branches. Publicar somente a branch revisada; não usar push espelhado ou `git push --all`. Não enviar backups, reflogs ou a pasta `.git` como artefato.

`.gitignore` e o verificador bloqueiam `.env` e cópias, chaves, credenciais, snapshots, exports, backups e auditorias detalhadas. Documentos/ferramentas legados com outros números corporativos ficam locais. Contas/MCC/mapeamentos indispensáveis e a baseline explicitamente solicitada foram mantidos. A seleção de fontes e a verificação de possíveis segredos não substituem o secret scanning corporativo.

`ci.yml` roda paridade GAQL/classificação, testes offline Node/Python, filtros do frontend, build e empacotamento permitido, sem credenciais Ads. O Node usa **zero dependências npm externas**; `npm ci --ignore-scripts` confere o lockfile. Python existe somente para desenvolvimento, comparação e operação local.

`deploy-review.yml` é manual (`workflow_dispatch`), depende dos testes e exige: plano aprovado no input, variável `ENABLE_SNOWFLAKE_REVIEW_DEPLOY=true` e environment `review`. **Antes de habilitar a variável, configurar nesse environment revisores obrigatórios e restrição de branches.** Não existe target de produção.

CI autentica no Snowflake por OIDC/WIF da action oficial. Provisionar usuário de serviço que confie no issuer GitHub e no subject exato do environment, associado à role de homologação. Configurar `SNOWFLAKE_ACCOUNT` como GitHub Secret e `SNOWFLAKE_REVIEW_ROLE` como variável do environment. Não colocar a chave Google ou uma chave Snowflake no GitHub. [Actions/OIDC oficiais](https://docs.snowflake.com/en/developer-guide/cicd/github-action)

O subject normalmente se parece com `repo:ORG/REPO:environment:review`. Repositórios novos podem emitir subject imutável com IDs de organização/repositório; confirmar a forma exata pela política GitHub sem imprimir tokens. [Nota oficial sobre subjects novos](https://docs.snowflake.com/en/user-guide/tutorials/dbt-projects-on-snowflake-ci-cd-tutorial)

Exemplo administrativo para revisão, substituindo o subject pela forma exata aprovada (não executado):

```sql
CREATE USER EPTV_ADS_GITHUB_REVIEW TYPE = SERVICE
  WORKLOAD_IDENTITY = (
    TYPE = OIDC
    ISSUER = 'https://token.actions.githubusercontent.com'
    SUBJECT = '<EXACT_APPROVED_GITHUB_ENVIRONMENT_SUBJECT>'
  )
  DEFAULT_ROLE = EPTV_ADS_APP_OWNER;
GRANT ROLE EPTV_ADS_APP_OWNER TO USER EPTV_ADS_GITHUB_REVIEW;
```

As actions usam majors oficiais; a CLI está fixada em 3.33.0. Se a política corporativa exigir SHAs imutáveis, resolvê-los e revisá-los antes de habilitar deploy. Não foram inventados hashes de terceiros.

## Manifesto e pacote

`app.yml` usa versão 2 em sintaxe JSON válida como YAML, validável sem nova biblioteca. Define só homologação, Secret/EAI, install/build/run Node, uma instância e auto-suspend em 900 s. O build remoto precisa ainda validar manifesto e nomes na conta. [Manifesto oficial](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/app-yml)

`node migration/prepare-package.mjs` gera `.migration-package/` a partir de **10 arquivos em allowlist**: manifesto, package/lock, builder, HTML e cinco arquivos runtime. Não copia a pasta inteira nem inclui backend Python, auditorias, testes ou pastas privadas. Se o destino existir, para sem apagá-lo; para outra versão, usar checkout limpo ou renomear o pacote anterior após revisão.

Após autorização específica, o CLI deve rodar **dentro do pacote permitido**. `snow app deploy` faz upload/build e cria/altera o serviço: não é uma validação offline, pode gerar custo e não foi executado. O manifesto descreve o estado integral pretendido. [Fluxo de deploy](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/deploy)

## Custos e capacidade

Sem conta, região, contrato e carga medidos, não há preço estimado em reais. A configuração inicial usa uma instância, suspensão automática após 900 s e retomada habilitada; confirmar cold start e suspensão em homologação. Escalar cria caches independentes e pode multiplicar leituras Ads, por isso `min_instances=max_instances=1`. [Escala e suspensão](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/scale-and-suspend)

Usar warehouse existente aprovado. O dashboard não executa SQL de negócio no Snowflake nesta versão, mas isso não elimina custo do runtime ou possíveis custos de build/artefatos/armazenamento conforme contrato. Não foi criado warehouse ou compute pool.

Monitorar `SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_APP_RUNTIME_COMPUTE_HISTORY`: créditos no nível da conta, com latência de até três horas e sem atribuição exata por app. Converter pela tarifa contratada; alertas/orçamentos dependem do administrador. [Medição oficial](https://docs.snowflake.com/en/sql-reference/account-usage/snowflake_app_runtime_compute_history)

Uma leitura fria mantém 16 consultas de relatórios, 2 de moeda/fuso, 8 de inventário e até 3 geográficas: **26–29 SearchStream**, sem OAuth. Com inventário reutilizado: 18–21. São requisições do código, não garantia de unidades comerciais. Conferir quota Explorer vigente antes da abertura corporativa.

O cache não persiste em suspensão, restart ou deploy. Períodos maiores retornam mais dados e exigem mais memória/tempo; não são truncados para 365 dias. Os limites efetivos de resposta/tempo do ingresso Snowflake e o volume histórico real precisam de ensaio de homologação.

## Verificação realizada

- **24 testes Python** existentes passaram, com dados simulados.
- **16 testes Node** passaram: fontes/GAQL, classificação diferencial com múltiplos casos, payload multiconta inteiro contra Python, micros/CPV/taxas/quartis, TrueView zero, D-1 e períodos longos, cache/concorrência, erros/moedas, JWT com chave efêmera simulada, rotação, SearchStream acima de 100 mil linhas, HTTP/sessão/origem, manifesto e CSS.
- Na paridade de payload, somente timestamps de consulta são normalizados: Node usa ISO UTC, Python local usa seu timezone. Nenhuma métrica é ignorada.
- Verificações existentes de frontend passaram: filtros nos oito relatórios, partição de totais, calendário, GET/POST, rejeição de período divergente e script embutido sincronizado.
- `npm ci --ignore-scripts`, build, sintaxe JS, `py_compile`, fingerprints e proteção de publicação passaram.
- Pytest permanece ausente; usou-se a suíte `unittest`. Nenhuma dependência Python foi instalada nesta tarefa.

**Não executados:** CLI Snowflake (indisponível), build remoto, SSO real, grants, Secrets/EAI reais, OAuth Google no runtime, suspensão/retomada reais, carga, navegador/mobile ou nova conciliação da conta. Os workflows GitHub foram preparados, mas não executados num remoto.

## Plano de implantação para aprovação

1. Revisar branch, contrato, manifesto, SQL, audiência, secret scanning e custos; confirmar org/repo privado e nomes dos objetos.
2. Publicar apenas código revisado no GitHub privado, proteger a branch principal e executar CI, sem segredo Google.
3. Com autorização administrativa separada, configurar database compartilhada, role definitiva, warehouse existente, Secret via cofre, EAI e grants. Configurar OIDC e revisores do environment.
4. Autorizar explicitamente **homologação**, habilitar a variável e disparar workflow manual. Ele testa e prepara o pacote antes do deploy.
5. Conferir sessão/role, Host/Origin/contexto, bloqueio de caminhos privados, OAuth e oito relatórios multiconta/multirrede. Testar falha de conta sem consolidado parcial e refresh/cache.
6. Mediante autorização de leitura real, reconciliar 14/08/2026–11/11/2026 com **R$ 1.792,02 / 470.635 / 50.543 / 82**, além da classificação. Registrar ajustes tardios do provedor sem forçar números no código.
7. Testar desktop/mobile, calendários longos, gráficos, filtros, animações, CSV e rótulos; medir memória/latência/quota e suspensão. Só então propor manifesto de produção e autorização separada de promoção.

Rollback de homologação: suspender o serviço, restringir USAGE ou redeployar o commit/pacote anterior aprovado. Não usar DROP como rollback (UNDROP não é suportado). A versão Python local permanece independente. [Limitações de ciclo de vida](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/limitations)

## Arquivos preparados

- `app.yml`, `package.json`, `package-lock.json`: destino/execução de homologação.
- `runtime/{server,service,google-ads,classification}.mjs`, `runtime/reference.json`: backend e contrato.
- `migration/{export_reference,python_oracle}.py`: extração/paridade offline.
- `migration/{build,prepare-package,check-publication}.mjs`: build, allowlist e verificação.
- `migration/tests/{parity,security}.test.mjs`: regressão/segurança.
- `migration/snowflake-setup.sql`: roteiro administrativo.
- `.github/workflows/{ci,deploy-review}.yml`: CI e deploy manual desabilitado por padrão.
- `.gitignore`, `.gitattributes`, `README.md`, este documento: proteção e operação.

Nenhum segredo foi exibido ou incluído nos arquivos de migração. Workflows e SQL não constituem autorização para executá-los agora.
