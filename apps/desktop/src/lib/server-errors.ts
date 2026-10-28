import { getLanguage } from "./i18n";

/**
 * O sidecar responde erros de validação em português (`{ error: "..." }`) —
 * é a língua do domínio e dos testes dele. Em vez de trocar o contrato da
 * API por códigos, a UI traduz na borda: toda mensagem conhecida tem a
 * versão em inglês aqui; desconhecida passa sem tradução (melhor mostrar
 * em PT do que esconder o motivo do erro).
 */
const SERVER_ERRORS_EN: Record<string, string> = {
  // Genéricos / sessão / acesso
  "corpo da requisição não é um JSON válido": "request body is not valid JSON",
  "faça login primeiro": "please log in first",
  "só o dono pode fazer isso": "only the owner can do this",
  "acesso restrito ao dono": "owner access only",
  "esta API só aceita conexões desta máquina": "this API only accepts connections from this machine",
  "not found": "not found",

  // Operadores / login
  "dados de operador inválidos": "invalid staff member details",
  "só o dono pode cadastrar operadores": "only the owner can add staff members",
  "PIN já em uso por outro operador": "PIN already in use by another staff member",
  "PIN inválido": "invalid PIN",
  "PIN incorreto": "incorrect PIN",

  // Cardápio
  "nome da categoria é obrigatório": "category name is required",
  "categoria não encontrada": "category not found",
  "categoria tem produtos vinculados — remova os produtos primeiro": "category has products — remove the products first",
  "dados de produto inválidos": "invalid product details",
  "produto não encontrado": "product not found",
  "campo 'active' (boolean) é obrigatório": "field 'active' (boolean) is required",
  "nome do produto é obrigatório": "product name is required",

  // Mesas
  "identificador da mesa é obrigatório": "table identifier is required",
  "capacidade precisa ser um número inteiro positivo": "capacity must be a positive whole number",
  "mesa não encontrada": "table not found",
  "mesa tem uma comanda aberta — feche a comanda antes de remover a mesa": "table has an open tab — close the tab before removing the table",

  // Estabelecimento
  "taxa de serviço padrão precisa ser um número >= 0": "default service charge must be a number >= 0",

  // Comandas
  "source precisa ser 'table' ou 'standalone'": "source must be 'table' or 'standalone'",
  "mesa já tem uma comanda aberta": "table already has an open tab",
  "comanda não encontrada": "tab not found",
  "comanda fechada não pode ser transferida": "a closed tab can't be transferred",
  "comanda avulsa não tem mesa pra transferir": "a walk-in tab has no table to transfer",
  "mesa de destino não encontrada": "destination table not found",
  "mesa de destino é a mesma mesa atual": "destination table is the same as the current table",
  "mesa de destino já tem uma comanda aberta": "destination table already has an open tab",
  "comanda fechada não aceita novos itens": "a closed tab can't take new items",
  "quantidade precisa ser um número inteiro positivo": "quantity must be a positive whole number",
  "produto não encontrado ou inativo": "product not found or inactive",
  "garçom não pode cancelar item": "servers can't void items",
  "comanda fechada não aceita cancelamento de item": "items on a closed tab can't be voided",
  "item não encontrado": "item not found",
  "item já está cancelado": "item is already voided",
  "motivo de cancelamento inválido": "invalid void reason",
  "motivo 'outro' exige uma observação": "reason 'other' requires a note",
  "comanda fechada não aceita edição de item": "items on a closed tab can't be edited",
  "item cancelado não aceita edição": "a voided item can't be edited",
  "deltaQuantity precisa ser um número inteiro positivo": "deltaQuantity must be a positive whole number",
  "garçom não pode fechar comanda": "servers can't close tabs",
  "comanda já está fechada": "tab is already closed",
  "taxa de serviço inválida": "invalid service charge",
  "conflito não encontrado pra essa comanda": "no conflict found for this tab",
  "conflito já foi marcado como resolvido": "conflict was already marked as resolved",

  // Pagamento / split
  "informe ao menos uma parte do pagamento": "enter at least one payment part",
  "cada parte do split precisa de um valor inteiro positivo": "each part of the split bill needs a positive whole amount",
  "forma de pagamento precisa ser 'cash', 'card' ou 'pix'": "payment method must be 'cash', 'card' or 'pix'",
  "valor recebido em dinheiro precisa ser maior ou igual ao valor da parte":
    "cash received must be greater than or equal to the part amount",

  // Caixa
  "garçom não pode registrar sangria": "servers can't record pay-outs",
  "valor da sangria inválido": "invalid pay-out amount",
  "motivo da sangria é obrigatório": "pay-out reason is required",
  "garçom não pode registrar suprimento": "servers can't record pay-ins",
  "valor do suprimento inválido": "invalid pay-in amount",
  "motivo do suprimento é obrigatório": "pay-in reason is required",
  "nenhuma sessão de caixa aberta": "no open cash session",
  "garçom não pode abrir sessão de caixa": "servers can't open a cash session",
  "valor de abertura inválido": "invalid opening float",
  "já existe uma sessão de caixa aberta": "a cash session is already open",
  "garçom não pode ver o valor esperado da sessão de caixa": "servers can't see the cash session's expected amount",
  "sessão de caixa não encontrada": "cash session not found",
  "garçom não pode fechar sessão de caixa": "servers can't close a cash session",
  "valor contado inválido": "invalid counted amount",

  // Relatórios
  "intervalo de datas obrigatório": "date range is required",
  "intervalo de datas inválido": "invalid date range",
  "configure a sincronização com a nuvem primeiro": "set up cloud sync first",
  "credencial de nuvem inválida — reconfigure a sincronização": "invalid cloud credential — set up sync again",
  "não foi possível conectar à nuvem agora": "couldn't connect to the cloud right now",
  "resposta inválida da nuvem": "invalid response from the cloud",

  // Pareamento / sync (inclui mensagens do backend repassadas pelo sidecar)
  "token de pareamento LAN ausente ou inválido": "LAN pairing token missing or invalid",
  "token é obrigatório": "token is required",
  "host e port são obrigatórios (port precisa ser inteiro positivo)": "host and port are required (port must be a positive whole number)",
  "evento inválido": "invalid event",
  "lote de eventos inválido": "invalid event batch",
  "este terminal ainda não tem credencial de nuvem": "this terminal doesn't have a cloud credential yet",
  "terminalId é obrigatório": "terminalId is required",
  "backend recusou o patrocínio de cadastro": "the cloud refused to sponsor the registration",
  "falha ao contatar a nuvem pra patrocinar o cadastro": "couldn't reach the cloud to sponsor the registration",
  "limite do plano atingido": "plan limit reached",
  "credencial de terminal ausente ou inválida": "terminal credential missing or invalid",
  "credencial de terminal inválida": "invalid terminal credential",
  "terminal já cadastrado": "terminal already registered",
  "estabelecimento não encontrado": "venue not found",

  // Fallbacks do próprio frontend (lib/*.ts), quando a resposta não traz `error`
  "não foi possível completar a ação": "couldn't complete the action",
  "não foi possível carregar": "couldn't load",
  "não foi possível cadastrar a categoria": "couldn't add the category",
  "não foi possível cadastrar o produto": "couldn't add the product",
  "não foi possível atualizar o produto": "couldn't update the product",
  "não foi possível renomear a categoria": "couldn't rename the category",
  "não foi possível remover a categoria": "couldn't remove the category",
  "não foi possível renomear o produto": "couldn't rename the product",
  "não foi possível remover o produto": "couldn't remove the product",
  "não foi possível remover a mesa": "couldn't remove the table",
  "não foi possível remover o host manual": "couldn't remove the manual host",
  "não foi possível entrar": "couldn't log in",
  "não foi possível marcar como resolvido": "couldn't mark as resolved",
};

/**
 * Mensagens montadas com template literal no sidecar/backend — parte
 * variável capturada pelo regex. Checadas em ordem, depois do mapa exato.
 */
const SERVER_ERROR_PATTERNS_EN: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [
    /^soma das partes \((-?\d+)\) precisa ser exatamente igual ao total \((-?\d+)\)$/,
    (match) => `sum of the parts (${match[1]}) must equal the total (${match[2]}) exactly`,
  ],
  [
    /^limite de (\d+) comandas simultâneas atingido — faça upgrade de plano pra aumentar$/,
    (match) => `limit of ${match[1]} open tabs at once reached — upgrade your plan to raise it`,
  ],
  [
    /^limite de (\d+) terminal\(is\) do plano atingido — faça upgrade pra conectar mais terminais$/,
    (match) => `your plan's limit of ${match[1]} terminal(s) was reached — upgrade to connect more terminals`,
  ],
  [/^push falhou: HTTP (\d+)$/, (match) => `push failed: HTTP ${match[1]}`],
  [/^pull falhou: HTTP (\d+)$/, (match) => `pull failed: HTTP ${match[1]}`],
];

export function localizeError(message: string): string {
  if (getLanguage() === "pt") return message;
  const exact = SERVER_ERRORS_EN[message];
  if (exact !== undefined) return exact;
  for (const [pattern, translate] of SERVER_ERROR_PATTERNS_EN) {
    const match = message.match(pattern);
    if (match) return translate(match);
  }
  return message;
}
