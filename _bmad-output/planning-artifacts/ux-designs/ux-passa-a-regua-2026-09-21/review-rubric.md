# Spine Pair Review — Passa a Régua

## Overall verdict

Mechanically the pair is clean: both frontmatters resolve, sources exist, section order is canonical in both files, `{token}` references all resolve by name, and the "no mocks this round" disclosure is explicit with spines-wins-on-conflict stated once. As a *build contract*, though, it is incomplete. Three of the app's seven IA surfaces (Cadastro de operador, Cardápio, Caixa/Resumo) carry no Key Flow and no State Pattern — a consumer has only a one-line IA purpose to build from. Three PRD stories added the day after the spine was marked `final` (2.8, 3.4, 3.5 — rename/remove with explicit blocking rules) and Epic 1.3 (audit-trail visibility) have zero representation anywhere in EXPERIENCE.md. DESIGN.md's dark-mode palette is missing three container-token pairs that `status-badge` and `merge-warning-banner` depend on. None of this is unfixable, but a consumer extracting today would have to invent UI for roughly a third of the product's surface.

## 1. Flow coverage — thin

Checked: EXPERIENCE.md's `sources` (project-brief.md, prd.md, architecture.md) against PRD's 8 épicos/histórias (PRD has no separate named-UJ list — histórias are the closest analog) and the 3 Key Flows in EXPERIENCE.md §Key Flows (lines 113–142).

### Findings
- **critical** Épico 1 (Autenticação e Operadores) has no Key Flow. Its central deliverable — 1.3, "ver quem cancelou um item, quando e por quê" (audit-trail visibility for the dono) — appears in *no* IA surface, Component Pattern, State Pattern, or Flow anywhere in EXPERIENCE.md. Canceling an item is covered (IA table row 28, Interaction Primitives line 81); *viewing* the resulting audit log is not. (EXPERIENCE.md, absent throughout). *Fix:* add an IA surface (or a section of an existing one) for the audit log, plus a Key Flow or State Pattern entry for the dono reviewing it.
- **high** Épico 3 (Cardápio), Épico 6 (Resumo de Caixa/Caixa), and "Cadastro de operador" (Épico 1.1) each have an IA row (EXPERIENCE.md lines 26, 29, 30) but no Key Flow — the dono's three primary management journeys (build the menu, register staff, check the day's totals) are entirely unrepresented in Key Flows. All 3 flows that exist are garçom/caixa/pairing-focused. *Fix:* add at least one dono-anchored flow covering cardápio setup or resumo review, even briefly.
- **high** Épico 8 (2.7, comanda-limit-reached) has a State Pattern row (line 72) but no Key Flow with a climax — the freemium upgrade trigger is the product's stated conversion moment (project-brief.md §5) yet is never dramatized as a flow, only described as a state. *Fix:* fold it into an existing flow's failure path or add a short flow.
- **medium** New stories 2.8, 3.4, 3.5 (PRD, added 2026-09-22 — rename/remove mesa, categoria, produto, each with explicit blocking rules) postdate EXPERIENCE.md's `updated: 2026-09-21`. They have no Key Flow, State Pattern, or IA mention at all (grep for "renomear/remover/editar/excluir" in EXPERIENCE.md returns zero hits). *Fix:* re-sync the spine against the current PRD before treating it as a build contract; this is a currency gap, not an authoring error.
- **low** Flow 3's protagonist is "Dono" (unnamed) while Flow 1 and Flow 2 name their protagonists (Jonas, Marina) — the spine's own memlog even records "dono sem nome dado" as a known gap. (EXPERIENCE.md line 135; `.memlog.md` last bullet). *Fix:* name the dono persona for consistency, or note the omission is intentional.

## 2. Token completeness — thin

Checked: every color/typography/rounded/spacing token in DESIGN.md's YAML frontmatter (lines 6–144) against every `{path.to.token}` reference in both files' prose (verified via grep — all `{colors.*}`, `{typography.*}`, `{spacing.*}`, `{rounded.*}` references resolve to a defined key).

### Findings
- **critical** `success-container`, `warning-container`, and `danger-container` have light-mode hex values (DESIGN.md lines 22, 25, 28) but **no `-dark` pairs** (compare the dark block, lines 30–47, which pairs every other light token). These three tokens back `status-badge-success/warning/danger` and `merge-warning-banner` (lines 132–144) — components that appear on every screen (sidecar status, product active/inactive, comanda pending, the global merge banner). In dark mode, downstream code has no defined value to mirror. *Fix:* add `success-container-dark`, `warning-container-dark`, `danger-container-dark`.
- **low** `spacing.2`, `spacing.6`, `spacing.7` are defined (lines 87, 91, 92) but never referenced by `{path}` anywhere in either file. Not a contract break (unused tokens are harmless), but worth pruning or using if intentional (e.g., `spacing.6`/`7` look sized for section gaps that never got called out). *Fix:* either reference them in Layout & Spacing prose or drop them.
- **adequate** Contrast is stated only qualitatively ("AA", "não é uma versão escurecida") rather than with explicit ratios — but this matches the rigor level of all three reference examples (none state numeric ratios either), so not flagged as a gap on its own.

## 3. Component coverage — thin

Checked: every backtick-quoted component identifier in both files (`button-primary`, `button-secondary`, `pin-key`, `pin-pad`, `table-tile`/`table-tile-free`/`table-tile-occupied`, `status-badge`, `merge-warning-banner`, `catalog-table`, `inline-form`) against DESIGN.md §Components (lines 192–199) and EXPERIENCE.md §Component Patterns (lines 51–62).

### Findings
- **high** `inline-form` has a full behavioral row in EXPERIENCE.md (line 61: field+button inline, stacks on narrow viewports, error placement) but **no row in DESIGN.md.Components** — no visual spec (padding, error-text color/token, field/button proportions) exists anywhere. Used on 2 surfaces (Cardápio, Pareamento). *Fix:* add an `inline-form` row to DESIGN.md.Components.
- **medium** `button-primary` and `button-secondary` have full visual specs in DESIGN.md (frontmatter lines 96–108, prose lines 194–195) but **no row in EXPERIENCE.md.Component Patterns** — the most reused component in the product (appears on every screen, per DESIGN.md line 194) has zero behavioral rules (tap/disabled state, double-submit handling — relevant given Flow 2's "toca 'Confirmar fechamento' uma única vez", line 131). *Fix:* add a Component Patterns row for buttons.
- **medium** `table-tile` is described in EXPERIENCE.md as "mínimo 96×96px" (line 57) but DESIGN.md's frontmatter definition only sets `minHeight: '96px'` (line 119) — no `minWidth` is specified at all. EXPERIENCE.md asserts a dimension DESIGN.md never commits to. *Fix:* add `minWidth: '96px'` to the `table-tile` token, or soften the EXPERIENCE.md claim.
- **low** `catalog-table` and `pin-pad` are referenced identically in both files (DESIGN.md line 180 / EXPERIENCE.md line 90 for `catalog-table`) but neither ever receives a dedicated Components/Component-Patterns row — they're flagged inline as pre-existing elements needing a touch-target fix, not spec'd as components. Also note `pin-pad` (the container) vs. `pin-key` (the individual key) are never explicitly related — a downstream reader may not realize they're two names for related-but-different things. *Fix:* either give `catalog-table`/`pin-pad` their own rows or state explicitly they're retrofit-only, not new components.

## 4. State coverage — thin

Checked: all 7 IA surfaces (EXPERIENCE.md lines 23–31) against the 6 rows in §State Patterns (lines 64–73).

### Findings
- **critical** Cadastro de operador, Cardápio, and Caixa (3 of 7 IA surfaces) have **zero rows** in State Patterns — no empty/cold-load/error/validation state is specified for registering an operator (including the PIN-must-be-unique-per-establishment rule, PRD 1.1), building the menu, or viewing the day's summary (including the "no comandas fechadas yet" empty case implied by PRD 6.1). *Fix:* add at least an empty/error state per surface.
- **high** Comanda (detalhe) has no State Pattern row at all despite being one of the two most-used surfaces. Missing states include: comanda closed/immutable after fechamento (PRD 5.5 — "para de aceitar novos itens"), split-sum-mismatch (PRD 5.2 — already has a Key Flow mention, line 129, but no formal State row), and empty comanda (no items yet). *Fix:* add a State Patterns row for Comanda.
- **high** The blocking-validation states introduced by stories 2.8/3.4/3.5 (mesa-with-open-comanda cannot be removed; categoria-with-linked-product cannot be removed) have no State Pattern anywhere — consistent with the Flow-coverage finding above (§1), this is a currency gap against the current PRD. *Fix:* same remediation as §1's currency finding.

## 5. Visual reference coverage — strong

Checked: `mockups/`, `wireframes/`, `imports/` under the workspace directory. `imports/` exists and is empty; no `mockups/`/`wireframes/` folders exist; a `.working/` folder also exists and is empty.

### Findings
None. EXPERIENCE.md's IA section (line 35) explicitly discloses "nenhum mock ainda nesta rodada" and states spine-wins-on-conflict exactly once, matching the empty folders on disk. `.memlog.md`'s closing entry ("Sem mocks/wireframes nesta rodada... nenhum artefato .working/imports pra promover") confirms this was a deliberate, disclosed scope choice, not an oversight. No orphaned files, no unspecific references — there is nothing to fail here.

## Mechanical notes

- **Naming**: persona "Dono/Gerente" (PRD §2) is shortened to "Dono" throughout EXPERIENCE.md (IA table, Key Flow 3) — harmless but not verbatim; worth a one-line normalization note if strict verbatim inheritance matters downstream.
- **Cross-refs**: `ARCH §3` (EXPERIENCE.md Foundation, line 17) and `ARCH §4.2` (Component Patterns, line 60) both resolve correctly against `docs/architecture.md`'s actual section numbering (§3 Modelo de dados, §4.2 Caso de conflito real). No broken references found.
- **Frontmatter**: both files' frontmatter parse cleanly; EXPERIENCE.md's `sources` list (docs/project-brief.md, docs/prd.md, docs/architecture.md) all resolve to existing files. No `sources` field in DESIGN.md, consistent with both reference examples (design-example-mobile.md, design-example-shadcn.md), which also omit it.
- **Currency**: `docs/prd.md` was last modified 2026-09-22 00:27 — after both spine files' `updated: 2026-09-21` and their `status: final`. The PRD diff in that window (stories 2.8/3.4/3.5 added, Épico 6 renamed "Fechamento de Caixa" → "Resumo de Caixa") is the root cause of most of the §1/§4 findings above. EXPERIENCE.md's IA table already happens to say "Caixa" (not the old name), so the épico rename didn't break anything, but the three new stories are a genuine, dated gap.
- **Mermaid**: no diagrams in either file — nothing to check.
- **Section order**: DESIGN.md — Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts — exact canonical order. EXPERIENCE.md — Foundation → IA → Voice and Tone → Component Patterns → State Patterns → Interaction Primitives → Accessibility Floor → Responsive & Platform → Inspiration & Anti-patterns → Key Flows — matches the `design-example-shadcn`/`experience-example-shadcn` (Drift) pattern exactly, including Responsive & Platform's justified inclusion (multi-surface: desktop + tablet) and Key Flows placed last per the memlog's own review-driven reorder.
