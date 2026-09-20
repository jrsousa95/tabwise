# Spike 3 — Reconciliação de eventos (HLC + conflito de comanda duplicada)

**Referência:** `docs/architecture.md` §3.3, §4, `docs/implementation-plan.md` M0
**Data:** 2026-09-20
**Status:** ✅ Validado — protótipo isolado, sem depender de rede, Tauri ou SQLite

## O que foi testado

Provar que a lógica de reconciliação central da arquitetura (ARCH §3.3 + §4) é implementável de forma determinística: um Hybrid Logical Clock (HLC) para ordenação causal entre terminais, e a regra de conflito do §4.2 (duas comandas abertas na mesma mesa, quando o host cai e dois terminais não se enxergam) resolvida automaticamente sem intervenção manual, produzindo sempre o mesmo estado final **independente da ordem em que os eventos chegam**.

## Implementação

Protótipo isolado em `spikes/spike-3-reconciliation/` (pacote TS standalone, fora do workspace npm — mesmo padrão de isolamento já usado pelo `apps/desktop/sidecar` no Spike 1, propositalmente sem depender de nenhuma infraestrutura de produto ainda):

- `src/hlc.ts`: implementação própria do HLC (Kulkarni et al.) — `tick` (evento local), `receive` (evento remoto), `compare`, e `serialize`/`parse` para um formato de string de largura fixa em hex, diretamente ordenável (o campo `hlc` do ARCH §3.1 é `TEXT`).
- `src/events.ts`: subconjunto mínimo do modelo de eventos — `order_opened`, `item_added`, `item_canceled` — o suficiente para exercitar tanto o caso feliz (§4.1) quanto o de conflito (§4.2).
- `src/reconciliation.ts`: `sortEvents` (ordem total por HLC + id), `merge` (dedupe por `id` + reordena), e `project` (replay determinístico que implementa a regra do §4.2: a `order_opened` de menor HLC vira canônica; qualquer outra para a mesma mesa é marcada `mergedInto` e seus itens são reatribuídos à canônica na leitura). `project` também devolve `mergeWarnings`, a base de dados para o indicador não bloqueante que a UI precisa mostrar ao terminal "perdedor" (§4.2).
- `test/sim.ts`: gerador de cenários para os testes de propriedade — usa o próprio `fast-check` para gerar uma lista abstrata de ações ("abrir order", "adicionar item", "cancelar item") distribuídas entre 3 terminais e só 2 mesas (de propósito, para forçar colisões com frequência), e um interpretador que atribui HLCs causalmente corretos via `tick`/`receive` — dogfooding do próprio módulo testado.
- `test/hlc.test.ts`: unitários do HLC + duas propriedades (`serialize`/`parse` fazem roundtrip; `tick(receive(a,b))` é sempre causalmente posterior a `a` e `b`).
- `test/arch-4.2-table-conflict.test.ts`: reproduz **literalmente** o cenário descrito no ARCH §4.2 (dois terminais, host fora do ar, mesma mesa) com dados concretos, e um segundo caso com 3 terminais conflitando na mesma mesa (garante que múltiplos perdedores mesclam direto na canônica, sem encadear merges).
- `test/reconciliation.property.test.ts`: três propriedades com `fast-check` (500, 300 e 500 execuções aleatórias): **comutatividade** (embaralhar a ordem de chegada não muda o estado final), **idempotência** (mesclar um log com ele mesmo não muda nada) e **particionamento** (dividir o log em dois logs parciais e mesclar de volta reproduz o estado original — o caso real de dois terminais sincronizando entre si).

## Resultado

- `npm run typecheck` (TS strict + `noUncheckedIndexedAccess`) e `npm test` passam limpos: 12 testes, incluindo ~1300 execuções aleatórias combinadas dos três testes de propriedade.
- O cenário exato do ARCH §4.2 foi validado: order de menor HLC vence, itens da order perdedora são reatribuídos à canônica, aviso de merge é gerado, e o resultado independe de qual log é mesclado "primeiro".

## Achado relevante (não é uma armadilha de implementação, é sobre a estratégia de teste)

Fiz um teste de mutação manual: comentei a linha que marca a order perdedora como mesclada (`losing.mergedInto = ...`) e rodei a suíte de novo. **Os três testes de propriedade continuaram passando** — só os testes literais do ARCH §4.2 quebraram.

Isso faz sentido em retrospecto e é uma lição pro M1: os testes de propriedade validam *"a ordem não importa"*, o que continua sendo verdade mesmo com a regra de negócio errada (nunca mesclar também é determinístico e independente de ordem). Eles não substituem testes que fixam o comportamento *correto* esperado — só os testes literais (exemplo concreto do §4.2) fazem isso. **Ação para o M1:** ao portar isso para `packages/sync-engine`, manter as duas camadas de teste (propriedade + exemplos literais do PRD/ARCH), não confiar só na propriedade para cobrir regras de negócio específicas.

## Pendências / próximos passos para o M1

1. Este protótipo cobre só `order_opened`/`item_added`/`item_canceled`. O `sync-engine` real do M1 precisa do modelo de evento completo (`operator_registered`, `order_transferred`, `tables_grouped`, `order_closed`, `payment_recorded`) e persistência em SQLite (aqui tudo roda em memória, de propósito).
2. Não foi testado volume/performance de replay (quantos eventos um replay completo suporta antes de precisar de snapshot/checkpoint) — não era objetivo deste spike, mas vale considerar no M1 se o log de eventos crescer muito.
3. O merge aqui assume que `resolveCanonical` nunca encontra uma order referenciada por `item_added`/`item_canceled` antes do seu próprio `order_opened` ter sido processado — verdade sempre que a ordenação por HLC reflete causalidade real (garantido pelo próprio HLC). Vale manter esse invariante explícito como comentário/assert quando isso virar código de produção.

## Como rodar

```bash
cd spikes/spike-3-reconciliation
npm install
npm run typecheck
npm test
```
