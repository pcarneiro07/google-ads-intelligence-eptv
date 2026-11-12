# Frontend — interface Google Ads Intelligence

## Fonte de execução e consistência
- `index.html` é o arquivo **servido pelo backend**, com `<style>` e `<script>` embutidos.
- `dashboard.js` contém o JavaScript de referência. Se mudar comportamento, manter `dashboard.js` e o script dentro de `index.html` sincronizados; alterar somente `dashboard.js` não muda a tela servida.
- Não trocar o mecanismo dinâmico por números fixos ou mocks silenciosos. Consumir `/api/relatorios` e indicar período, conta, rede e origem/cache de forma honesta.

## Experiência obrigatória
- Preservar identidade Google (azul, verde, amarelo, vermelho), layout claro, hierarquia dos KPIs e simplicidade da navegação.
- Manter os três elementos giratórios, movimentos sutis dos cards/gráficos, controle de animações e respeito a `prefers-reduced-motion`.
- Priorizar `transform`/`opacity` em animações; evitar loops pesados, reflows, renderizações excessivas e perda de desempenho mobile.
- Preservar acessibilidade de foco, contraste, estados de carregamento, ausência de dados e erros; filtros e botões devem funcionar por teclado quando possível.
- Não duplicar o mesmo indicador em várias telas sem motivo. Áreas principais: panorama; criativos/anúncios; idade/gênero, cidades e dispositivos; desempenho por dia/hora.
- Filtros: BDC, EPTV1, EPTV2, outros, todos; contas Promo/Institucional/ambas; redes; período. Ao filtrar, recomputar métricas com as linhas do mesmo universo.

## Semântica nos gráficos
- Custo total, impressões, TrueView e cliques são medidas diferentes. Exibir `CPV oficial` somente conforme disponibilidade/cálculo correto.
- Taxas in-stream, in-feed e Shorts e quartis de retenção são distintos; não mostrar “taxa de views” genérica como substituta.
- Taxas ausentes: apresentar `—`/não disponível, jamais zero inventado. Não tirar média simples de percentuais entre campanhas.
- Tempo: usar dias reais do calendário, lacunas explícitas, sem compactar intervalo em dias com veiculação.
- Visualizar programa por impressões, investimento ou TrueView para não desaparecerem campanhas de alcance.
- Indicadores e comparações devem mostrar a rede e a conta selecionadas; nunca exibir números da Promo como total de ambas.

## Testes mínimos
- Conferir filtros, navegação, cards, detalhamento, mapa de calor, mudança de períodos, refresh e comportamento mobile.
- Verificar que JavaScript/CSS funciona no `index.html` servido; rodar verificação de sintaxe JS ou smoke test de navegador se disponível.
- Dados de teste devem ser rotulados como simulados; não registrar que validação simulada comprova dados reais.
