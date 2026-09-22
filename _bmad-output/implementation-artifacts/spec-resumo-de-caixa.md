---
title: 'Renomear "Fechamento de Caixa" para "Resumo de Caixa"'
type: 'chore'
created: '2026-09-22'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
baseline_commit: '6dda1f9e9f3f7bfc97d1f19c96fde40ca6c407af'
context:
  - '{project-root}/docs/prd.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** a tela de resumo do caixa (`apps/desktop/src/routes/cash-register.tsx`) se chama "Fechamento de Caixa", nome que sugere uma ação/evento discreto de fechar o caixa num instante — mas a tela sempre foi um relatório somativo ao vivo, recalculado a cada consulta, sem nenhuma ação de fechamento. Achado em uso real (2026-09-22), já documentado na emenda do Épico 6 (`docs/prd.md`, commit `6dda1f9`).

**Approach:** trocar o `<h2>` da tela de "Fechamento de Caixa — {data}" para "Resumo de Caixa — {data}", e adicionar uma legenda curta logo abaixo deixando claro que o resumo é ao vivo e não representa uma ação de fechamento. Mudança só de texto/rótulo — sem tocar `order-closing.tsx` ("Fechar comanda", que é uma ação de verdade e já está claro) nem `layout.tsx` (o nav já diz só "Caixa", sem a palavra "Fechamento").

</frozen-after-approval>

## Implementation Notes

- `apps/desktop/src/routes/cash-register.tsx`: `<h2>` trocado de "Fechamento de Caixa — {data}" pra "Resumo de Caixa — {data}"; adicionada uma legenda (`<p>`, sem classe nova) logo abaixo: "Resumo ao vivo, recalculado a cada consulta — não é uma ação de fechar o caixa."
- Confirmado por grep: nenhuma outra referência a "Fechamento de Caixa" restou em `apps/desktop/`. `order-closing.tsx` e `layout.tsx` não foram tocados, como previsto.
- `npx tsc --noEmit` (apps/desktop) limpo.

## Review Triage Log

`blind-hunter` rodou sobre o diff. Achados verificados:

- **low — patch** — a legenda nova usava `<p>` sem classe, enquanto o resto da tela usa `.type-label` pra texto secundário (`Comandas fechadas:`, linha 30). Corrigido: `className="type-label"` aplicado.
- **low — patch** — o JSDoc acima do componente não mencionava a renomeação/motivo, ficando fora de sincronia com a emenda do PRD. Corrigido: comentário atualizado citando a emenda 2026-09-22.
- **low — rejeitado (redação)** — legenda fraseada só como negação ("não é uma ação de..."), sem afirmar primeiro o que de fato acontece. Aproveitado junto com o patch acima (trivial, mesma linha): reescrita pra liderar com o fato positivo ("Atualiza a cada consulta, em tempo real — ...").
- **low — falso** — possível confusão entre a legenda ("não é uma ação de fechar o caixa") e o rótulo "Comandas fechadas" logo abaixo. Verificado: são referentes diferentes (caixa vs. comanda) e a distinção é justamente o ponto que a legenda reforça, não borra — não introduz ambiguidade nova.
- **defer** — nenhum teste (unit/RTL/e2e) verifica o texto do título/legenda desta tela. Real, mas o frontend não tem infraestrutura de teste de componente nenhuma no repo hoje (achado pré-existente, já registrado em `deferred-work.md` na spec do sistema de design visual) — não é algo causado por esta mudança pontual de rótulo.

