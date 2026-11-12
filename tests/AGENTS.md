# Testes — regras de confiabilidade

- Ler `../AGENTS.md` e `../docs/BASELINE_VALIDADA.md` antes de alterar testes ou fixtures.
- Não usar credenciais nem chamar Google Ads real na suíte automatizada. Mockar `AdsReader` e evitar gravar arquivos privados.
- Preservar e ampliar `tests/test_v61.py` ao modificar backend, contratos de resposta ou cálculos.
- Conferir: (a) duas contas e múltiplas redes, (b) totais aditivos de campanhas, (c) custos/CPV em micros, (d) taxas e quartis indisponíveis/ponderadas, (e) classificação BDC/EPTV1/EPTV2/Outros, (f) falha de uma conta interrompe consolidado, (g) cache TTL/atualização forçada, (h) dados de cidades/dispositivos/horários sem somas cruzadas.
- Referência fixa do recorte 14/08/2026–11/11/2026: 470.635 impressões, 50.543 TrueView, 82 cliques e R$ 1.792,02 (ver documento); não aplicar os mesmos valores a períodos móveis diferentes.
- Testar que servidor não fornece `.env`, `credentials.json` ou caminhos privados por HTTP, e que não aceita acesso externo inadvertido.
- Se uma mudança alterar um contrato ou uma métrica, adicionar teste que falharia antes da correção e passaria depois.
- Sugestão Windows: `.\backend\.venv\Scripts\python.exe -m pytest .\tests -q`. Se pytest não estiver instalado, sinalizar antes de mexer nas dependências.
