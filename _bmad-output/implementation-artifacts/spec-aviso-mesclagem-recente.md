---
title: 'Aviso de mesclagem de comanda só mostra ocorrências recentes'
type: 'bugfix'
created: '2026-09-22'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
baseline_commit: '021d5a6c95e39bfbee56644cd49aa840f636f51c'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `mergeWarnings` (ARCH §4.2) é recalculado a partir do histórico inteiro de eventos, sem timestamp e sem forma de dispensar — uma vez que uma mesclagem automática acontece (duas orders abertas pra mesma mesa por dois terminais), o aviso "N comandas foram mescladas automaticamente" aparece pra sempre, em toda tela, mesmo que tenha ocorrido dias atrás. Achado em uso real (2026-09-22): o dono via o aviso sem ter feito nada recentemente, sem saber que era uma cicatriz permanente de um evento passado.

**Approach:** registrar quando cada mesclagem aconteceu (`createdAt` do evento `order_opened` perdedor, já disponível no ponto onde o aviso é gerado) e, na UI, só exibir mesclagens das últimas 24h. O histórico completo continua existindo em `ProjectedState.mergeWarnings` (nada é apagado do estado/log) — o filtro é só de apresentação.

</frozen-after-approval>

## Implementation Notes

- `packages/sync-engine/src/reconciliation.ts`: `MergeWarning` ganhou `createdAt` (do `order_opened` perdedor); `mergeWarnings.push` atualizado. Campo mantido como dado (útil pra eventualmente mostrar "aconteceu em..." nos detalhes), mas **não é mais a base da decisão de mostrar/esconder** — ver correção abaixo.
- `packages/sync-engine/test/arch-4.2-table-conflict.test.ts`: assert exato de `mergeWarnings` atualizado com o novo campo (`createdAt: 2000`).
- **Correção pós-revisão (`blind-hunter`):** a primeira versão filtrava por `createdAt` do evento (quando a comanda perdedora foi *aberta*). Isso contradiz o ARCH §4.2, que documenta que o aviso deve aparecer "assim que o terminal que 'perdeu' a comanda sincroniza e recebe o merge" — ou seja, a base é quando o terminal **descobre** o merge, não quando a comanda foi originalmente aberta. Num cenário real (host cai, reconecta dias depois), a comanda perdedora pode ter sido aberta há mais de 24h antes do merge sequer ser sincronizado — a versão original **esconderia o aviso desde o primeiro instante em que ele deveria aparecer**, o oposto do bug que a spec pretendia corrigir. Reescrito: `apps/desktop/src/lib/merge-warnings.ts` agora guarda em `localStorage` (por `losingOrder`, inerentemente por-terminal) o momento em que ESTE terminal viu cada merge pela primeira vez, e filtra pelas últimas 24h a partir desse "primeiro visto" — não do `createdAt` do evento. `localStorage` indisponível degrada pra sempre mostrar (nunca quebra).
- O `/state` do sidecar continua devolvendo o histórico completo de `mergeWarnings` (nada é descartado no servidor/projeção) — o filtro é inteiramente client-side.
- Rastreei manualmente os 4 cenários (primeira descoberta de um merge antigo já sincronizado — o caso que a v1 quebrava —, repolling do mesmo merge, expiração após 24h do "primeiro visto", e dois terminais diferentes descobrindo o mesmo merge em momentos diferentes) — todos consistentes com o comportamento documentado. Não adicionei infraestrutura de teste nova pra isso (nenhum framework de teste existe em `apps/desktop`, mesma lacuna pré-existente já registrada em `deferred-work.md` nesta sessão — instalar um framework é decisão de repo inteiro, fora do escopo desta correção pontual).
- **Gap real, mas fora de escopo (registrado em `deferred-work.md`):** o ARCH §4.2 também promete que "o registro de auditoria completo continua existindo e visível ao dono" além da notificação transitória — mas nunca existiu uma tela separada de auditoria de merges; o banner sempre foi o único lugar que renderiza `mergeWarnings`. Isso já era verdade antes desta spec (a v1 "resolvia" isso incidentalmente ao nunca esconder nada — só que confuso, foi o motivo da reclamação). Construir uma tela de auditoria dedicada é escopo novo de UI, não parte do bug relatado.

## Review Triage Log

`blind-hunter` rodou sobre o diff. Achados verificados:

- **high — bad_spec, corrigido (re-derivado)** — filtro ancorado no `createdAt` do evento (hora de abertura da comanda perdedora) em vez da hora de sincronização/descoberta pelo terminal — contradiz ARCH §4.2 ("assim que o terminal que perdeu a comanda sincroniza e recebe o merge, ele exibe...") e criava um falso-negativo (merge sincronizado tarde nunca aparece). Verificado contra `docs/architecture.md` §4.2 diretamente. Causa raiz era a própria abordagem aprovada (usar um timestamp já existente no evento) — reescrita pra rastrear "primeiro visto por este terminal" via `localStorage`, ver Implementation Notes.
- **medium — deferido** — ARCH §4.2 promete um "registro de auditoria completo... visível ao dono" além da notificação transitória, mas nunca existiu tela separada pra isso — só o banner (`blind-hunter`, verificado: único consumidor de `mergeWarnings` no frontend é `layout.tsx`). Gap pré-existente, não introduzido por esta spec; construir uma tela de auditoria é escopo de UI novo. Registrado em `deferred-work.md`.
- **low — false** — `createdAt` usado pra decisão viola o princípio documentado em `common.ts` ("wall-clock só pra exibição, nunca pra ordenação/conflito") — refutado pela própria correção acima: `createdAt` não é mais usado pra decidir visibilidade (só fica como dado); a decisão agora usa o relógio local de cada terminal pro seu próprio "primeiro visto", que é exatamente o uso pretendido de `Date.now()` no cliente (mesmo padrão já usado em toda a UI, ex: `serviceFeeSaved`).
- **low — rejeitado** — a spec original citava "sem forma de dispensar" como parte do problema, e a correção não adiciona um botão explícito de dispensar, só o desaparecimento automático após 24h do "primeiro visto" (`blind-hunter`). A proposta aprovada pelo usuário foi explicitamente "só mostrar os recentes (últimas 24h)", não um botão de dispensar — o desaparecimento automático corrigido (agora ancorado certo) já resolve a reclamação real ("aviso aparece sem eu ter feito nada agora"). Fora do que foi pedido/aprovado; rejeitado.
- **low — rejeitado** — nenhum teste automatizado cobre a lógica de filtro em si (`blind-hunter`). Real, mas `apps/desktop` não tem nenhuma infraestrutura de teste (nem vitest, nem RTL) — mesma lacuna pré-existente já registrada nesta sessão (`deferred-work.md`, spec do sistema de design visual). Instalar um framework de teste é decisão de repo inteiro, não desta correção pontual. Validado por rastreamento manual dos 4 cenários (ver Implementation Notes).
- **low — rejeitado** — `RECENT_WINDOW_MS = 24h` é uma regra de negócio nova, hardcoded, sem citação no PRD/ARCH nem forma de configurar (`blind-hunter`). O valor foi explicitamente proposto por mim e aprovado pelo usuário ("só mostrar os recentes, ex: últimas 24h") antes da implementação — não é uma lacuna, é a decisão de escopo já tomada. Tornar configurável não foi pedido; adicionaria UI/settings não solicitados.
