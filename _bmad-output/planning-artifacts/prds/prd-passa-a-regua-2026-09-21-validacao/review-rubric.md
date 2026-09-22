# PRD Quality Review — Passa a Régua

## Overall verdict

This PRD is unusually well-executed where it matters most for a build-ready doc: trade-offs are named honestly with what was given up (§1.2's accepted session-expiry risk, §2.6's rejection of comanda-merging), and acceptance criteria are concrete and testable almost everywhere (exact-sum split logic in §5.2, deterministic rounding, append-only audit semantics). Its two real weaknesses are structural, not cosmetic: there is no Success Metrics section anywhere, so the competitive thesis stated in §1 (freemium multi-terminal gancho vs. SAIPOS/Consumer/Goomer) has no way to be judged as having worked; and there is no Glossary, which matters more than usual because this is a chain-top PRD that already fed an Architecture doc and a 12-milestone implementation (`docs/implementation-plan.md`, all closed 2026-09-21). A third issue is currency, not content: §7 "Próximos passos" tells the reader the next step is to start Épico 1, while the implementation plan shows all 8 épicos and the architecture are already built and shipped.

## Decision-readiness — strong

Real trade-offs are stated as decisions, with the cost named, not smoothed over. §1.2 names a specific accepted security risk ("Risco de segurança conhecido, aceito para o MVP: a sessão do terminal não expirar automaticamente significa que qualquer pessoa no terminal logado poderia agir 'como' o operador logado") and explains the mitigation is traceability, not access control — exactly the kind of tension the rubric wants surfaced rather than dodged. §2.6 makes an explicit scope call ("Decisão de escopo: mesclar itens de duas comandas em uma única entidade... fica fora do MVP") with the reasoning (it would rewrite history/audit log of two comandas into one). §2.7 similarly states and justifies the downgrade behavior. §6 is a genuine decision log — each item is struck through with how and why it was resolved (e.g., the split-tolerance question resolved to "soma exata, sem tolerância"), which is a more honest pattern than most PRDs manage.

### Findings
- **high** Stale "next steps" section (§7 "Próximos passos") — §7 says the next handoff is "implementação..., começando pelo pacote `sync-engine` e pelo Épico 1," but `docs/implementation-plan.md` shows M0–M12 all closed as of 2026-09-21, meaning every épico in this PRD (1 through 8) and the full architecture are already implemented and validated (including Windows packaging in M12). A reader using this PRD as the current source of truth would believe development hasn't started. *Fix:* update §7 to reflect actual status, or replace it with a pointer to `implementation-plan.md` as the living status document.
- **medium** Post-closure correction gap has no risk framing — §5.5 and §5 (Fora do escopo) state that cancellation/refund after a comanda closes is out of MVP scope ("assume-se que fechamento é definitivo"), but unlike §1.2's explicit risk-and-mitigation framing, there's no discussion of what a caixa/dono actually does in the real world when a mistake is discovered after close. *Fix:* add a short accepted-risk note in the same style as §1.2 (what operators will actually do, e.g. an off-system correction, and when this gets revisited).

## Substance over theater — strong

No findings needed. The three personas (§2) aren't decorative — the permission table is operationalized directly in acceptance criteria throughout (e.g. §4.3 "caixa (ou operador autorizado)", the implementation plan's M6 note "só caixa/dono (garçom recebe 403)"). The differentiation claim in §1 is specific and falsifiable (no nota fiscal, named competitors, multi-terminal as the paywall), not generic innovation language. The NFR table (§4) is fully free of boilerplate — every NFR is a specific, testable condition ("100% funcional sem conexão," "armazenados... em centavos (inteiro), nunca em ponto flutuante") rather than "must be scalable/secure/reliable."

## Strategic coherence — thin

The thesis is real (undercut incumbents by dropping nota fiscal, monetize via multi-terminal), and épico ordering follows that logic rather than "easiest first." But the PRD has **no Success Metrics section at all** — no metric ties back to the thesis (e.g., upgrade conversion rate, % of orders completed offline, comanda-close time), and no counter-metrics are named. This is a hard gap, not a stylistic one: without SMs, nobody can tell from this document whether the freemium bet paid off.

There's also an unreconciled tension between the two upgrade gates: §1 asserts multi-terminal is "o principal gancho de upgrade," but §2.7/§8.2 independently hard-gate at 10 comandas simultâneas. For a busy single-terminal establishment, the comanda limit could become the actual forcing function rather than the terminal count, and the PRD never discusses whether that's intentional or just an abuse guard.

### Findings
- **critical** No Success Metrics section anywhere in the PRD — the document has no way to validate whether the stated competitive thesis (§1) is working. *Fix:* add a Success Metrics section with thesis-tied metrics (e.g., upgrade rate driven by terminal vs. comanda limit, % of service time spent offline, cancellation rate) and at least one counter-metric.
- **medium** Two independent upgrade gates (multi-terminal, 10-comanda limit) aren't reconciled against the stated single "principal gancho." *Fix:* clarify in §1 or Épico 8 whether the comanda limit is a deliberate second monetization lever or purely an abuse guard, and what happens if it turns out to be the dominant one in practice.

## Done-ness clarity — strong

The highest-risk stories have precise, testable criteria: §5.2's split logic is unusually rigorous ("a soma das partes deve ser exatamente igual ao total... o botão de confirmar fica desabilitado até a soma bater exato," deterministic remainder assignment, cents-only arithmetic per NFR7), §1.3's audit trail is append-only and specific about the reason-code list, §6.2 states its own definition of done explicitly ("validação de 'pronto' é a existência do endpoint/consulta, não uma tela"). No instances of "handles gracefully" / "reasonable performance" / "user-friendly" language were found.

### Findings
- **low** Story 7.3 ("sincronizar dados locais com backend... para consolidar os dados... e habilitar relatórios remotos futuros") has no Critérios de aceite, unlike its siblings 7.1/7.2/7.4 — its own done-ness is undefined on the page, even though NFR2/NFR3 partially cover it elsewhere. *Fix:* add at least one verifiable condition (e.g., sync latency bound, or "no event is lost across a reconnect").
- **low** Story 3.3's motivation clause ("para lançar rápido mesmo com cardápio grande") is an unbounded qualifier with no target (search latency, result count) — minor since it sits in the "para" clause rather than the requirement itself.

## Scope honesty — adequate

The Non-Goals section (§5) does real work — five concrete, specific exclusions (nota fiscal, integração com maquininhas, impressão térmica automática, tela de cozinha, cancelamento pós-fechamento), not vague hand-waving. De-scoping is argued, not silent (§2.6, §5.5). Open-items density is appropriately low given the project is fully shipped (§6 shows a closed decision log, not live open questions).

Where this dimension is thin is mechanical: the PRD doesn't use the bracket-tag convention the rubric expects. The one PM assumption ("**Suposição do PM (validar):**" in §2, on whether Dono and Caixa can be the same physical operator) is never tagged `[ASSUMPTION: ...]` and is never indexed anywhere — there's no Assumptions Index to check for roundtrip, and §6 never revisits it. Similarly, none of the real tension-callouts (§1.2, §2.6, §5.5) use `[NOTE FOR PM]`/`[NON-GOAL for MVP]` tags — the content is there, just not in a form that downstream tooling scanning for those tags would find.

### Findings
- **medium** No Assumptions Index and no bracket-tagging convention in use — the single inline assumption (§2) is never indexed or revisited, and equivalent NOTE-FOR-PM-style content (§1.2, §2.6, §5.5) uses ad hoc bold prose instead of `[NOTE FOR PM]`/`[ASSUMPTION]` tags. *Fix:* either retrofit the tags plus a trailing Assumptions Index, or note explicitly that this PRD uses a bold-callout convention in place of bracket tags so downstream consumers know not to grep for the literal tags.

## Downstream usability — thin

FR/NFR ID hygiene is solid: Épico.Story numbering (1.1–8.3) and NFR1–NFR7 are contiguous and unique, and every internal cross-reference checked ("ver Épico 1.3," "ver história 2.6," "ver 2.7," "ver 5.2, NFR7") resolves to real content. This PRD is chain-top in practice — it already fed `docs/architecture.md` and a full implementation — so this dimension's usual weight applies.

The gap is the missing Glossary. Domain nouns central to every épico — comanda, comanda avulsa, mesa, réplica local, taxa de serviço, terminal-host — are used consistently but never defined in one place; anyone pulling a single épico section out of context (the rubric's stated test) has to reconstruct meaning from usage. There are also no Success Metric IDs to cross-reference (same gap as Strategic coherence, noted once there).

### Findings
- **high** No Glossary section — central domain terms are used PRD-wide with consistent but undefined meaning. For a PRD that already fed an Architecture doc and a full build, this is exactly the case the rubric flags as mattering more, not less. *Fix:* add a short Glossary (comanda, comanda avulsa, mesa, terminal-host, réplica local, taxa de serviço, split) near the top or as an appendix.

## Shape fit — strong

This is a single-establishment, multi-role operational tool (garçom/caixa/dono), not a consumer product — the rubric's "internal tool, capability-spec shape" case, just with three roles instead of one. The PRD's choice to skip formal User Journeys and instead carry protagonist context inline in each story ("Como garçom, quero...", "Como caixa, quero...") is the right level of formality: it's not over-formalized (no UJ density for what is fundamentally a role-permission matrix) and not under-formalized (every story still names who acts and why). No finding needed.

## Mechanical notes

- **ID continuity:** Épico.Story IDs (1.1–8.3) and NFR1–NFR7 are contiguous, unique, with no gaps or duplicates found. All checked cross-references resolve.
- **No Assumptions Index:** see Scope honesty finding above — the one inline `Suposição do PM` is not indexed or roundtripped.
- **No UJ section:** by design (see Shape fit) — persona-tagged user stories substitute for UJs here; not a defect for this product shape.
- **Terminology drift, PRD vs. shipped code:** the PRD's narrative refers to the table foreign key as `mesa_id` (Portuguese, snake_case — §2.3 "sem vínculo a `mesa_id`", §2.5 "apenas o `mesa_id` vinculado muda"). The actual implemented field, per `packages/shared-types/src/events.ts`, is `tableId` (English, camelCase) — the project's English-naming convention was adopted at M2 (`docs/implementation-plan.md` M2: "Nomenclatura de todo o código... traduzida de português pra inglês nesta etapa"), after this PRD was written (2026-09-19), and the PRD's inline field references were never updated to match. Cosmetic, but will confuse anyone tracing PRD prose to code.
