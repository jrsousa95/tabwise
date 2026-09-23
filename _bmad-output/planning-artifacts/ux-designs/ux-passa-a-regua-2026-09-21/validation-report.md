# Validation Report — passa-a-regua

- **DESIGN.md:** `_bmad-output/planning-artifacts/ux-designs/ux-passa-a-regua-2026-09-21/DESIGN.md`
- **EXPERIENCE.md:** `_bmad-output/planning-artifacts/ux-designs/ux-passa-a-regua-2026-09-21/EXPERIENCE.md`
- **Run at:** 2026-09-23T19:14:17Z

## Overall verdict

O par de spines não está pronto pra carregar `status: final`: a forma é sólida (ordem canônica, sem inchaço, sem token quebrado), mas o conteúdo ficou pra trás do produto real em dois pontos críticos — a tela "Conflitos de Mesas" (ARCH §4.2, já em produção) não existe em nenhuma das duas spines, e o `DESIGN.md` se contradiz sobre a própria cor de marca (ainda chama de "laranja-queimado" oito linhas antes de documentar a troca pra borgonha).

A auditoria visual sobre o código real do app achou algo mais grave que desalinhamento: um **bug de fluxo real** em `order-closing.tsx` — com uma única parte de split editada manualmente, o indicador de falta/sobra fica escondido e o botão "Confirmar fechamento" trava sem nenhuma explicação, na tela de maior pressão de tempo do app (fila no caixa). A auditoria de acessibilidade confirmou que o achado já conhecido do mapa de mesas (grid de `<div>`s sem semântica pra leitor de tela) segue sem solução, e achou que nenhuma tela autenticada tem `<h1>` nem os 23 usos de `.form-error` são anunciados a leitor de tela.

## Category verdicts

- Flow coverage — raso
- Token completeness — forte
- Component coverage — raso
- State coverage — raso
- Visual reference coverage — forte
- Bloat & overspecification — forte
- Inheritance discipline — raso
- Shape fit — forte

## Findings by severity

### Critical (4)

**[Rubric — Flow coverage]** Conflitos de Mesas sem nenhuma cobertura nas spines (`EXPERIENCE.md`)
Nenhum Key Flow, Component Pattern ou linha de IA cobre a tela já em produção (`table-conflicts.tsx`, linkada em `layout.tsx:51-55,106`).
Fix: adicionar linha na IA + um Key Flow (ou expansão do Fluxo 3) com o dono revisando/resolvendo um conflito.

**[Rubric — Inheritance discipline]** DESIGN.md se contradiz sobre a cor de marca
Brand & Style (linha ~155) ainda diz "Laranja-queimado", a seção Colors, 8 linhas depois, documenta a troca pra borgonha (2026-09-22) — a frase mais provável de ser lida isolada está errada.
Fix: trocar "Laranja-queimado" por "Borgonha" na linha 155 do DESIGN.md.

**[Auditoria Visual]** Fechamento de comanda trava sem explicação com split de 1 parte editada manualmente (`order-closing.tsx:102,218,228-230`)
O indicador `.split-diff` só renderiza com `splits.length > 1`; a parte única é editável e não resincroniza automaticamente. Se o caixa digitar um valor diferente do total, `canConfirm` vira `false` e "Confirmar fechamento" desabilita sem nenhuma mensagem — na tela de maior fila do app.
Fix: trocar a condição de `splits.length > 1` pra `splits.length > 0` em `order-closing.tsx:218`.

**[Acessibilidade]** Mapa de mesas sem semântica de lista/tabela pra leitor de tela (`table-map.tsx:190,194`)
Achado conhecido (`deferred-work.md`), confirmado ainda presente — grid inteiro de `<div>`, nenhum `role`/elemento semântico substitui a tabela perdida. É a tela de maior tráfego do app.
Fix (piso mínimo): `role="list"` no grid + `role="listitem"` em cada tile + `aria-label` associando "Mesas (N)" à coleção.

### High (9)

**[Rubric — Flow coverage]** Histórias 2.8/3.4/3.5 (renomear/remover mesa/categoria/produto) sem representação nas spines
Já implementadas com padrão de UI repetido e regras de bloqueio (409), mas ausentes de Key Flow/Component/State Pattern.
Fix: Component Pattern pro padrão de ícones editar/remover + State Patterns pros dois erros 409.

**[Rubric — Component coverage]** `inline-form` sem spec visual no DESIGN.md
Tem linha comportamental em EXPERIENCE.md mas nenhuma entrada correspondente em DESIGN.md.Components.
Fix: adicionar `inline-form` ao frontmatter `components` e à seção Components.

**[Rubric — Component coverage]** Padrão de ícones editar/remover (PencilIcon/TrashIcon) sem spec em nenhuma spine
Usado identicamente em `table-map.tsx` e `catalog.tsx`, sem nome, token ou linha de tabela em nenhum dos dois documentos.
Fix: nomear o componente (ex: `row-action-icon`), dar spec visual (DESIGN.md) e comportamental (EXPERIENCE.md), incluindo o hitbox mínimo de 48px — que hoje falha nessas linhas.

**[Rubric — State coverage]** Erros 409 de 2.8/3.4/3.5 sem State Pattern documentado
"Mesa com comanda aberta não pode ser removida" e "categoria com produto vinculado não pode ser removida" já implementados, ausentes da tabela.
Fix: duas linhas novas em State Patterns.

**[Auditoria Visual]** Linha de conflito não resolvido sem proteção de quebra (`table-conflicts.tsx:47-59`)
Dois controles de texto completo (`.button-secondary` + `.button-primary`) na mesma linha, sem `flex-wrap`, único lugar do app que faz isso — risco concreto na faixa 768-1023px (tablet).
Fix: `flex-wrap: wrap` em `.catalog-list-actions`, ou encurtar os rótulos.

**[Auditoria Visual]** Lista de conflitos é histórico permanente sem paginação/priorização (`table-conflicts.tsx:25`)
Ordena só por `createdAt` — quebra a premissa de "sem paginação" do resto do app, que só vale pra listas de tamanho estável (mesas/produtos), não pra um log que cresce pra sempre.
Fix: não-resolvidos primeiro (ou seção "Pendentes"/"Resolvidos"); considerar filtro/paginação antes do histórico crescer.

**[Auditoria Visual]** Navegação do dono chegou a 6 itens — teto que EXPERIENCE.md já sinalizava como risco (`layout.tsx:33-60`)
`EXPERIENCE.md:101` já pedia "avaliar colapsar em menu" com 5-6 itens; a rota nova (Conflitos de Mesas) é quem cruzou esse limite de fato.
Fix: o menu compacto que já era "avaliar" virou "fazer" — priorizar na próxima rodada de implementação.

**[Acessibilidade]** Nenhuma tela autenticada tem `<h1>`
Toda rota usa `<h2>` como título; o wordmark do header é `<span>`, sem papel de heading. Navegação por heading (técnica primária de leitor de tela) não encontra nada em nível 1.
Fix: promover o `<h2>` de cada rota pra `<h1>`, rebaixar subseções (`<h3>`→`<h4>`).

**[Acessibilidade]** 23 mensagens `.form-error` nunca anunciadas nem associadas ao campo
Zero ocorrências de `role="alert"`/`aria-live`/`aria-describedby` em todo o app — o texto nomeia a regra certa, mas não chega garantidamente ao leitor de tela.
Fix: `role="alert"` em `.form-error`; `aria-describedby` no input correspondente quando aplicável.

### Medium (10)

**[Rubric — Flow coverage]** Épicos 1/6/8 só como State Pattern, nunca como Key Flow com protagonista/clímax — inconsistente com o tratamento dado a 2/4/5/7. O limite de comandas (gatilho de conversão do freemium) merece um Key Flow próprio.

**[Rubric — Token completeness]** Nenhuma combinação de cor declara meta de contraste numérica (só a afirmação categórica "AA mantido") — importa porque o par borgonha claro→escuro não é derivação automática.

**[Rubric — Component coverage]** `catalog-table` citada duas vezes só como exemplo de superfície que **não** cumpre o piso de toque — nunca promovida a uma entrada de Component com a spec corrigida.

**[Rubric — State coverage]** Sem estado vazio documentado pra Conflitos de Mesas nem primeiro uso de Cardápio/Caixa.

**[Rubric — State coverage]** "Permissão negada" sem tratamento documentado, apesar de guards reais (`RequireRole`) já bloquearem navegação a `/catalog`/`/table-conflicts`.

**[Auditoria Visual]** `.type-label` (rótulo 13px) usado em texto corrido de 4 telas (`table-conflicts.tsx`, `cash-register.tsx`, `order-closing.tsx`) — prejudica leitura rápida de parágrafo explicativo.

**[Auditoria Visual]** "Voltar" vs "Cancelar" pro mesmo botão de desistir, dentro do mesmo arquivo (`order.tsx:270,301`) — `Cancelar` é a convenção em 5 de 6 ocorrências no app inteiro.

**[Acessibilidade]** Campos de valor/forma de pagamento do split de fechamento sem `label`/`aria-label` (`order-closing.tsx:182-201`) — só `placeholder`, que some ao digitar.

**[Acessibilidade]** `.catalog-empty`/`.catalog-row-inactive` (opacity 0.6) caem a ~4.45:1 no modo claro, abaixo do piso AA de 4.5:1.

**[Acessibilidade]** Banner de merge automático sem `role="status"` (`layout.tsx:86`) — inconsistente com o mesmo padrão já usado em `pairing.tsx`.

### Low (7)

**[Rubric — Flow coverage]** Protagonista do Fluxo 3 sem nome ("Dono"), diferente dos Fluxos 1/2 (Jonas, Marina).

**[Rubric — Visual reference coverage]** EXPERIENCE.md referencia uma seção "Mock coverage" que não existe em nenhum dos dois documentos — cross-ref interna quebrada.

**[Rubric — State coverage]** Nenhum estado de foco (teclado) documentado, apesar do Accessibility Floor citar a ordem de tabulação como relevante.

**[Auditoria Visual]** Erro de "marcar como resolvido" aparece antes da lista, não depois — diferente do padrão do resto do app (`table-conflicts.tsx:38`).

**[Auditoria Visual]** Divisor `.summary-row-total` aplicado a um resumo de uma única linha em `order.tsx:250-255`, sem nada acima pra separar.

**[Acessibilidade]** Tecla "⌫" do PIN sem `aria-label` — nome acessível depende só do glifo Unicode.

**[Acessibilidade]** Detalhe técnico do status do sidecar só existe no `title` (hover de mouse), sem equivalente por teclado/leitor de tela.

## Mechanical notes

- IA do EXPERIENCE.md lista 7 superfícies; o app real tem 9 rotas — faltam "Conflitos de Mesas" e "Configurações".
- Datas de `updated` dessincronizadas entre DESIGN.md (2026-09-22) e EXPERIENCE.md (2026-09-21) — anterior às mudanças de escopo que deveriam tê-las disparado.
- `status: final` em ambos os arquivos é otimista dado o volume de achados critical/high.
- Migração de cor laranja→borgonha confirmada limpa em todo o app.css (nenhum hex hardcoded fora de `:root`, contraste OK nos dois modos como *uso de marca* — a falha de contraste achada é em `.catalog-empty`/`.catalog-row-inactive`, não na cor de marca).
- Todos os 11 achados da Rodada 3 da auditoria visual (2026-09-22) foram confirmados corrigidos no código atual.

## Reviewer files

- `review-rubric.md`
- `review-visual-audit-round4.md`
- `review-accessibility.md`
