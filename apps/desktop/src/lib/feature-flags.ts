/**
 * Pareamento de terminais (multi-terminal) é a feature que deveria virar o
 * gancho de upgrade do plano pago (PRD Épico 8) — mas hoje não existe
 * nenhuma cobrança implementada (sem gateway, sem self-service, sem tela de
 * preços; ver deferred-work.md). Escondida da versão pública até o fluxo de
 * pagamento existir de verdade, pra não expor um "configurar pareamento"
 * que não leva a upgrade nenhum.
 *
 * O enforcement real (1 terminal no plano free) já é feito no BACKEND
 * (M10, independente desta flag) — esconder a UI aqui é só pra não
 * confundir o público geral com uma feature que ainda não é vendável, não
 * é o mecanismo de bloqueio em si.
 *
 * Junto com o pareamento, escondidas as telas que só fazem sentido com mais
 * de um terminal: Conflitos de Sincronização (nunca têm conteúdo sem um
 * segundo terminal pra conflitar) e Relatório Consolidado (depende de
 * nuvem configurada, que depende de pareamento).
 */
export const MULTI_TERMINAL_UI_ENABLED = false;
