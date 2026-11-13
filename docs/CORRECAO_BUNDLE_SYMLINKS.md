# Correção do bundle no GitHub Actions

## Causa identificada

O `snow app bundle` do Snowflake CLI **3.33.0**, fixado nos workflows, cria links simbólicos no Ubuntu por projeto. No código do App Runtime, `_bundle_app_artifacts` chama `symlink_or_copy` para cada arquivo. Essa função tenta `os.symlink(absolute_src, dst)` e faz cópia apenas se o sistema recusar a operação. Assim, um pacote de origem só com arquivos reais pode gerar um bundle com links. A rejeição do nosso verificador era correta, mas faltava materializar essa representação intermediária do CLI.

Evidência primária na mesma versão do pipeline:

- [App Runtime manager, função de bundling](https://github.com/snowflakedb/snowflake-cli/blob/v3.33.0/src/snowflake/cli/_plugins/apps/manager.py#L1020).
- [symlink_or_copy: link primeiro, cópia como fallback](https://github.com/snowflakedb/snowflake-cli/blob/v3.33.0/src/snowflake/cli/api/artifacts/utils.py#L15).

Antes do CLI, `prepare-package.mjs` usava `copyFile` e `verify-package.mjs .migration-package` exigia arquivos reais. Entre essa verificação e a falha reportada, o workflow só executava `snow app bundle`. O npm é executado antes da preparação; não há dependências npm no runtime ou `node_modules/.bin` na lista de arquivos permitidos. Portanto a criação dos links vem do **CLI**, não de uma dependência npm ou de uma rotina nossa de criação de links.

Não foram obtidos os caminhos individuais do runner que falhou: o erro antigo não os informava. O diagnóstico novo os registrará no próximo CI. Não foi instalada ou executada uma nova CLI local nem acessada conta Snowflake para esta investigação.

## Correção

O fluxo dos dois workflows passa a ser:

1. Preparar o pacote isolado e verificá-lo estritamente.
2. Executar `snow app bundle` como antes.
3. **Diagnóstico temporário:** `diagnose-package-links.mjs` lista cada caminho e destino em JSON, sem abrir conteúdo ou seguir links de diretório, inclusive links quebrados.
4. `materialize-bundle.mjs` valida todos os arquivos e mapeamentos antes da primeira alteração. Só aceita um link de arquivo que aponte diretamente para o **mesmo caminho relativo** na origem `.migration-package`, dentro da lista aprovada. Links absolutos ou relativos são aceitos apenas com esse destino exato.
5. A origem deve existir como arquivo regular, sem nenhum link nos seus ancestrais; o destino resolvido também deve coincidir. O conteúdo deve ser idêntico ao arquivo aprovado no checkout e passar pela verificação de segredos. Nenhum conteúdo é lido através do link do bundle.
6. O link é substituído atomicamente por um arquivo real com os bytes validados. A origem não é sobrescrita, nem há cópia recursiva com dereferência irrestrita.
7. O verificador final roda novamente e **continua rejeitando qualquer link simbólico**, arquivo inesperado, conteúdo divergente, possível segredo ou destino diferente de homologação.

Não há exceção permanente para links no pacote final. Links externos, quebrados, encadeados, cíclicos, de diretório, usados como raiz, para outro arquivo permitido ou para caminhos privados são recusados. Uma falha na pré-validação não modifica nem os links válidos.

`package-policy.mjs` centraliza os mesmos dez arquivos permitidos e as verificações de homologação, compartilhados pelos scripts. `prepare-package.mjs` agora também recusa links nos arquivos-fonte e grava os buffers já validados como arquivos exclusivos, sem sobrescrever pacote anterior. Isso evita seguir um link de origem durante a cópia.

O diagnóstico é temporário: removê-lo após confirmar no Ubuntu a origem dos links e a aprovação do pacote materializado. Manter materializador, verificador estrito e regressões.

## Escopo e publicação

Não houve alteração em `app.yml`, backend, runtime, classificação, frontend, consultas ou métricas. A lista de arquivos, o scanner de segredos e o destino exclusivo `GOOGLE_ADS_INTELLIGENCE_REVIEW` / `EPTV_APPS.ADS_REVIEW` foram preservados. Não há consumo da quota Google Ads por esta correção.

O CI continua sem autenticação ou deploy Snowflake. O workflow de homologação continua somente manual, com os mesmos gates de operação, aprovação, variável e environment. A correção foi aplicada aos dois pontos de inspeção para que o mesmo erro não reapareça na validação manual.

O CLI pode recriar sua representação intermediária quando outros comandos internos fazem bundling. A materialização e a garantia de arquivos reais dizem respeito ao bundle local inspecionado pelos novos passos; não se afirmou ter validado um upload ou deploy. Nenhuma implantação foi executada.

## Testes e limites locais

Os testes novos cobrem preparação e recusa de sobrescrita, política de destino absoluto/relativo, conversão dos links do CLI, preservação da origem, rejeição de destinos externos/privados/quebrados/cíclicos, cadeias, raízes/diretórios ligados, arquivos extras, segredos, conteúdo alterado, target de produção, diagnóstico sem travessia e ordem/gates dos workflows.

Neste Windows, links simbólicos de arquivo retornam `EPERM`, e Linux/WSL não está instalado. **Onze testes que dependem desses links são marcados explicitamente como skipped no Windows**, nunca tratados como aprovados. A política de destinos e os testes de links de diretório/junction executam localmente. Em `ubuntu-latest`, falha ao criar links não gera skip: a suíte deve executar integralmente esses casos antes de chegar ao CLI.

As regressões existentes Node/Python e verificações do frontend continuam sendo executadas sem chamadas à API de produção. A confirmação integral do `snow app bundle` e de todos os testes POSIX depende do próximo runner Ubuntu; não foi alegada execução remota nesta tarefa.

Arquivos alterados/criados: `.github/workflows/ci.yml`, `.github/workflows/deploy-review.yml`, `migration/prepare-package.mjs`, `migration/verify-package.mjs`, `migration/package-policy.mjs`, `migration/materialize-bundle.mjs`, `migration/diagnose-package-links.mjs`, `migration/tests/package.test.mjs` e este documento. Preparado para revisão, novo commit e push; sem publicação no Snowflake.
