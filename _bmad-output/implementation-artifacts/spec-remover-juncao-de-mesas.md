---
title: 'Remover a feature de junção de mesas (PRD 2.6, descontinuada)'
type: 'refactor'
created: '2026-09-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '1780123a21b1d8674684d9f728ed2ea3ebbc72aa'
context:
  - '{project-root}/docs/prd.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** a junção de mesas (PRD 2.6) foi emendada em 2026-09-21 (trava de sobreposição, desfazer, visibilidade) e mesmo assim, em uso real no dia seguinte, o dono avaliou que continuava confusa e não agregava valor suficiente pro ganho de complexidade. Decisão: remover a feature inteira (UI + API), não corrigir de novo. Documentado em `docs/prd.md` (Épico 2.6, commit `1780123`).

**Approach:** remover toda a UI e as rotas de API que criam/gerenciam grupos e o fechamento conjunto que dependia deles. **Não remover** o schema dos eventos `tables_grouped`/`table_group_dissolved` nem sua projeção em `tableGroups` — instalações existentes (inclusive a do dono) já têm esses eventos gravados, e `rowToEvent` (`apps/desktop/sidecar/src/db.ts`) revalida cada evento contra o schema Zod a cada leitura do banco; remover o tipo quebraria a releitura do log inteiro nessas instalações. Isso é uma remoção de superfície de produto, não uma migração de dados.

## Boundaries & Constraints

**Always:** manter `TablesGroupedSchema`/`TableGroupDissolvedSchema` (`packages/shared-types/src/events.ts`), o `case "tables_grouped"`/`case "table_group_dissolved"` em `packages/sync-engine/src/reconciliation.ts`, e o campo `tableGroups` de `ProjectedState` exatamente como estão — nenhuma mudança nesses dois arquivos. Fechamento de comanda passa a ser **sempre individual** (`POST /orders/:id/close`); nenhuma forma de fechar comandas juntas continua existindo.

**Never:** tocar em `packages/shared-types/src/events.ts` ou `packages/sync-engine/src/reconciliation.ts`. Remover ou alterar `computeSubtotalCents`/`parseSplits` no sidecar (compartilhados com `POST /orders/:id/close`, que continua existindo) — só remover o que é exclusivo do fechamento conjunto (`distributeProportionally`, usado só ali). Mudar o comportamento de `POST /table-groups`/`DELETE /table-groups/:id`/`POST /orders/:id/close-group` além de fazê-los sumir (404 padrão da rota não encontrada, já é o comportamento do fallback final do sidecar).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tentar agrupar mesas | `POST /table-groups` | 404 (rota não existe mais) | N/A |
| Tentar desfazer grupo | `DELETE /table-groups/:id` | 404 | N/A |
| Tentar fechamento conjunto | `POST /orders/:id/close-group` | 404 | N/A |
| Fechar comanda normalmente | `POST /orders/:id/close` | Continua funcionando exatamente como antes | N/A |
| Releitura de log com eventos antigos de grupo | Instalação com `tables_grouped`/`table_group_dissolved` já gravados, `GET /state` | Projeta normalmente, sem erro (schema/projeção intactos); `tableGroups` some da UI mas segue existindo internamente | N/A |
| Mapa de mesas | Tela carrega | Sem seção "Junção de mesas", sem checkbox de seleção por mesa, sem indicador de grupo no `table-tile` | N/A |
| Comanda de mesa que já tinha grupo (dado antigo) | `order.tsx` carrega | Sem aviso "Agrupada com..." (removido) | N/A |
| Fechar comanda | `order-closing.tsx` | Sem checkbox de "fechar junto", sempre fecha individual via `closeOrder` | N/A |

</frozen-after-approval>

## Code Map

- `apps/desktop/sidecar/src/index.ts` -- remover as rotas `POST /table-groups` (~linha 879), `DELETE /table-groups/:id` (~linha 937) e `POST /orders/:id/close-group` (~linha 1167-1299, inclui todo o corpo até o `return;` antes do fallback 404 final). Remover também `distributeProportionally` (~linha 166, exclusivo de close-group). **Não tocar** `computeSubtotalCents`/`parseSplits` (compartilhados com `POST /orders/:id/close`).
- `apps/desktop/src/lib/tables.ts` -- remover `groupTables` e `dissolveTableGroup`; manter `TableGroup` type e `tableGroups` no retorno de `useTablesAndOrders` (o `/state` do sidecar continua devolvendo o campo — só não há mais UI que crie grupos; se `tableGroups` vier sempre vazio pra instalações novas, tudo bem).
- `apps/desktop/src/lib/closing.ts` -- remover `closeOrderGroup`.
- `apps/desktop/src/lib/order.ts` -- remover `fetchCombinedSubtotalCents` (só usada pelo fechamento conjunto).
- `apps/desktop/src/routes/table-map.tsx` -- remover a seção "Junção de mesas" (lista de grupos + botão "Desfazer" + botão "Agrupar mesas selecionadas"), a checkbox de seleção por mesa no `table-tile-header` (`toggleSelectedForGroup`, `selectedForGroup`, `groupError`, `handleGroupTables`, `handleDissolveGroup`), e o indicador de grupo em cada `table-tile` (`groupForTable`, o `<span className="status-badge status-badge-neutral">Junta com...`). Import de `groupTables`/`dissolveTableGroup` sai junto.
- `apps/desktop/src/routes/order.tsx` -- remover o aviso "Agrupada com..." e as variáveis `tableGroup`/`groupOrderIds` que o alimentam; `useTablesAndOrders` pode deixar de desestruturar `tableGroups` se não for mais usado ali. `<OrderClosing>` deixa de receber a prop `groupOrderIds`.
- `apps/desktop/src/order-closing.tsx` -- remover a prop `groupOrderIds`, o estado `joint`/`combinedSubtotalCents`, o `useEffect` que busca o subtotal combinado, o checkbox "Fechar as N mesas agrupadas juntas", e o ramo `closeOrderGroup` em `handleConfirm` (sempre chama `closeOrder`). Imports de `closeOrderGroup` e `fetchCombinedSubtotalCents` saem junto.
- `apps/desktop/sidecar/test/packaged-binary-smoke.mjs` -- remover o bloco "junção de mesas: rejeição de sobreposição + desfazer" (as rotas somem) e o helper `delJson` se não sobrar nenhum outro uso.
- **Não tocar:** `packages/shared-types/src/events.ts`, `packages/sync-engine/src/reconciliation.ts`, `packages/shared-types/test/events.test.ts`, `packages/sync-engine/test/other-events.test.ts` — continuam validando que o schema/projeção dos eventos antigos segue correto.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/sidecar/src/index.ts` -- remover rotas de table-groups/close-group + `distributeProportionally` -- causa raiz: nenhuma API deve mais criar/gerenciar grupos ou fechamento conjunto
- [x] `apps/desktop/src/lib/tables.ts` -- remover `groupTables`/`dissolveTableGroup` -- cliente não deve mais poder chamar rotas que não existem
- [x] `apps/desktop/src/lib/closing.ts` -- remover `closeOrderGroup` -- idem
- [x] `apps/desktop/src/lib/order.ts` -- remover `fetchCombinedSubtotalCents` -- só existia pro fechamento conjunto
- [x] `apps/desktop/src/routes/table-map.tsx` -- remover seção/checkbox/indicador de junção -- fecha o ciclo de UI
- [x] `apps/desktop/src/routes/order.tsx` -- remover aviso de agrupamento -- idem
- [x] `apps/desktop/src/order-closing.tsx` -- remover fechamento conjunto -- fechamento sempre individual
- [x] `apps/desktop/sidecar/test/packaged-binary-smoke.mjs` -- remover cenário de junção de mesas -- testa rotas que não existem mais

**Acceptance Criteria:**
- Given o sidecar rodando, when `POST /table-groups`, `DELETE /table-groups/:id` ou `POST /orders/:id/close-group` são chamados, then a resposta é 404
- Given o mapa de mesas carregado, when a tela renderiza, then não aparece nenhuma menção a "junção"/"agrupar"/"desfazer" nem checkbox de seleção de mesa
- Given uma comanda de mesa (com ou sem grupo antigo gravado), when a tela da comanda carrega, then não aparece nenhum aviso de agrupamento, e o fechamento é sempre individual
- Given uma instalação com eventos `tables_grouped`/`table_group_dissolved` já gravados (simular no teste), when `GET /state` é chamado, then a resposta é 200 sem erro (schema/projeção não quebraram)

## Implementation Notes

Removida a UI e a API de junção de mesas (rotas `POST /table-groups`, `DELETE /table-groups/:id`, `POST /orders/:id/close-group`, e `distributeProportionally` no sidecar; `groupTables`/`dissolveTableGroup` em `lib/tables.ts`; `closeOrderGroup` em `lib/closing.ts`; `fetchCombinedSubtotalCents` em `lib/order.ts`; a seção/checkbox/indicador de junção em `table-map.tsx`; o aviso "Agrupada com..." em `order.tsx`; o checkbox/estado de fechamento conjunto em `order-closing.tsx`; o cenário de smoke test correspondente e o helper `delJson` órfão). `TablesGroupedSchema`/`TableGroupDissolvedSchema`, o `case` em `reconciliation.ts` e o campo `tableGroups`/tipo `TableGroup` foram mantidos intocados, como exigido. Nenhum arquivo fora do Code Map foi tocado.

4ª acceptance criteria (releitura de `GET /state` com eventos antigos de grupo já gravados) já é coberta pelos testes existentes e não tocados `packages/shared-types/test/events.test.ts` e `packages/sync-engine/test/other-events.test.ts` (exercitam `tables_grouped`/`table_group_dissolved` contra o schema e a projeção) — confirmados verdes na Verification abaixo, sem necessidade de teste novo.

**Rodada de revisão (patch):** a revisão encontrou que a 4ª acceptance criteria pedia um teste "simulado" ponta-a-ponta que na verdade não existia (os testes de schema/reducer citados acima nunca chamam o `GET /state` real via HTTP), e que o smoke test antigo removido era a única cobertura real desse caminho — uma regressão de cobertura introduzida por esta mudança. Corrigido: `apps/desktop/sidecar/test/packaged-binary-smoke.mjs` agora grava um par `tables_grouped`/`table_group_dissolved` direto no SQLite do binário empacotado (simulando uma instalação antiga, já que a API que os criava não existe mais), reinicia o binário e chama `GET /state` real, confirmando 200. Também corrigidos, fora do Code Map original: `apps/desktop/src/app.css` (classes `.checkbox-label`/`.tap-area` órfãs removidas), `apps/desktop/src/lib/tables.ts` (comentário JSDoc não referencia mais "grupos visuais") e `EXPERIENCE.md` do UX design (duas menções à interação de agrupamento removidas). Um achado (caminho errado de `rowToEvent` no Intent congelado) foi rejeitado por exigir editar o próprio spec; outro (manter `tableGroups` no hook do frontend expõe o invariante de releitura) foi verificado como falso — o invariante vive só nos arquivos protegidos, intocados.

## Verification

**Commands:**
- `cd apps/desktop && npx tsc --noEmit` -- expected: sem erros (confirma que nenhum import/prop órfão sobrou)
- `cd apps/desktop/sidecar && npx tsc -p tsconfig.json --noEmit` -- expected: sem erros
- `npm run test --workspace packages/shared-types --workspace packages/sync-engine` -- expected: todos os testes existentes continuam passando (nenhum foi tocado)
- `cd apps/desktop/sidecar && npm run build && node test/packaged-binary-smoke.mjs <binário>` -- expected: passa de ponta a ponta sem o cenário de junção de mesas

**Manual checks (if no CLI):**
- Contra uma instância isolada do sidecar: confirmar que as 3 rotas removidas respondem 404, e que abrir/fechar uma comanda normal continua funcionando.

## Review Triage Log

- **[rejected — fix edits this spec]** Intent (linha 19) cita `rowToEvent` em `apps/desktop/sidecar/src/db.ts`; esse arquivo não existe — `rowToEvent` está em `packages/sync-engine/src/db.ts:45`. Verificado: caminho errado no texto congelado, mas não afeta o código entregue (nenhum arquivo de leitura de eventos foi tocado). Correção seria editar o próprio spec — rejeitado pela regra de triagem.
- **[false]** "AC1 (404 para as 3 rotas removidas) não tem teste automatizado" — verificado: verdadeiro que não há teste automatizado, mas a própria seção Verification do spec já define isso como checagem manual explícita ("Manual checks... confirmar que as 3 rotas removidas respondem 404"), que foi executada e confirmou 404 nas 3 rotas. Não é uma lacuna introduzida pela implementação; é o critério de verificação que o spec definiu.
- **[medium → patch, aplicado e reverificado]** AC4 (releitura de `GET /state` com eventos antigos `tables_grouped`/`table_group_dissolved` já gravados) exige teste "simulado", mas nenhum teste no repo chama o `GET /state` real (via HTTP, passando pelo `rowToEvent`/SQLite) depois de tais eventos existirem — o smoke test antigo (removido neste diff) *era* a única cobertura ponta-a-ponta desse caminho real. Corrigido: novo cenário em `packaged-binary-smoke.mjs` (para o sidecar, grava as duas linhas direto no SQLite bypassando a API removida, reinicia, chama `GET /state` real). **Reverificado por mim de forma independente** (não só confiando no relatório do subagente): rodei `node test/packaged-binary-smoke.mjs` contra o binário reconstruído — passa de ponta a ponta, incluindo esse cenário.
- **[low → patch, aplicado e reverificado]** Vestígios textuais da feature removida (classes `.checkbox-label`/`.tap-area` órfãs em `app.css`, comentário de `tables.ts`, linhas do `EXPERIENCE.md` citando "agrupar mesas"). **Correção:** verifiquei os três diretamente após o commit — `.checkbox-label`/`.tap-area` não existem mais em `app.css` nem em nenhum `.tsx`; o comentário de `useTablesAndOrders` já descreve "só pela compatibilidade de leitura"; `EXPERIENCE.md` não tem mais ocorrência de "agrupar"/"junção"/"grupo" (`git show --stat 00e3b53` confirma os três arquivos no commit). Achado real, corretamente corrigido pelo próprio subagente antes de eu checar — minha primeira leitura desta entrada tinha concluído erroneamente "achado desatualizado/falso"; corrigido aqui pra não deixar registro impreciso.
- **[false]** "Manter `tableGroups`/`TableGroup` no hook do frontend sem nenhum consumidor arrisca quebrar a garantia de releitura de eventos" — verificado: falso. A garantia de releitura (schema Zod + `reconciliation.ts`) vive inteiramente nos arquivos protegidos (`packages/shared-types/src/events.ts`, `packages/sync-engine/src/reconciliation.ts`), que já têm proteção explícita e separada no spec. Remover `tableGroups` do hook do frontend no futuro não teria nenhum efeito sobre esses arquivos protegidos nem sobre a releitura real do log — o dano alegado não se sustenta.

**Nota de processo:** esta revisão foi feita pelo próprio subagente de implementação (não pelas 3 camadas independentes padrão do step-04), então eu (coordenador) reverifiquei cada achado contra o código real antes de aceitar qualquer veredito — encontrei um achado desatualizado (acima) que o autoexame não tinha percebido.
