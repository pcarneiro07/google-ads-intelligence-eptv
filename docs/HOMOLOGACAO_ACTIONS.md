# Homologação pelo GitHub Actions — revisão do pipeline

Base examinada: branch `migration/snowflake-app-runtime`, commit `f08270f`, árvore inicialmente limpa. Nenhuma publicação, chamada Google Ads real ou alteração administrativa foi executada. O aplicativo `ACIDADEON_INTELLIGENCE` não é destino de nenhum comando preparado.

## Diagnóstico

O workflow já era manual, usava `ubuntu-latest`, environment e OIDC. Entretanto fixava CLI 3.26.0, não executava o bundle oficial no CI e não oferecia validação sem deploy. Não verificava explicitamente usuário/role nem restringia a branch por condição. A preparação por allowlist existente foi preservada.

Fixamos CLI **3.33.0 em Ubuntu**, a mesma versão relatada no Windows, para isolar a mudança de sistema operacional. Nenhuma alteração de ACL, `icacls`, permissões Windows ou bypass foi adicionada. A primeira execução Linux ainda é necessária para comprovar o empacotamento nessa plataforma.

## Fluxos preparados

- `ci.yml`: testes offline existentes → pacote novo por allowlist → conferência dos dez arquivos e destino → instalação da CLI sem OIDC → `snow app bundle` dentro do pacote → inspeção de `output/bundle` por nomes e conteúdo exato. Não autentica nem chama APIs corporativas.
- `deploy-review.yml`: disparo exclusivamente manual na branch da migração; testes acima obrigatórios; environment `snowflake-review-approval`; configuração obrigatória; OIDC; `snow connection test -x` e `snow app validate -x`.
- A operação padrão **validate** termina aí. Ela autentica e consulta a conta, mas não executa upload/build/deploy. Deve ser disparada somente após provisionamento e autorização da equipe.
- A operação **deploy** exige também `reviewed_plan=true`, `ENABLE_SNOWFLAKE_REVIEW_DEPLOY=true` e aprovação do environment. Só então executa `snow app deploy -x`. Concorrência serializada evita deploys simultâneos; não cancela um deploy em andamento.

`snow app validate` verifica database/schema e empacotamento; não comprova todas as permissões, montagem de Secret, saída de rede ou funcionamento do runtime. [Validate](https://docs.snowflake.com/en/developer-guide/snowflake-cli/command-reference/snowflake-app-runtime-commands/validate), [bundle offline](https://docs.snowflake.com/en/developer-guide/snowflake-cli/command-reference/snowflake-app-runtime-commands/bundle).

## Configuração administrativa pendente

No repositório privado, habilitar Actions e criar o environment **antes** de habilitar deploy. Configurar revisores obrigatórios, impedir autoaprovação e restringir deployment branches à branch da migração. Confirmar que o plano GitHub suporta essas proteções no repositório privado; sem elas, manter deploy desabilitado. OIDC com subject de environment depende dessa restrição para limitar a branch.

| Local | Nome | Configuração |
|---|---|---|
| Secret do environment | `SNOWFLAKE_ACCOUNT` | Identificador da conta aprovada |
| Variable do environment | `SNOWFLAKE_REVIEW_USER` | `EPTV_ADS_GITHUB_REVIEW` |
| Variable do environment | `SNOWFLAKE_REVIEW_ROLE` | `EPTV_ADS_APP_OWNER` |
| Variable do repositório | `ENABLE_SNOWFLAKE_REVIEW_DEPLOY` | Ausente/false inicialmente; true só após autorização de deploy |

A variável de habilitação é do **repositório**, pois a condição do job é avaliada antes de carregar o environment. Nenhum segredo Google, senha Snowflake, chave privada ou token deve ser inserido no GitHub. A action oficial obtém o token temporário e configura authenticator WIF, provider OIDC e audience `snowflakecomputing.com`. Não imprimir tokens nem habilitar debug. [Action oficial e autenticação](https://docs.snowflake.com/en/developer-guide/cicd/github-action).

`migration/snowflake-wif-review.sql` contém o template de usuário SERVICE, issuer GitHub e subject exato do environment. Segurança deve confirmar o subject efetivo, inclusive políticas com IDs imutáveis, e criá-lo com SECURITYADMIN ou privilégios delegados de criação de usuário/administração de roles. Não usar esse papel administrativo no workflow.

O administrador App Runtime deve confirmar habilitação/região, database compartilhada, schemas de homologação/build, warehouse aprovado e os grants de `migration/snowflake-setup.sql`. A recomendação oficial é provisionar as roles via setup administrativo App Runtime e reconciliar os grants equivalentes; não executar o SQL cegamente. Privilégios de criação de database/schema, CREATE ROLE/USER e MANAGE GRANTS cabem ao provisionador; CREATE INTEGRATION no account e CREATE NETWORK RULE/SECRET no schema cabem ao administrador responsável pela integração. O deploy recebe somente a role proprietária da homologação e USAGE/READ necessários. Nenhum grant em objetos ACIDADEON deve ser concedido. [Privilégios App Runtime](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/privileges).

## Google Ads: conferência estática

O manifesto referencia `EPTV_APPS.ADS_SECRETS.GOOGLE_ADS_SERVICE_ACCOUNT`, GENERIC_STRING, montado em `/secrets/GOOGLE_ADS_SERVICE_ACCOUNT/secret_string`. O administrador fornece o JSON via cofre, fora de arquivos SQL versionados e logs. A role precisa READ no Secret, USAGE no database/schema e na integração.

O SQL existente restringe a network rule EGRESS/HOST_PORT a `oauth2.googleapis.com:443` e `googleads.googleapis.com:443`; a `EPTV_GOOGLE_ADS_EAI` permite essa regra e somente esse Secret. Esses hosts correspondem aos endpoints fixos do cliente Node. Não foram adicionados curingas ou acessos externos. O backend atual não lê developer token; qualquer exigência adicional na conta Google é pendência de homologação, não deve ser contornada por credenciais no build.

A conta de serviço Google deve continuar com acesso somente leitura aos anunciantes validados. WIF GitHub→Snowflake autentica o deploy; não substitui o fluxo OAuth Google existente.

## Preservação e evidências

Não mudaram backend Python/Node, frontend, classificação, manifesto, consultas, contas, redes, períodos, fórmulas ou filtros. Permanecem quatro áreas, limites de granularidade, cache e uma instância. Os testes sintéticos preservam a baseline; não homologam resultados novos na conta. Nenhum consumo Explorer ocorreu nesta revisão; build remoto e execução futura poderão consumir recursos Snowflake e as leituras Ads existentes.

O verificador de publicação examina somente arquivos versionados e bloqueia nomes privados antes de ler conteúdo; `.gitignore` exclui credenciais, `.env`, exports, backups, chaves e configurações CLI. A inspeção do pacote rejeita arquivos extras, symlinks, conteúdo divergente e destino alternativo. Isso não certifica histórico remoto ou configurações de secret scanning do GitHub.

Verificações locais: 16 testes Node, 24 Python V6.1, frontend, fingerprints, build e `py_compile` passaram; publicação passou para os 48 arquivos então versionados. O verificador novo aceitou uma cópia limpa dos dez arquivos em diretório temporário e rejeitou a adição de um arquivo inesperado. Sintaxe JS e `git diff --check` passaram. Pytest não está instalado; nenhuma dependência foi instalada. A pasta `.migration-package` preexistente contém `dist` e foi preservada; o novo verificador corretamente a rejeita como pacote de fontes limpo. Actions usa checkout novo.

Ainda pendentes: execução Ubuntu do bundle/inspeção; validação de workflows no GitHub; configuração real de environment/variables/Secrets; confiança WIF, políticas de autenticação/rede e grants; Secret/EAI reais; build remoto; sessão, OAuth e conciliação no runtime com autorização própria. **Nenhum workflow foi disparado, SQL executado ou aplicativo publicado.**
