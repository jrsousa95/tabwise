import { computeSummaryDelta, formatDelta, type CashRegisterSummaryRange } from "./reports";
import { formatCentsToBRL } from "./money";
import type { CashRegisterSummary } from "./cash-register";
import { defineMessages, getLanguage } from "./i18n";

const LINE_BREAK = "\r\n";

// Delimitador segue o idioma: `;` em PT (`,` já é separador decimal no Excel
// pt-BR); `,` em EN, onde o decimal é `.` e `,` é o padrão de planilha.
// Valores em EN podem conter `,` de milhar (ex.: "R$1,234.56") — por isso a
// célula vai entre aspas quando contém o delimitador (ver `quoteCell`).
function delimiter(): string {
  return getLanguage() === "pt" ? ";" : ",";
}

const messages = defineMessages({
  pt: {
    closedOrders: "Comandas fechadas",
    subtotal: "Subtotal",
    serviceCharge: "Taxa de serviço",
    totalSold: "Total vendido",
    cash: "Dinheiro",
    card: "Cartão",
    pix: "Pix",
    pendingOrders: "Comandas pendentes",
    periodReport: "Relatório por período",
    dateRange: (fromDate: string, toDate: string) => `${fromDate} a ${toDate}`,
    comparisonHeading: "Comparativo com o período anterior",
    totalSoldSelected: "Total vendido — período escolhido",
    totalSoldPrevious: "Total vendido — período anterior",
    variance: "Variação",
    selectedPeriod: (fromDate: string, toDate: string) => `Período escolhido (${fromDate} a ${toDate})`,
    previousPeriod: "Período anterior",
  },
  en: {
    closedOrders: "Closed tabs",
    subtotal: "Subtotal",
    serviceCharge: "Service charge",
    totalSold: "Total sales",
    cash: "Cash",
    card: "Card",
    pix: "Pix",
    pendingOrders: "Pending tabs",
    periodReport: "Period report",
    dateRange: (fromDate: string, toDate: string) => `${fromDate} to ${toDate}`,
    comparisonHeading: "Comparison with previous period",
    totalSoldSelected: "Total sales — selected period",
    totalSoldPrevious: "Total sales — previous period",
    variance: "Change",
    selectedPeriod: (fromDate: string, toDate: string) => `Selected period (${fromDate} to ${toDate})`,
    previousPeriod: "Previous period",
  },
});

// Caracteres que fazem alguns programas de planilha interpretar a célula
// como o início de uma fórmula em vez de texto literal — relevante aqui
// porque a célula "Variação" rotineiramente começa com "+" ou "-" (ex.:
// "+R$ 10,00 (+10.0%)"). Prefixa com apóstrofo (convenção de texto literal
// em CSV/Excel) pra blindar contra CSV injection.
const FORMULA_PREFIX_CHARS = ["+", "-", "=", "@"];

function escapeFormulaInjection(value: string): string {
  return FORMULA_PREFIX_CHARS.includes(value.trimStart()[0]) ? `'${value}` : value;
}

function quoteCell(value: string, separator: string): string {
  return value.includes(separator) || value.includes('"') || /[\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function row(cells: Array<string | number>): string {
  const separator = delimiter();
  return cells.map((cell) => quoteCell(escapeFormulaInjection(String(cell)), separator)).join(separator);
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
  const m = messages[getLanguage()];
  const rows = [
    row([m.closedOrders, summary.closedOrdersCount]),
    row([m.subtotal, formatCentsToBRL(summary.subtotalCents)]),
    row([m.serviceCharge, formatCentsToBRL(summary.serviceFeeCents)]),
    row([m.totalSold, formatCentsToBRL(summary.totalSoldCents)]),
    row([m.cash, formatCentsToBRL(summary.totalByPaymentMethod.cash)]),
    row([m.card, formatCentsToBRL(summary.totalByPaymentMethod.card)]),
    row([m.pix, formatCentsToBRL(summary.totalByPaymentMethod.pix)]),
  ];
  if (includePending) {
    rows.push(row([m.pendingOrders, summary.pendingOrders.length]));
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
  const m = messages[getLanguage()];

  const lines: string[] = [
    row([m.periodReport, m.dateRange(fromDate, toDate)]),
    "",
    row([m.comparisonHeading]),
    row([m.totalSoldSelected, formatCentsToBRL(current.totalSoldCents)]),
    row([m.totalSoldPrevious, formatCentsToBRL(previous.totalSoldCents)]),
    row([m.variance, formatDelta(deltaLabel, deltaPercent)]),
    "",
    row([m.selectedPeriod(fromDate, toDate)]),
    ...summaryRows(current, { includePending: true }),
    "",
    row([m.previousPeriod]),
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
  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
