# Arquitetura — Passa a Régua

**Fase:** Arquitetura (BMAD — Architect)
**Data:** 2026-09-20 (última atualização: 2026-09-24 — Épico 9)
**Baseado em:** `docs/project-brief.md`, `docs/prd.md`
**Status:** Implementado (Épicos 1-8 / M0-M12). §3.4/3.5/4.4 registram as decisões de arquitetura do Épico 9 (Evolução do Fluxo de Caixa), ainda não implementado.

---

## 1. Princípio unificador

O sistema inteiro é construído em torno de uma única ideia: **cada terminal mantém um log de eventos append-only, e sincronizar significa trocar e mesclar esses logs — não importa se o peer é outro terminal na mesma rede ou o backend na nuvem.**

Isso significa que **LAN sync e cloud sync usam o mesmo protocolo de replicação**, apenas com transportes diferentes (WebSocket/HTTP local vs. HTTPS pela internet). O backend na nuvem não é uma entidade arquiteturalmente diferente de um terminal — é só mais um peer, só que permanente e privilegiado (fonte de verdade para plano/limites, agregador multi-unidade para relatórios).

Essa unificação existe porque o PRD já exige (§ Épico 7, NFR2/NFR3) que nenhum terminal dependa de outro para funcionar, e que os dados de comanda sejam eventos append-only. Uma vez que você aceita essas duas premissas, ter dois protocolos de sync diferentes (um pra LAN, outro pra nuvem) seria trabalho duplicado sem necessidade.

## 2. Decisões fundacionais desta fase

1. **Runtime local: sidecar Node.js/TS** embutido no app Tauri (via [Tauri sidecar](https://tauri.app/develop/sidecar/)). Todo o motor de sync, o SQLite local e a lógica de reconciliação rodam em TypeScript — o mesmo pacote de lógica de eventos é compartilhado com o backend na nuvem (`packages/sync-engine`, ver seção 9). O Rust do Tauri fica restrito a: abrir o processo sidecar, IPC entre webview e sidecar, e capacidades nativas do SO (ex: impressão futura).
   *Por quê:* máximo reaproveitamento de código entre local e nuvem, e a parte de maior risco técnico do projeto (event sourcing + reconciliação) fica na linguagem onde você tem 5+ anos de experiência.

2. **Descoberta LAN: mDNS/Bonjour automático com fallback manual.** Cada terminal anuncia sua presença na rede local via mDNS (biblioteca Node, ex: `bonjour-service` ou `multicast-dns`). Se a rede do estabelecimento bloquear multicast (comum em roteadores de baixo custo), o operador pode digitar o IP/porta do host manualmente nas configurações do terminal como fallback.

3. **"Host" é um papel de prioridade, não um caminho de código diferente.** Todo terminal roda exatamente o mesmo software (mesmo sidecar, mesma lógica de sync). "Host" é apenas o terminal que a UI trata como referência (ex: primeiro a ser configurado, geralmente o do caixa). Na prática:
   - Cada terminal tenta sincronizar com o host primeiro.
   - Se o host estiver inacessível, o terminal tenta sincronizar com **qualquer outro terminal alcançável na LAN** (o protocolo é simétrico — qualquer terminal pode aceitar conexões de sync de qualquer outro).
   - Isso cobre um cenário que o PRD não detalhava explicitamente: se o host (PC do caixa) cair, dois tablets de garçom ainda conseguem sincronizar *entre si* diretamente, em vez de ficarem isolados até o host voltar. Isso fortalece o NFR2 do PRD ("nenhum terminal pode ficar bloqueado pela queda de outro") sem custo extra de implementação, porque é a mesma lógica de sync, só apontando para um peer diferente.
   - **Isso é uma extensão da decisão do brief/PRD, não uma contradição** — a topologia "host local" continua sendo o caminho preferencial e a UI continua mostrando o host como referência da unidade; a diferença é que o Architect está removendo o host como *ponto único de sync* sem custo adicional de engenharia.

## 3. Modelo de dados

### 3.1 Camada de eventos (fonte de verdade, append-only)

Cada terminal mantém uma tabela `events` no SQLite local:

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | TEXT (ULID) | Identificador do evento, ordenável por tempo de criação |
| `hlc` | TEXT | Hybrid Logical Clock — timestamp lógico usado para ordenação causal entre terminais (ver § 3.3) |
| `aggregate_type` | TEXT | Ex: `order`, `table`, `operator` |
| `aggregate_id` | TEXT | Id da entidade afetada (ex: id da comanda) |
| `type` | TEXT | Ex: `item_added`, `item_canceled`, `order_opened`, `order_transferred`, `order_closed`. `tables_grouped`/`table_group_dissolved` também existem no schema (legado — feature de junção de mesas removida em 2026-09-22, PRD 2.6; mantidos só pra não quebrar a releitura de instalações com esses eventos já gravados, nenhuma rota nova os produz) |
| `payload` | JSON | Dados específicos do evento |
| `operator_id` | TEXT | Quem gerou o evento (obrigatório — decorre da exigência de auditoria do PRD) |
| `terminal_id` | TEXT | De qual terminal o evento se originou |
| `created_at` | INTEGER | Timestamp de parede (wall-clock), só para exibição — nunca usado para ordenação de conflito |

Eventos **nunca são editados ou apagados** — um cancelamento é um novo evento (`item_canceled`) que referencia o evento original, não uma remoção.

### 3.2 Camada de leitura (materializada, derivada dos eventos)

Para a UI responder rápido, cada terminal também mantém tabelas "normais" (mutáveis), que são **projeções recalculadas a partir do replay dos eventos** em ordem de HLC:

- `tables` (id, identificador, status)
- `orders` (id, table_id nullable, status, opened_at, closed_at)
- `order_items` (estado atual — já refletindo cancelamentos aplicados)
- `payments` (registros de fechamento, splits)

Essas tabelas são **descartáveis e reconstruíveis** a qualquer momento a partir do log de eventos — isso é o que torna a reconciliação segura: se dois terminais mesclam seus logs de eventos, cada um recalcula sua camada de leitura do zero (ou incrementalmente) e chega ao mesmo estado, porque a função "aplicar eventos em ordem de HLC" é determinística.

### 3.3 Ordenação causal: Hybrid Logical Clock (HLC)

Relógios de parede de terminais diferentes não são confiáveis para decidir "o que aconteceu primeiro" (podem estar dessincronizados). Por isso, cada terminal mantém um **HLC** (combinação de timestamp físico + contador lógico), que é incrementado a cada evento local e ajustado ao receber eventos de outros terminais — garantindo que, se o evento A causou o evento B, o HLC de A é sempre menor que o de B, independente do relógio de cada máquina.

Isso é uma peça de infraestrutura pequena (uma biblioteca de ~100 linhas), mas é o que torna a reconciliação determinística. Recomendo usar uma biblioteca existente (ex: `@clockwork/hlc` ou implementação própria baseada no paper original de Kulkarni et al.) em vez de reinventar.

### 3.4 Extensão do modelo de dados — sessão de caixa (PRD Épico 9, histórias 9.1-9.5)

Quatro eventos novos, seguindo exatamente o padrão já estabelecido em §3.1 (cada entidade real do domínio tem seu próprio `aggregate_type`; `aggregate_id` é gerado na criação e reaproveitado pelos eventos seguintes do mesmo ciclo de vida — mesmo padrão de `order_opened`→`item_added`, `category_registered`→`category_renamed`):

| Evento | `aggregate_type` | `aggregate_id` | Payload (essencial) |
|---|---|---|---|
| `cash_session_opened` | `cash_session` (novo) | id gerado (ULID) na abertura | `openingAmountCents` |
| `cash_session_closed` | `cash_session` | id da sessão aberta | `countedAmountCents` |
| `cash_withdrawal_recorded` (sangria) | `cash_session` | id da sessão aberta | `amountCents`, `reason` |
| `cash_deposit_recorded` (suprimento) | `cash_session` | id da sessão aberta | `amountCents`, `reason` |

**Sangria/suprimento não ganham `aggregate_type` próprio** — são sub-eventos do ciclo de vida da sessão, mesmo padrão de `item_added` (que usa `aggregate_type: "order"`, não um `"item"` inexistente), não entidades independentes.

`AggregateTypeSchema` (`packages/shared-types/src/common.ts`) é um enum zod fechado — precisa ganhar `"cash_session"` junto com os schemas dos 4 eventos novos.

**Escopo do invariante "uma sessão aberta por vez" (revisado após reviewer adversarial — ver `.memlog.md` desta seção): é o ESTABELECIMENTO, não o terminal.** A primeira versão deste documento escopava por `terminal_id`, mas `terminal_id` (`apps/desktop/sidecar/src/terminal-identity.ts`) é um UUID gerado no primeiro boot e guardado num arquivo local — não é ligado a hardware. Um terminal substituído no meio do turno (queda, troca por um tablet reserva) geraria um `terminal_id` novo, que passaria trivialmente pela checagem "sem sessão aberta *neste* terminal", abrindo uma segunda sessão para o que na prática é a mesma gaveta física. Isso é exatamente a classe de bug do §4.2 (dois terminais, cada um satisfazendo localmente um invariante que na verdade é global) — a mesma que este projeto já teve que corrigir uma vez para mesas.

Por isso a sessão de caixa é tratada como um recurso **compartilhado do estabelecimento** (como mesa), não como algo exclusivo de um terminal — e ganha a **mesma regra de resolução do §4.2**: se dois `cash_session_opened` concorrentes (de terminais que não se enxergavam) se mesclarem no log, o de **menor HLC** é a sessão canônica; a outra é marcada como perdedora (`mergedInto`), com o mesmo aviso não bloqueante já usado pra mesas (§4.2/§4.4 abaixo) em vez de inventar um mecanismo novo. Como só existe um "slot" (não um por mesa), a implementação é mais simples que `tableToCanonicalOrder`: um único ponteiro para a sessão canônica aberta, não um mapa.

Estado materializado em `reconciliation.ts` (§3.2), no mesmo formato de `orders`/`tables`:

```ts
interface CashMovementRecord {
  readonly id: string;
  readonly amountCents: number;
  readonly reason: string;
  readonly recordedAt: number;
  readonly operatorId: string;
}

interface CashSessionState {
  readonly id: string;
  readonly status: "open" | "closed";
  /** Só informativo/auditoria — não usado pra decidir o invariante (ver acima). */
  readonly openedByTerminalId: string;
  /** Setado quando esta sessão perdeu o conflito acima e foi mesclada na canônica — mesmo campo de `OrderState.mergedInto`. */
  readonly mergedInto?: string;
  readonly openingAmountCents: number;
  readonly openedAt: number;
  readonly openedByOperatorId: string;
  readonly withdrawals: readonly CashMovementRecord[];
  readonly deposits: readonly CashMovementRecord[];
  readonly closing?: {
    /** Único fato físico congelado no fechamento — o dono conta a gaveta uma vez. */
    readonly countedAmountCents: number;
    readonly closedAt: number;
    readonly closedByOperatorId: string;
  };
}
// cashSessions: Map<string, CashSessionState>
```

**`expectedAmountCents`/`differenceCents` NÃO são campos do payload do evento nem do `closing` acima — são valores DERIVADOS, recalculados pela projeção a partir do log, nunca congelados.** Isso segue o mesmo princípio já em §3.2 ("projeções são recalculáveis, nunca fonte de verdade"): se um pedido em dinheiro que deveria contar pra essa sessão só sincroniza depois que o dono já contou a gaveta e fechou, a próxima leitura do relatório já reflete o valor certo — sem precisar de um evento de correção manual (revisão do design original, que congelava os dois campos no `cash_session_closed` e não tinha caminho de correção pra sync tardio — achado do reviewer adversarial).

**`[ASSUMPTION]` a confirmar antes de detalhar a história 9.2 em épicos/stories:** `expectedAmountCents` = `openingAmountCents` + pagamentos em dinheiro de orders fechadas com `closing.closedAt` dentro de `[openedAt, closedAt ?? agora]` da sessão canônica atual + suprimentos − sangrias. Como a sessão agora é do estabelecimento (não de um terminal), a correlação **não filtra por `terminal_id`** — qualquer terminal do estabelecimento pode ter recebido o dinheiro, e isso está correto (era o ponto fraco da versão anterior, que também não filtrava mas não tinha justificativa pra isso). Ainda em aberto: o que a UI mostra quando a sessão está fechada mas eventos relevantes continuam chegando depois — hoje a leitura seguinte simplesmente muda de valor, sem histórico do que era "esperado no momento do fechamento"; se o dono precisar desse retrato congelado (ex: pra bater com o relatório impresso do dia), precisa virar uma decisão explícita antes de implementar 9.2.

### 3.5 Relatório por período (PRD Épico 9.3/9.6/9.7)

`computeCashRegisterSummary(orders, dateKey)` (`packages/sync-engine/src/reporting.ts`, §5) hoje só aceita uma data única. Em vez de alterar sua assinatura (evita quebrar os dois chamadores já existentes — sidecar M8 e backend M11), ganha uma função **nova**, `computeCashRegisterSummaryForRange(orders, fromDateKey, toDateKey)`, extraindo a agregação comum (`subtotalCents`/`serviceFeeCents`/`totalByPaymentMethod`/etc.) para um helper interno compartilhado pelas duas funções. Os dois call sites (resumo do dia — Épico 6 — e resumo por período — Épico 9) ficam explícitos, sem branch condicional dentro da função existente.

Três comportamentos fixados aqui (achado do reviewer adversarial: ficariam implícitos e cada implementador resolveria diferente):

- **Bounds inclusivos nas duas pontas** (`fromDateKey <= localDateKey(...) <= toDateKey`) — comparação lexicográfica de string `YYYY-MM-DD` já funciona pra isso, sem conversão de data.
- **`pendingOrders` mantém a semântica atual**: todas as orders abertas *agora*, sem filtrar pelo período pedido — é um retrato do estado atual, não uma métrica do intervalo (mesmo comportamento não-filtrado que a função de um dia único já tem hoje).
- **Filtro por operador (história 9.6) acontece FORA do helper**, não como parâmetro dele: quem chama pré-filtra o array de `orders` por `closing.operatorId` antes de passar pra `computeCashRegisterSummaryForRange`. A função em si não sabe o que é "operador".

**Limitação conhecida, não bloqueante:** `localDateKey` já documenta que sidecar (fuso da máquina) e backend (fuso do servidor) podem calcular o dia de uma mesma order de forma diferente perto da meia-noite — aceitável hoje pro relatório de um dia único. Num relatório por período, e principalmente no consolidado multi-terminal (9.8, que mistura dado do backend com o que o dono vê localmente), essa divergência de borda fica mais visível — registrado aqui como algo a observar, não a resolver agora.

## 4. Reconciliação — casos especiais

### 4.1 Caso feliz (a maioria dos eventos)
Itens adicionados a uma comanda por terminais diferentes simplesmente se unem no log — não há conflito real porque "adicionar item" é uma operação que comuta (a ordem não muda o resultado final: a lista de itens da comanda).

### 4.2 Caso de conflito real: duas comandas abertas na mesma mesa
Cenário: o host cai; dois garçons em terminais diferentes, sem conseguir se enxergar na LAN, cada um abre uma comanda para a "mesa 5" (ex: um não viu que o outro já tinha aberto, ou acharam que a mesa tinha ficado livre). Quando os logs se mesclam, existem dois eventos `order_opened` para a mesma mesa.

**Regra de resolução (confirmada):** o evento com o **menor HLC** (o que aconteceu primeiro, causalmente) é a comanda canônica; o segundo evento é reclassificado automaticamente como se fosse uma continuação da primeira comanda (seus itens são reatribuídos à comanda canônica). **O merge é automático e não bloqueia ninguém** — não exige decisão manual no meio do rush.

**Mas não é silencioso.** O risco identificado: se os itens forem reatribuídos sem nenhum sinal visível, o cliente pode ver na conta, no fechamento, itens que não reconhece — e o garçom/caixa não vai saber explicar por quê, porque nunca foram avisados de que o merge aconteceu. Por isso, assim que o terminal que "perdeu" a comanda sincroniza e recebe o merge, ele exibe um indicador não bloqueante na tela (ex: "⚠️ 1 comanda foi mesclada automaticamente — ver detalhes"), permitindo ao operador conferir com o cliente antes do fechamento. O registro de auditoria completo continua existindo e visível ao dono, além dessa notificação no terminal.

### 4.3 Idempotência
Como cada evento tem um `id` único (ULID), reaplicar o mesmo evento duas vezes (ex: por causa de uma sincronização retomada após queda de conexão) é seguro — o merge é feito por `UNION`/`UPSERT` por `id`, nunca por reprocessamento cego.

### 4.4 Sessão de caixa (§3.4) É um caso de conflito estilo §4.2

**Revisado após reviewer adversarial** — a primeira versão deste documento argumentava que sessão de caixa não precisava de resolução de conflito, por ser "local a um terminal, não compartilhada". Esse argumento não se sustenta: a premissa do produto inteiro (§1) é que terminais operam offline e só descobrem o que aconteceu em outro terminal ao sincronizar — exatamente o mecanismo que produz o conflito do §4.2 pra mesa. `terminal_id` também não é um proxy confiável de "uma gaveta física" (§3.4) — um terminal substituído no meio do turno tem um `terminal_id` novo e recomeça do zero, sem saber que já existe uma sessão aberta em outro lugar.

Por isso a sessão de caixa segue **a mesma regra do §4.2**, com o estabelecimento (não a mesa) como o recurso disputado: dois `cash_session_opened` concorrentes, vindos de terminais que não se enxergavam, se resolvem pelo **menor HLC** como canônica; a outra é marcada `mergedInto` e gera o mesmo aviso não bloqueante já usado pra mesas. A UI de "Conflitos" (hoje só de mesas — `apps/desktop/src/routes/table-conflicts.tsx`) precisa passar a listar também conflitos de sessão de caixa, ou ganhar uma tela irmã — decisão de UI a tomar no detalhamento de 9.1, não aqui.

## 5. Sincronização com a nuvem

O backend (Node/TS + PostgreSQL) participa do mesmo protocolo de replicação de eventos descrito acima, com duas diferenças práticas:

- **Transporte:** HTTPS/WebSocket pela internet, autenticado com uma credencial de terminal (emitida no momento do cadastro/pareamento do terminal com a conta do estabelecimento).
- **Papel:** cada terminal sincroniza com a nuvem **diretamente e de forma independente** quando tiver internet — não depende do host local para isso. Isso é importante operacionalmente: se o tablet do garçom tem Wi-Fi/dados e o PC do caixa não, os dados desse tablet ainda chegam à nuvem sem esperar o caixa se conectar.

O backend mantém sua própria camada de leitura materializada em PostgreSQL (mesma lógica de replay de eventos, só que agregando todos os terminais de todos os estabelecimentos), que alimenta:
- O endpoint de relatórios read-only (PRD Épico 6.2)
- A fonte de verdade dos limites de plano (PRD Épico 8)

**História 9.8 (revisado após reviewer adversarial): precisa de uma projeção Postgres NOVA, não é só "construir a tela".** A primeira versão deste documento assumia que 9.8 reaproveitava o endpoint `GET /reports/cash-register` (M11) sem nenhuma decisão nova — mas esse endpoint só agrega `orders`, de antes de `cash_session`/sangria/suprimento existirem. Um relatório consolidado de **caixa** (não só de vendas) precisa que o backend também replique os 4 eventos novos de §3.4 numa projeção Postgres própria, mesmo padrão da projeção de orders já existente desde o M9/M11 — sem isso, 9.8 não tem como mostrar abertura/fechamento/sangria/suprimento consolidados entre terminais, só o total de vendas (que já é o que o Épico 6 mostra por terminal individualmente).

**História 9.9** (exportação CSV) segue sem decisão de arquitetura nova: geração client-side a partir do `CashRegisterSummary`/dados de sessão já retornados por §3.4/3.5, sem impacto na camada de dados.

## 6. Enforcement de limites de plano (freemium)

- O backend é a **fonte de verdade** dos limites (`max_concurrent_orders`, `max_terminals`) por estabelecimento, guardados em uma tabela `planos`/`assinaturas` no Postgres.
- Cada terminal mantém uma **cópia local em cache** desses limites (atualizada a cada sync com a nuvem) e faz o enforcement **localmente e offline**, usando o valor em cache.
- Consequência aceita: se o dono faz upgrade de plano enquanto o terminal está offline, o novo limite só passa a valer no próximo sync — isso é esperado e aceitável (não é um requisito de tempo real).
- Downgrade com dados excedentes: conforme já decidido no PRD (§ 2.7), comandas já abertas não são bloqueadas retroativamente — a trava só impede novas aberturas até a contagem cair abaixo do limite.

## 7. Segurança

- **PIN de operador:** armazenado com hash (ex: bcrypt/argon2), nunca em texto plano — mesmo sendo um PIN curto, não há razão para guardá-lo reversível.
- **Servidor de sync LAN:** cada terminal expõe uma porta local para receber conexões de sync de outros terminais. Isso precisa de autenticação mínima (ex: um token compartilhado gerado no momento do pareamento entre terminais do mesmo estabelecimento) para impedir que qualquer dispositivo na rede Wi-Fi do bar (ex: celular de um cliente na mesma rede) consiga ler ou injetar eventos.
- **Sync com a nuvem:** HTTPS obrigatório; credencial de terminal com escopo limitado ao próprio estabelecimento (nunca acesso cross-tenant).

## 8. Estrutura de projeto sugerida (monorepo)

```
passa-a-regua/
  apps/
    desktop/           # Tauri + React + TS (UI)
      src-tauri/        # Rust: shell, IPC, gerenciamento do sidecar
      src/               # React/TS: telas de mesas, comandas, caixa
      sidecar/           # Node/TS: SQLite local, servidor de sync LAN, motor de eventos
    backend/            # Node + TS + PostgreSQL (API de sync + relatórios)
  packages/
    sync-engine/        # TS compartilhado: HLC, aplicação de eventos, regras de reconciliação
    shared-types/       # Tipos/schemas de eventos compartilhados entre desktop e backend
  docs/
    project-brief.md
    prd.md
    architecture.md
```

O pacote `sync-engine` é o coração técnico do projeto e deve ser desenvolvido com testes de propriedade (property-based testing) desde o início — reconciliação de eventos é exatamente o tipo de lógica onde bugs sutis só aparecem em cenários de concorrência raros.

## 9. Riscos técnicos e spikes recomendados antes de codar o MVP completo

Dado que esse é o componente de maior incerteza técnica do projeto, recomendo protótipos isolados (spikes de 1-3 dias cada) antes de comprometer o cronograma do MVP:

1. **Spike de sidecar Tauri:** validar que um processo Node embutido via Tauri sidecar consome, instala e atualiza de forma confiável em **Windows** (SO alvo de lançamento — ver § 10) — inclusive em ambientes sem Node instalado globalmente. Como o desenvolvimento acontece em macOS, o Tauri já suporta build cross-platform nativamente (macOS/Windows/Linux), mas o empacotamento do sidecar Node precisa de binário correto por plataforma (`tauri.conf.json` + target triples) — validar isso cedo evita surpresa só na hora de gerar o instalador Windows a partir do Mac.
2. **Spike de mDNS em redes de bar reais:** testar descoberta automática em pelo menos 2-3 redes Wi-Fi domésticas/comerciais típicas, já que roteadores de baixo custo têm suporte inconsistente a multicast.
3. **Spike de reconciliação:** simular o cenário do § 4.2 (duas comandas abertas na mesma mesa) com testes automatizados, validando que o merge determinístico realmente produz o mesmo estado final em qualquer ordem de chegada dos eventos.
4. Reafirma o item já registrado no PRD (Épico 7.4): cenários sintéticos de concorrência multi-terminal precisam existir no plano de QA antes do lançamento do plano pago.

## 10. Ambiente de desenvolvimento vs. plataforma de lançamento

- **SO alvo de lançamento: Windows** — confirmado como suposição de lançamento (não precisa de pesquisa formal), coerente com o mercado de PDV para pequeno negócio no Brasil (SAIPOS, Consumer etc. também miram Windows, que já vem nos PCs vendidos para esse público).
- **Ambiente de desenvolvimento: macOS.** Tauri suporta build cross-platform nativamente, então isso não bloqueia o desenvolvimento — mas exige atenção ao empacotamento do sidecar Node por plataforma (ver spike 1, § 9) e testes periódicos em Windows real antes de cada release, não só builds locais no Mac.

~~Merge automático e silencioso para comandas conflitantes~~ — **resolvido** (§ 4.2): merge automático mantido (não bloqueia o operador), mas passa a gerar uma notificação visível e não bloqueante no terminal afetado, além do registro de auditoria completo.

## 11. Próximos passos

Épicos 1-8 do PRD (M0-M12) estão todos implementados e validados em uso real — os spikes da seção 9 e o handoff inicial pro pacote `sync-engine`/Épico 1, registrados aqui originalmente, já aconteceram.

Próximo passo: **Épico 9 (Evolução do Fluxo de Caixa)**, com as decisões de arquitetura já registradas em §3.4/3.5/4.4 (passaram por uma rodada de revisão adversarial que corrigiu o escopo do invariante de sessão de 9.1/9.2 e o de 9.8 — ver `.memlog.md` do workspace de arquitetura pra o histórico completo). Antes de codar:

1. Confirmar com o dono o `[ASSUMPTION]` de §3.4 (o que a UI mostra quando `expectedAmountCents` muda depois do fechamento da sessão, por causa de um pedido em dinheiro que sincronizou atrasado).
2. Decisão de UI pendente do §4.4: tela de conflitos de sessão de caixa é a mesma de "Conflitos de Mesas" ou uma tela irmã.
3. `bmad-create-epics-and-stories` (ou detalhamento equivalente) pra quebrar as 9 histórias já escritas no PRD em tarefas de implementação, citando as decisões desta seção onde a história depende de uma delas.
4. Implementação seguindo a ordem de prioridade já definida no PRD (9.1/9.2 → 9.3 → 9.4/9.5 → 9.6 → 9.7 → 9.8 → 9.9).
