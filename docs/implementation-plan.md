# Plano de Implementação — Passa a Régua

**Fase:** Implementação (BMAD — Dev)
**Data:** 2026-09-21
**Baseado em:** `docs/prd.md`, `docs/architecture.md`
**Status:** Roadmap sequenciado por dependência técnica, pronto para início de desenvolvimento

---

## Como ler este documento

A ordem aqui **não segue a numeração dos épicos do PRD** — segue a ordem em que as coisas precisam existir para as próximas funcionarem. Cada task referencia a história do PRD (`PRD 2.3`) ou a seção da arquitetura (`ARCH §3`) de onde vem. Marque `[x]` conforme for concluindo — este arquivo é para ser editado ao longo do projeto, não é um artefato congelado.

---

## M0 — Spikes técnicos (antes de qualquer código de produto)

Objetivo: eliminar as maiores incertezas técnicas antes de comprometer tempo em features. Referência: `ARCH §9`.

- [x] Spike 1 (completo — ver `docs/spikes/spike-1-sidecar.md`): processo sidecar Node empacotado via SEA, spawnado por um app Tauri mínimo — **validado em macOS/arm64** (build, spawn automático pelo Tauri e resposta HTTP confirmados via `curl`, com confirmação visual) **e em Windows real** (via CI, runner `windows-latest`, ver `.github/workflows/spike1-windows-validation.yml`): sidecar respondeu `/health` e o instalador Tauri completo (`.msi`/`.exe`) foi gerado com sucesso. Armadilhas encontradas e resolvidas: binário Node universal do macOS duplicava o sentinel do SEA (`lipo -thin`); `execFileSync`/`spawnSync` não roda `.cmd`/`.bat` (`npx`) sem `shell:true` no Windows — resolvido invocando o CLI do `postject` direto via `node`, sem depender de shell.
- [x] Spike 2 (ver `docs/spikes/spike-2-mdns.md`): descoberta mDNS entre dois processos na mesma rede Wi-Fi, testado em 2 redes diferentes — **validado**: Mac (`anunciar`) descoberto por um iPhone 12 rodando um app de Bonjour/DNS-SD Browser, tanto na rede Wi-Fi de casa quanto no hotspot pessoal do iPhone (confirmado sem ambiguidade: IP mudou pra faixa `172.20.10.x` e timestamp de início renovado ao reiniciar o processo já na nova rede). Nenhum prompt de firewall necessário em nenhuma das duas redes.
- [x] Spike 3 (ver `docs/spikes/spike-3-reconciliation.md`): protótipo isolado do HLC + regra de conflito de comanda duplicada (`ARCH §4.2`) — **validado**: 12 testes (unitários + 3 propriedades com ~1300 execuções aleatórias combinadas) cobrindo diferentes ordens de chegada, idempotência e particionamento de logs. Achado: testes de propriedade sozinhos não bastam para travar regras de negócio específicas (só pegam bugs de ordenação) — manter também testes literais dos cenários do PRD/ARCH no M1.

**Critério de saída do M0:** ✅ atingido em 2026-09-20 — os 3 spikes rodam de forma independente e nenhum exigiu replanejamento de arquitetura. Próximo: M1.

---

## M1 — Fundação: monorepo + sync-engine

Objetivo: ter o pacote `sync-engine` funcional e testado isoladamente, antes de conectá-lo a qualquer UI. Referência: `ARCH §3, §8`.

- [x] Setup do monorepo: `packages/shared-types` e `packages/sync-engine` criados como membros do workspace npm já existente (mesmo workspace usado pelo `apps/desktop` desde o Spike 1 — sem trocar pra pnpm/Turborepo, não havia necessidade real). `apps/backend` fica de fato criado só no M9, quando existir código pra colocar nele.
- [x] `shared-types`: tipos + schemas Zod (discriminated union por `type`) dos 8 eventos — `operator_registered`, `order_opened`, `order_transferred`, `tables_grouped`, `item_added`, `item_canceled`, `order_closed`, `payment_recorded`. Validações do PRD embutidas no schema (motivo de cancelamento da lista fechada, valores em centavos sempre inteiros, origem mesa/avulsa mutuamente exclusiva).
- [x] `sync-engine`: HLC portado do `spikes/spike-3-reconciliation/` (mesma implementação já validada) com testes unitários + de propriedade.
- [x] `sync-engine`: schema SQLite da tabela `events` + camada de acesso (`insertEvent`/`insertEvents` idempotentes por id, `listEventsSinceCursor`, `findEventsByAggregateId`) — via `node:sqlite` (embutido no Node, decisão deliberada pra não reintroduzir dependência nativa compilada por plataforma depois do que o Spike 1 validou).
- [x] `sync-engine`: motor de projeção (`project`) — recebe eventos ordenados por HLC, devolve estado materializado de todos os 8 tipos.
- [x] `sync-engine`: reconciliação (`merge`/`reconcile`) — dedupe por `id`, reordenação por HLC, regra de conflito de order duplicada do `ARCH §4.2` generalizada do spike pro modelo de evento completo.
- [x] Suite de testes de propriedade (fast-check, ~1300 execuções): comutatividade, idempotência e particionamento de log — mesmo padrão validado no Spike 3.

**Critério de saída do M1:** ✅ atingido em 2026-09-20 — 27 testes (`shared-types` + `sync-engine`) passando, `sync-engine` funciona 100% em memória (`node:sqlite` com `:memory:` nos testes) e via CLI/Node puro, zero dependência de Tauri ou rede. Achado real ao construir: `node:sqlite` não trata `TEXT PRIMARY KEY` como `NOT NULL` implícito, e `INSERT OR IGNORE` ignora silenciosamente qualquer violação de constraint (não só duplicata de id) — documentado em `packages/sync-engine/src/db.ts`.

---

## M2 — Esqueleto do app desktop

Objetivo: Tauri + sidecar + React conversando entre si, sem nenhuma feature de produto ainda.

- [x] Scaffold do app Tauri (`apps/desktop`) com sidecar Node/TS embutido (usando o `sync-engine` como dependência) — `@passa-a-regua/sync-engine` e `@passa-a-regua/shared-types` adicionados como deps do sidecar via workspace npm; build passou de `tsc` puro pra `esbuild` (bundle) + `build-sea.mjs`, já que o SEA precisa de um único arquivo (o `tsc` sozinho não resolve os `imports` de outros pacotes do workspace).
- [x] Canal de IPC entre webview (React) e sidecar — API HTTP local em `127.0.0.1:4550`: `POST /events` (valida com `DomainEventSchema` do `shared-types`, insere via `insertEvent`), `GET /events?since=` (lista via `listEventsSinceCursor`), `GET /state` (projeção via `project`/`sortEvents`).
- [x] Inicialização do SQLite local no primeiro start do sidecar — `openDatabase` chamado no boot, caminho lido de `PASSA_A_REGUA_DATA_DIR` (setado pelo Tauri) com fallback pra `./.dev-data` em dev fora do Tauri.
- [x] Layout base da UI (roteamento entre telas: login, mapa de mesas, comanda, caixa) — `react-router-dom` (`HashRouter`, necessário porque o protocolo de asset do Tauri não tem servidor por trás pra resolver History API em reload/deep-link), shell com nav em `layout.tsx`, 4 telas placeholder em `src/routes/`, sem lógica de negócio.

**Critério de saída do M2:** ✅ atingido em 2026-09-20 — validado manualmente (bundle esbuild + binário SEA real) que o sidecar sobe, inicializa o SQLite e responde `/health`, `/events` (POST+GET) e `/state` corretamente; e a partir da própria tela React (hook `useSidecarIpcCheck` em `lib/sidecar.ts`, exibido como badge "IPC ok" no header) um evento de teste é escrito e lido de volta via IPC a cada carregamento do app — round-trip idempotente por id, não duplica no banco. Suite de testes (`shared-types` + `sync-engine`, 27 testes) e build de todos os workspaces seguem passando. Nomenclatura de todo o código (arquivos, tipos, funções, eventos) traduzida de português pra inglês nesta etapa, incluindo M0/M1 e os protótipos dos spikes — ver decisão registrada abaixo.

---

## M3 — Épico 1: Autenticação e Operadores

Referência: `PRD Épico 1`.

- [x] Evento `operator_registered` + projeção da tabela `operators` (nome, papel, hash do PIN) — já existia desde o M1; M3 acrescentou o hashing de verdade (`packages/sync-engine/src/auth.ts`, `hashPin`/`verifyPin` via `node:crypto` scrypt em vez de bcrypt/argon2 — mesma decisão de fundo do `node:sqlite` em `db.ts`: evitar dependência nativa compilada por plataforma, que quebraria o binário SEA standalone do Spike 1).
- [x] Tela de cadastro de operador (dono) — PRD 1.1. Uma única tela (`routes/operator-registration.tsx`) serve dois casos: bootstrap (nenhum operador existe, ninguém logado, cria-se o primeiro dono) e uso normal (dono logado cadastra mais gente) — o sidecar decide qual caso vale.
- [x] Fluxo de login por PIN, validação local contra hash — PRD 1.2. Teclado numérico (`routes/login.tsx`), `POST /session/login` verifica o PIN contra o hash de cada operador.
- [x] Sessão de terminal (persistida até logout/troca de operador, sem expiração automática) — `session.json` no `dataDir` do sidecar (não em memória), testado explicitamente sobrevivendo a reload da página/app.
- [x] Enforcement de permissões por papel na navegação (garçom não acessa Caixa/cadastro de operador) — `PRD §2`. `RequireSession`/`RequireRole` (`route-guards.tsx`) bloqueiam rota e redirecionam; nav (`layout.tsx`) já esconde os links pro papel errado. Enforcement é só de navegação (UI), não uma camada de autorização de servidor completa — a revisão de segurança fica pro M12, mas o backend do M3 já faz uma checagem básica (só dono cria operador, exceto no bootstrap).
- [x] Estrutura de log de auditoria (genérica, reaproveitável pelo cancelamento no M6) — evento append-only vinculado a `operator_id`. Não precisou de estrutura nova: todo evento já carrega `operatorId`+`hlc`+`id` desde o M1; só faltava expor a consulta, feito via `GET /events?aggregateId=` (usa `findEventsByAggregateId`, já existente no `sync-engine`).

**Critério de saída do M3:** ✅ atingido em 2026-09-20 — validado de ponta a ponta no browser: bootstrap sem operador nenhum → cadastro do primeiro dono → login por PIN → nav mostra Mapa de Mesas/Caixa/Cadastrar operador; logout → cadastro de um garçom (só permitido logado como dono) → login como garçom → nav esconde Caixa e Cadastrar operador → acesso direto via URL a `/cash-register` e `/operators/new` redireciona/bloqueia corretamente → sessão sobrevive a reload de página. `GET /state` nunca expõe `pinHash` (achado corrigido durante o teste manual — só o log de eventos bruto, usado pra sync, carrega o hash). Suite de testes (33 no total: `shared-types`+`sync-engine`, incluindo os novos testes de `auth.ts`) e build de todos os workspaces, incluindo o binário SEA real, seguem passando.

---

## M4 — Épico 3: Cadastro de Produtos e Cardápio

Referência: `PRD Épico 3`. Precisa vir antes do lançamento de pedidos (M6), que depende de produtos existirem.

- [x] Evento/projeção de categorias — PRD 3.1. Evento `category_registered`, projeção em `categories`.
- [x] Evento/projeção de produtos (nome, preço, categoria, status ativo/inativo) — PRD 3.2. Evento `product_registered` (cadastro) + `product_status_changed` (ativar/desativar depois — nunca reescreve o evento de cadastro original, append-only como o resto do log). Item denormalizado em `item_added` (M6) continua não referenciando `productId`: o preço da venda não pode mudar retroativamente se o produto for editado depois.
- [x] Telas de cadastro (dono) de categorias e produtos — `routes/catalog.tsx`, rota `/catalog` (owner-only via `RequireRole`), formulários de categoria e produto + tabela de produtos com botão ativar/desativar.
- [x] Tela de busca de produto por nome/categoria (usada depois pelo garçom no M6) — PRD 3.3. Componente reutilizável `product-search.tsx` (filtro client-side sobre `/state`, só produtos ativos), já embutido na tela de comanda placeholder (`routes/order.tsx`) como preview — o "adicionar à comanda" em si continua sendo escopo do M6.

**Critério de saída do M4:** ✅ atingido em 2026-09-21 — validado via API isolada (registro de categoria, registro de produto com categoria inválida rejeitada, ativar/desativar, enforcement de permissão — garçom recebe 403 tentando cadastrar) e visualmente na tela `/catalog` de uma sessão real do app (estados vazios, validação "cadastre uma categoria antes de adicionar produtos"). 37 testes passando (7 novos: 1 de schema + 4 de projeção de catálogo + 2 herdados do rebuild), build de todos os workspaces incluindo o binário SEA seguem passando. Sidecar ganhou um override `PASSA_A_REGUA_PORT` (default 4550 inalterado) pra permitir rodar instâncias isoladas de teste sem risco de colidir com uma sessão já rodando — achado ao errar exatamente essa colisão durante o teste manual deste milestone.

---

## M5 — Épico 2: Mesas e Comandas

Referência: `PRD Épico 2`.

- [x] Evento/projeção de mesas (cadastro) — PRD 2.1. Evento `table_registered` (dono, `POST /tables`), projeção em `tables`.
- [x] Abrir comanda vinculada a mesa, com invariante local "1 comanda aberta por mesa" — PRD 2.2. `POST /orders` checa `isTableFree` antes de criar o `order_opened` — invariante é só deste terminal; o conflito entre terminais offline continua resolvido pelo merge automático do ARCH §4.2.
- [x] Abrir comanda avulsa (numeração sequencial, sem `table_id`) — PRD 2.3. Número calculado no sidecar (`max` dos números avulsos já usados + 1), nunca reaproveitado.
- [x] Tela de mapa de mesas + lista de comandas abertas (mesa + avulsa) — PRD 2.4. `routes/table-map.tsx`: cadastro de mesa (dono), status livre/ocupada por mesa, lista de comandas avulsas abertas.
- [x] Transferência de comanda entre mesas (evento `order_transferred`, mantendo histórico) — PRD 2.5. `POST /orders/:id/transfer` valida: comanda aberta e não mesclada, tem mesa atual, mesa de destino existe e está livre.
- [x] Junção visual de mesas (`tables_grouped`), sem mesclar dados de comanda — PRD 2.6. `POST /table-groups`, seleção por checkbox na tela de mapa.
- [x] Enforcement do limite de 10 comandas simultâneas (contagem local mesa+avulsa) — PRD 2.7. `MAX_CONCURRENT_ORDERS = 10` fixo no sidecar; leitura do valor real do plano via backend fica pro M9 como já planejado.

**Critério de saída do M5:** ✅ atingido em 2026-09-21 — validado via API isolada (porta de teste separada, processo com PID rastreado): cadastro de mesa, invariante "1 comanda por mesa" rejeitando a 2ª tentativa (409), numeração avulsa sequencial (1, 2, ...), transferência liberando a mesa de origem pra nova comanda, junção de mesas, e o limite de 10 rejeitando exatamente a 11ª comanda aberta. 40 testes passando.

Dois achados durante o teste manual na sessão real do app (não no isolado): (1) os hooks `useCatalog`/`useTablesAndOrders` não tinham fallback pra campos ausentes em `GET /state` — como o sidecar não reinicia sozinho quando o frontend recebe HMR, testar a tela nova contra um binário de sidecar de uma versão anterior gerava `TypeError` e tela em branco; agora todos os campos novos caem em `[]` se ausentes. (2) O diagnóstico de IPC do M2 (`useSidecarIpcCheck`, badge "IPC ok") escrevia um evento `tables_grouped` real e permanente no banco pra provar o roundtrip — hoje isso já é comprovado de sobra pelas telas de negócio reais (M3-M5), então o diagnóstico foi removido; o registro fantasma que ele deixou nos bancos já existentes (incluindo o de teste manual do usuário) não pode ser apagado por ser append-only, mas não afeta nada além de aparecer como um grupo de mesas com nomes vazios.

---

## M6 — Épico 4: Lançamento de Pedidos

Referência: `PRD Épico 4`. Depende de M4 (produtos) e M5 (comandas).

- [x] Adicionar item a uma comanda aberta (evento `item_added`) — PRD 4.1. `POST /orders/:id/items` recebe `productId`+`quantity`+`note` opcional, busca nome/preço do produto no servidor (nunca confia em preço vindo do cliente) e recusa produto inativo — reforça server-side o filtro que o `ProductSearch` (M4) já faz na UI.
- [x] Observação por item (ex: "sem cebola") — PRD 4.2. Campo `note` do `item_added`, já suportado desde o schema do M1.
- [x] Cancelamento de item com motivo obrigatório (lista pré-definida + "outro"), gerando evento de auditoria — PRD 4.3, ligado ao log do M3. `POST /orders/:id/items/:itemId/cancel`, só caixa/dono (garçom recebe 403 — `PRD §2`), motivo "outro" exige observação. Achado corrigido durante a implementação: a observação do cancelamento não estava sendo projetada em `ItemState` (só o motivo) — `cancelNote` adicionado ao `sync-engine` antes de UI nenhuma depender disso.

**Critério de saída do M6:** ✅ atingido em 2026-09-21 — validado via API isolada: item adicionado com nome/preço vindos do servidor, produto inativo rejeitado, garçom bloqueado de cancelar (403), motivo "outro" sem observação rejeitado (400) e aceito com observação. Tela de comanda (`routes/order.tsx`) já mostra a lista de itens com subtotal corrente, formulário de adicionar (via `ProductSearch` com `onSelect`) e cancelamento com seletor de motivo — validado sem quebrar mesmo contra um sidecar de versão anterior (fallback defensivo já herdado do M5). 42 testes passando.

---

## M7 — Épico 5: Fechamento de Comanda

Referência: `PRD Épico 5`. Depende de M6.

- [x] Cálculo de subtotal + taxa de serviço (default 10%, configurável por estabelecimento, ajustável/isentável por comanda) — PRD 5.1. Novo evento `establishment_settings_updated` (singleton, `aggregateId` fixo `ESTABLISHMENT_ID`), projeção com default `DEFAULT_SERVICE_FEE_PERCENT = 10` quando nenhum evento existe ainda. `POST /establishment/settings` (dono). A taxa aplicada no fechamento de cada comanda é sempre a escolhida naquele momento (pode divergir do default, isentar = 0), nunca reescreve o default global.
- [x] Valores monetários em centavos (inteiro) em toda a stack — PRD NFR7. Já valia desde o M1 nos schemas; M7 só reforça em `computeSubtotalCents`/cálculo de taxa (`Math.round`) no sidecar.
- [x] Split igual (N partes, resto determinístico na primeira parcela) — PRD 5.2. `distributeEqually` no sidecar e um espelho client-side só pra pré-popular a UI — o servidor sempre recalcula e valida de novo, nunca confia no split vindo do cliente.
- [x] Split manual (soma exata obrigatória, UI mostra quanto falta/sobra, botão desabilitado até bater) — PRD 5.2. `parseSplits` rejeita qualquer soma diferente do total, sem tolerância; UI (`order-closing.tsx`) mostra "falta/sobra" ao vivo e desabilita "Confirmar fechamento" até bater exato.
- [x] Registro de forma de pagamento por parte do split (dinheiro/cartão manual) — PRD 5.3. Um `payment_recorded` por parte.
- [x] Cálculo de troco (só sobre a parte em dinheiro) — PRD 5.4. `cashReceivedCents` obrigatório (>= valor da parte) só pra partes em dinheiro; cartão sempre `changeCents: 0`.
- [x] Fechamento da comanda (evento `order_closed`, imutabilidade pós-fechamento) — PRD 5.5. `POST /orders/:id/close` bloqueia lançar item, cancelar item e fechar de novo numa comanda já fechada (409). Só caixa/dono (garçom recebe 403).
- [x] Fechamento conjunto de mesas agrupadas (M5) numa única operação de pagamento — PRD 5.2. `POST /orders/:id/close-group` valida que as mesas envolvidas estão de fato no mesmo grupo visual (M5) e nenhuma é avulsa; distribui a taxa de serviço combinada e cada parte do split proporcionalmente ao subtotal/total de cada comanda (resto determinístico na primeira, mesmo princípio do split igual) — gera um `order_closed` + N `payment_recorded` por comanda, nunca mescla os dados históricos entre elas.

**Critério de saída do M7:** ✅ atingido em 2026-09-21 — validado via API isolada (fechamento individual com split manual dinheiro+cartão e cálculo de troco correto, imutabilidade pós-fechamento, garçom bloqueado, fechamento conjunto rejeitando mesas não agrupadas/avulsas, taxa de serviço padrão configurável) **e visualmente na UI real** (`order-closing.tsx`, num Vite+sidecar isolados só pra este teste — nunca na sessão do usuário): fechamento individual com split de 3 partes iguais + uma em dinheiro, e fechamento conjunto de 2 mesas agrupadas, ambos confirmados batendo com o estado final no banco. Achado corrigido durante esse teste visual, antes de reportar como pronto: ao marcar "fechar mesas juntas", o resumo (subtotal/taxa/total) continuava mostrando só os números da comanda individual, não os combinados — o split bateria certinho no cliente mas seria rejeitado pelo servidor (que sempre calcula em cima do total combinado real). Corrigido buscando o subtotal combinado das comandas do grupo assim que a opção é marcada. 46 testes passando.

---

## M8 — Épico 6: Fechamento de Caixa (local)

Referência: `PRD Épico 6.1`. Depende de M7.

- [x] Cálculo do resumo do dia a partir da projeção local (total vendido, total por forma de pagamento, comandas fechadas vs. pendentes) — PRD 6.1. `GET /cash-register/summary?date=` (default hoje, no fuso local da máquina — sidecar roda na mesma máquina do usuário). Sem evento novo: é um cálculo puro sobre `orders`/`payments` já existentes, agrupado pelo `closedAt` do `order_closed` (campo novo em `ClosingState`, projetado do `createdAt` do evento). "Total por forma de pagamento" soma `amountCents` das partes (nunca o troco — troco volta pro cliente, não é receita).
- [x] Tela de fechamento de caixa (dono/caixa) — `routes/cash-register.tsx` substitui o placeholder do M2: resumo do dia, total por forma de pagamento, lista de comandas pendentes (nunca entram no total fechado, PRD 6.1) com link direto pra cada uma.

**Critério de saída do M8:** ✅ atingido em 2026-09-21 — validado via API isolada (resumo zerado sem comandas, resumo correto com 2 fechadas + 1 pendente, filtro por data sem fechamento no dia zera o total mas mantém as pendentes) e visualmente na UI real (Vite+sidecar isolados, nunca na sessão do usuário). 46 testes passando. **O MVP funcional em um único terminal, 100% offline, está completo.**

**M8 é um checkpoint de ir/não ir, não só um marco de demo.** Antes de investir no M9 (o milestone de maior risco técnico do projeto), vale usar esse ponto para validar a tese central do produto: o fluxo single-terminal (mesas, comandas, cardápio, fechamento) já resolve o problema de verdade para um bar pequeno como o do cliente-zero? Se a reação real ao produto funcionando aqui não convencer ninguém a querer usar, é muito mais barato descobrir isso agora do que depois de construir sync LAN inteiro. Recomenda-se uma demo real com o cliente-zero neste ponto antes de seguir para o M9.

---

## M9 — Sync LAN + Backend + Sync com a nuvem

Referência: `PRD Épico 7`, `ARCH §2, §5`. Este é o milestone de maior risco técnico do projeto — o M0/M1 deveriam ter reduzido boa parte da incerteza antes de chegar aqui.

- [x] Backend (`apps/backend`): API de ingestão de eventos (recebe lote de eventos de um terminal, autenticado por credencial de terminal). `POST /sync/push` — autenticado via header `Authorization: Bearer <terminalId>:<segredo>` (`authenticateTerminal`), valida cada evento com `DomainEventSchema`, insere via `insertEvents` (idempotente por `id`, `ON CONFLICT DO NOTHING`), reprojeta só se algo novo foi inserido.
- [x] Backend: projeção materializada em PostgreSQL (mesmo motor de `aplicarEvento` do `sync-engine`, reaproveitado). Toda a `ProjectedState` guardada como um único JSONB por estabelecimento (tabela `projections`) em vez de mapeada pra um schema relacional normalizado — decisão deliberada: sem consumidor real da forma normalizada até o endpoint de relatório do M11, o esforço de modelar isso agora não se paga. `project(sortEvents(...))` é literalmente a mesma função usada no sidecar local — confirmado no smoke test que o backend calcula exatamente a mesma projeção.
- [x] Backend: cadastro/pareamento de terminal (emissão de credencial vinculada ao estabelecimento). `POST /register` (bootstrap, sem auth por definição — é assim que a credencial nasce) cria estabelecimento + terminal e devolve a credencial. Escolha do usuário: auto-cadastro no primeiro sync, sem tela de login web no MVP.
- [x] Sidecar: servidor de sync LAN (aceita conexões de outros terminais, autenticado por token de pareamento local) — `ARCH §2, §7`. `POST`/`GET /sync/events`, autenticado por `requireLanToken` (token compartilhado gerado em `lan-pairing.ts`, nunca trafega pela rede — só copiado manualmente entre terminais na tela de Pareamento).
- [x] Sidecar: integração de descoberta mDNS (reaproveitando o Spike 2 do M0) + fallback de IP manual. `discovery.ts` (publica + descobre via `bonjour-service`) e `manual-host.ts` (IP/porta configurados manualmente quando a rede bloqueia multicast). `bonjour-service` empacota sem problema no bundle esbuild do binário SEA (validado).
- [x] Sidecar: cliente de sync — tenta host primeiro, cai para qualquer peer alcançável se host estiver fora — `ARCH §2, item 3`. `lan-sync-client.ts`: ciclo de 5s, alvo = host manual (se configurado) + peers mDNS descobertos, na ordem, parando no primeiro sucesso (push de tudo + pull de tudo, sem cursor incremental — idempotente e simples o bastante pro volume de eventos de um bar, tradeoff aceito de propósito).
- [x] Sidecar: cliente de sync com a nuvem, independente do sync LAN (`ARCH §5`). `cloud-sync-client.ts`, ciclo próprio de 5s, credencial persistida em `cloud-credential.json`. **Achado durante o teste do M9 (não estava no plano original):** dois terminais pareados na LAN, cada um se autocadastrando na nuvem de forma independente, viravam DOIS estabelecimentos separados no backend — o pareamento local não implicava o mesmo estabelecimento na nuvem. Corrigido com um mecanismo de "patrocínio": um terminal já registrado responde por `POST /sync/sponsor-cloud-registration` (autenticado pelo token LAN) chamando o novo endpoint do backend `POST /terminals` (autenticado pela credencial do patrocinador) pra cadastrar o peer sob o MESMO `establishmentId`; só quando nenhum peer consegue patrocinar (nenhum peer configurado, ou nenhum peer ainda tem credencial própria) o terminal se autocadastra como âncora. Colisão residual (os dois terminais sobem juntos, nenhum tem credencial ainda no mesmo ciclo) mitigada com um jitter probabilístico (20% de chance de virar âncora por ciclo, em vez de sempre) — resolve em poucos ciclos sem coordenação central. Validado end-to-end: mesmo `establishmentId` em ambos os terminais após o pareamento.
- [x] UI: notificação visível e não bloqueante quando um merge automático de conflito acontece no terminal (`ARCH §4.2`, decisão de não deixar silencioso). Banner no `layout.tsx` (`useMergeWarnings`, polling de `/state`), com detalhe expansível por mesa. Testado visualmente injetando dois `order_opened` conflitantes pra mesma mesa via evento direto — banner aparece, detalhe mostra a mesa certa, some quando não há mais merge pendente.
- [x] Tela de Pareamento (`routes/pairing.tsx`, owner-only, com modo bootstrap pra terminal novo sem operador nenhum — mesmo padrão dos dois modos de `operator-registration.tsx`): mostrar/copiar o token deste terminal, adotar o token de outro, configurar/remover host manual. **Achado durante o teste (não estava no plano original):** os endpoints de pareamento (`GET/POST /pairing/lan-token`, `GET/POST/DELETE /pairing/manual-host`) exigiam dono logado, mas um terminal novo não tem NENHUM operador até sincronizar — trava circular (não dá pra parear sem dono, não dá pra ter dono sem parear). Corrigido com a mesma exceção de bootstrap do `POST /operators`: liberado sem sessão só enquanto o terminal não tem nenhum operador (`requireOwnerOrBootstrap`).

**Critério de saída do M9:** ✅ atingido em 2026-09-21 — validado com dois terminais isolados (portas alternativas, nunca a sessão real do usuário) + backend real contra Postgres via Docker Compose: (1) sync LAN bidirecional confirmado (evento criado no terminal A aparece no B em ~5s e vice-versa); (2) sync com a nuvem confirmado, incluindo o patrocínio de cadastro fazendo os dois terminais convergirem pro mesmo `establishmentId`; (3) queda do "host" testada explicitamente — terminal A derrubado (kill do PID capturado na subida, nunca por lookup de porta), terminal B continuou respondendo, aceitando novas operações locais e sincronizando com a nuvem normalmente, sem travar nem logar erro. Typecheck limpo em `backend`, `sidecar` e `desktop`; 46 testes de unidade existentes (`shared-types`+`sync-engine`) continuam passando sem regressão; UI de Pareamento e banner de merge testados visualmente via Vite+sidecar isolados.

---

## M10 — Épico 8: Freemium e Gestão de Plano

Referência: `PRD Épico 8`, `ARCH §6`. Depende de M9 (precisa do backend e do sync).

- [x] Backend: tabela de planos/assinaturas (`max_concurrent_orders`, `max_terminals`). Decisão deliberada: em vez de uma tabela `plans` separada, os limites ficam como colunas em `establishments` (já existiam desde o M9, com os defaults do plano free — `max_concurrent_orders=10`, `max_terminals=1`) — não há tiers nomeados nem cobrança no MVP, só o valor efetivo por estabelecimento; uma tabela de planos à parte seria estrutura sem consumidor. Configurável sem novo deploy (PRD 8.3): é um `UPDATE` direto no Postgres, validado no teste (`getEstablishmentPlan`/`countTerminals` novos em `db.ts`).
- [x] Sidecar: cache local do plano, atualizado a cada sync com a nuvem. `plan-cache.ts` (`plan-cache.json` no `dataDir`), atualizado ao fim de cada ciclo bem-sucedido de `cloud-sync-client.ts` via `GET /sync/plan` (novo endpoint, autenticado). Antes do primeiro sync (ou sem internet nunca), usa os mesmos defaults do plano free (NFR1 — precisa funcionar 100% offline mesmo sem nunca ter sincronizado).
- [x] Enforcement real de limite de terminais (bloqueio de 2º terminal no free) — substitui o valor fixo usado provisoriamente no M5. Aplicado no ponto exato onde um terminal se junta a um estabelecimento existente: `POST /terminals` (o endpoint de patrocínio de cadastro do M9) agora conta os terminais já registrados (`countTerminals`) e rejeita com 403 + mensagem de upgrade se o plano já está no limite — PRD 8.1 literal ("mensagem clara de upgrade").
- [x] Enforcement de limite de comandas usando o valor vindo do plano (não mais hardcoded). `POST /orders` no sidecar troca o `MAX_CONCURRENT_ORDERS = 10` fixo por `maxConcurrentOrders()`, que lê o cache local do plano.

**Dois achados durante o teste deste milestone (não estavam no plano original), ambos corrigidos no mesmo commit:**
1. O sidecar do M9 colapsava qualquer falha do patrocínio de cadastro num 502 genérico — a rota `/sync/sponsor-cloud-registration` agora repassa o status e a mensagem reais do backend (incluindo o novo 403 de limite de plano) pro terminal que pediu o patrocínio, que precisa distinguir "bloqueio definitivo do plano" (não deve virar âncora de um estabelecimento novo pra contornar o limite) de "erro transitório" (peer ainda sem credencial, rede fora, etc. — aí sim pode cair no autocadastro). Mensagem persistida em `registration-status.ts` e exposta via `GET /pairing/cloud-status`, mostrada na tela de Pareamento.
2. Um terminal recém-instalado, sem nenhum operador ainda, começava a tentar se autocadastrar na nuvem assim que o sidecar subia — se isso acontecesse antes do dono abrir a tela de Pareamento e adotar o token de um terminal já existente, o terminal novo virava âncora de um estabelecimento separado por pura corrida de tempo (reproduzido no teste isolado: bootstrap + pareamento manual às vezes não venciam a corrida contra o primeiro ciclo de cloud-sync). Corrigido condicionando o início do cloud-sync a este terminal já ter pelo menos um operador local (via bootstrap OU via sync LAN trazendo os operadores de quem ele pareou) — a mesma decisão que a tela de Login já oferece ("cadastrar o primeiro operador" vs. "parear com outro terminal").

**Validado em 2026-09-21** com dois terminais isolados + backend real contra Postgres (mesma infra de teste do M9): sob os defaults do plano free (`max_terminals=1`), o 2º terminal pareado ficou de fato bloqueado com a mensagem de upgrade (`GET /pairing/cloud-status`) enquanto o 1º seguiu conectado; subir `max_terminals` pra 2 via `UPDATE` direto no Postgres (sem redeploy) liberou o terminal bloqueado automaticamente no ciclo seguinte, com o mesmo `establishmentId` de quem já estava conectado; baixar `max_concurrent_orders` pra 2 via o mesmo `UPDATE` fez a 3ª comanda aberta ser rejeitada com a mensagem do plano, substituindo de fato o limite fixo de 10. Typecheck limpo em `backend`/`sidecar`/`desktop`; 46 testes existentes sem regressão; status de nuvem na tela de Pareamento conferido visualmente.

---

## M11 — Épico 6.2: Endpoint de relatórios read-only

Referência: `PRD 6.2`, `ARCH §5`. Pode ser feito em paralelo ao M10, já que ambos dependem só do backend estar de pé (M9).

- [ ] Endpoint read-only no backend consultando a projeção PostgreSQL (ex: fechamento do dia por estabelecimento).
- [ ] Sem tela associada no MVP — validação de "pronto" é o endpoint responder corretamente, conforme decidido no PRD.

---

## M12 — QA de concorrência e hardening

Referência: `PRD 7.4`, `ARCH §9, item 4`.

- [ ] Cenários sintéticos de concorrência multi-terminal (2+ terminais lançando pedido na mesma mesa simultaneamente, incluindo o caso de conflito do `ARCH §4.2`).
- [ ] Revisão de segurança: hashing de PIN, autenticação do servidor de sync LAN, HTTPS/credenciais do sync com a nuvem — `ARCH §7`.
- [ ] Teste de empacotamento/instalação em Windows real (não só build local no Mac) — `ARCH §10`.

---

## Notas de sequenciamento

- **M0 e M1 são inegociáveis primeiro** — construir telas antes de validar o motor de sync/reconciliação é o caminho mais provável para retrabalho caro depois.
- **M3 e M4 podem ser feitos em qualquer ordem entre si** (não há dependência direta), mas ambos precisam vir antes do M6.
- **M9 é o milestone que valida a arquitetura mais arriscada do projeto** — vale considerar uma demo interna com 2 terminais reais (não só emulador) antes de seguir para M10/M11.
- Este plano assume desenvolvimento solo sequencial. Se em algum momento houver mais de uma pessoa, M3/M4 e partes de M11 são candidatos naturais a paralelização, já que têm baixo acoplamento com o núcleo de sync.
