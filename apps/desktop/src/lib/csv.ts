import { computeSummaryDelta, formatDelta, type CashRegisterSummaryRange } from "./reports";
import { formatCentsToBRL } from "./money";
import type { CashRegisterSummary } from "./cash-register";

const DELIMITER = ";";
const LINE_BREAK = "\r\n";

// Caracteres que fazem alguns programas de planilha interpretar a célula
// como o início de uma fórmula em vez de texto literal — relevante aqui
// porque a célula "Variação" rotineiramente começa com "+" ou "-" (ex.:
// "+R$ 10,00 (+10.0%)"). Prefixa com apóstrofo (convenção de texto literal
// em CSV/Excel) pra blindar contra CSV injection.
const FORMULA_PREFIX_CHARS = ["+", "-", "=", "@"];

function escapeFormulaInjection(value: string): string {
  return FORMULA_PREFIX_CHARS.includes(value[0]) ? `'${value}` : value;
}

function row(cells: Array<string | number>): string {
  return cells.map((cell) => escapeFormulaInjection(String(cell))).join(DELIMITER);
}

/**
 * Story 2.4 — um bloco de resumo (comandas fechadas, subtotal, taxa de
 * serviço, total vendido, por forma de pagamento) no mesmo formato do bloco
 * de comparativo: linhas `;`-separadas, valores monetários via
 * `formatCentsToBRL` (mesma função já usada em tela, nunca reformatados). O
 * total de comandas pendentes só entra no bloco do período escolhido — o
 * campo é sempre um retrato de "agora", não faz sentido repeti-lo pro
 * período anterior (mesma semântica da tela, `reports.tsx`).
 */
function summaryRows(summary: CashRegisterSummary, { includePending }: { includePending: boolean }): string[] {
  const rows = [
    row(["Comandas fechadas", summary.closedOrdersCount]),
    row(["Subtotal", formatCentsToBRL(summary.subtotalCents)]),
    row(["Taxa de serviço", formatCentsToBRL(summary.serviceFeeCents)]),
    row(["Total vendido", formatCentsToBRL(summary.totalSoldCents)]),
    row(["Dinheiro", formatCentsToBRL(summary.totalByPaymentMethod.cash)]),
    row(["Cartão", formatCentsToBRL(summary.totalByPaymentMethod.card)]),
    row(["Pix", formatCentsToBRL(summary.totalByPaymentMethod.pix)]),
  ];
  if (includePending) {
    rows.push(row(["Comandas pendentes", summary.pendingOrders.length]));
  }
  return rows;
}

/**
 * Épico 2 (Story 2.4) — monta o texto do CSV do relatório por período (2.1):
 * identificação do período, comparativo com o período anterior e os dois
 * blocos de resumo (escolhido e anterior). Reproduz só o que já está em
 * tela nessa story — "Por operador" (2.2) e "Por produto" (2.3) ficam de
 * fora (`epic-2-context.md`). Delimitador `;` (não `,`, que já é separador
 * decimal no Excel pt-BR) e `\r\n` entre linhas — sem lib nova de CSV.
 */
export function buildCashRegisterSummaryCsv(fromDate: string, toDate: string, range: CashRegisterSummaryRange): string {
  const { current, previous } = range;
  const { deltaLabel, deltaPercent } = computeSummaryDelta(current, previous);

  const lines: string[] = [
    row(["Relatório por período", `${fromDate} a ${toDate}`]),
    "",
    row(["Comparativo com o período anterior"]),
    row(["Total vendido - período escolhido", formatCentsToBRL(current.totalSoldCents)]),
    row(["Total vendido - período anterior", formatCentsToBRL(previous.totalSoldCents)]),
    row(["Variação", formatDelta(deltaLabel, deltaPercent)]),
    "",
    row([`Período escolhido (${fromDate} a ${toDate})`]),
    ...summaryRows(current, { includePending: true }),
    "",
    row(["Período anterior"]),
    ...summaryRows(previous, { includePending: false }),
  ];

  return lines.join(LINE_BREAK);
}

/**
 * Story 2.4 — dispara o download nativo do navegador a partir de uma string
 * já pronta, sem chamada nova ao sidecar/backend. BOM UTF-8 (escape
 * `"\uFEFF"`) no início do Blob pra acentuação (ex.: "Taxa de serviço") abrir
 * corretamente no Excel no Windows — sem o BOM, ele assume outra codificação
 * e corrompe os acentos. Escapado como `\uFEFF` (em vez do caractere
 * invisível cru, frágil a uma edição futura apagar sem perceber — some no
 * diff). `<a download>` temporário, removido do DOM e com o Object URL
 * revogado logo depois do clique.
 */
const UTF8_BOM = "\uFEFF";

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([`${UTF8_BOM}${content}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
