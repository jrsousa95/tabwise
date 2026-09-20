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

- [ ] Evento `operator_registered` + projeção da tabela `operators` (nome, papel, hash do PIN).
- [ ] Tela de cadastro de operador (dono) — PRD 1.1.
- [ ] Fluxo de login por PIN, validação local contra hash (bcrypt/argon2) — PRD 1.2.
- [ ] Sessão de terminal (persistida até logout/troca de operador, sem expiração automática — decisão já registrada em `PRD 1.2`).
- [ ] Enforcement de permissões por papel na navegação (garçom não acessa configurações/fechamento de caixa) — `PRD §2`.
- [ ] Estrutura de log de auditoria (genérica, reaproveitável pelo cancelamento no M6) — evento append-only vinculado a `operator_id`.

**Critério de saída do M3:** dá pra cadastrar operadores, logar e navegar respeitando permissões — ainda sem nenhuma feature de mesa/comanda.

---

## M4 — Épico 3: Cadastro de Produtos e Cardápio

Referência: `PRD Épico 3`. Precisa vir antes do lançamento de pedidos (M6), que depende de produtos existirem.

- [ ] Evento/projeção de categorias — PRD 3.1.
- [ ] Evento/projeção de produtos (nome, preço, categoria, status ativo/inativo) — PRD 3.2.
- [ ] Telas de cadastro (dono) de categorias e produtos.
- [ ] Tela de busca de produto por nome/categoria (usada depois pelo garçom no M6) — PRD 3.3.

---

## M5 — Épico 2: Mesas e Comandas

Referência: `PRD Épico 2`.

- [ ] Evento/projeção de mesas (cadastro) — PRD 2.1.
- [ ] Abrir comanda vinculada a mesa, com invariante local "1 comanda aberta por mesa" — PRD 2.2.
- [ ] Abrir comanda avulsa (numeração sequencial, sem `table_id`) — PRD 2.3.
- [ ] Tela de mapa de mesas + lista de comandas abertas (mesa + avulsa) — PRD 2.4.
- [ ] Transferência de comanda entre mesas (evento `order_transferred`, mantendo histórico) — PRD 2.5.
- [ ] Junção visual de mesas (`tables_grouped`), sem mesclar dados de comanda — PRD 2.6.
- [ ] Enforcement do limite de 10 comandas simultâneas (contagem local mesa+avulsa) — PRD 2.7. *(Neste milestone, usar valor fixo/local do limite; a leitura do valor real do plano via backend entra no M9.)*

**Critério de saída do M5:** fluxo completo de "abrir mesa/comanda avulsa → ver no mapa → transferir/agrupar" funcional em um único terminal, offline.

---

## M6 — Épico 4: Lançamento de Pedidos

Referência: `PRD Épico 4`. Depende de M4 (produtos) e M5 (comandas).

- [ ] Adicionar item a uma comanda aberta (evento `item_added`) — PRD 4.1.
- [ ] Observação por item (ex: "sem cebola") — PRD 4.2.
- [ ] Cancelamento de item com motivo obrigatório (lista pré-definida + "outro"), gerando evento de auditoria — PRD 4.3, ligado ao log do M3.

---

## M7 — Épico 5: Fechamento de Comanda

Referência: `PRD Épico 5`. Depende de M6.

- [ ] Cálculo de subtotal + taxa de serviço (default 10%, configurável por estabelecimento, ajustável/isentável por comanda) — PRD 5.1.
- [ ] Valores monetários em centavos (inteiro) em toda a stack — PRD NFR7.
- [ ] Split igual (N partes, resto determinístico na primeira parcela) — PRD 5.2.
- [ ] Split manual (soma exata obrigatória, UI mostra quanto falta/sobra, botão desabilitado até bater) — PRD 5.2.
- [ ] Registro de forma de pagamento por parte do split (dinheiro/cartão manual) — PRD 5.3.
- [ ] Cálculo de troco (só sobre a parte em dinheiro) — PRD 5.4.
- [ ] Fechamento da comanda (evento `order_closed`, imutabilidade pós-fechamento) — PRD 5.5.
- [ ] Fechamento conjunto de mesas agrupadas (M5) numa única operação de pagamento — PRD 5.2.

---

## M8 — Épico 6: Fechamento de Caixa (local)

Referência: `PRD Épico 6.1`. Depende de M7.

- [ ] Cálculo do resumo do dia a partir da projeção local (total vendido, total por forma de pagamento, comandas fechadas vs. pendentes) — PRD 6.1.
- [ ] Tela de fechamento de caixa (dono/caixa).

**Critério de saída do M8:** o MVP funcional em **um único terminal, 100% offline**, está completo.

**M8 é um checkpoint de ir/não ir, não só um marco de demo.** Antes de investir no M9 (o milestone de maior risco técnico do projeto), vale usar esse ponto para validar a tese central do produto: o fluxo single-terminal (mesas, comandas, cardápio, fechamento) já resolve o problema de verdade para um bar pequeno como o do cliente-zero? Se a reação real ao produto funcionando aqui não convencer ninguém a querer usar, é muito mais barato descobrir isso agora do que depois de construir sync LAN inteiro. Recomenda-se uma demo real com o cliente-zero neste ponto antes de seguir para o M9.

---

## M9 — Sync LAN + Backend + Sync com a nuvem

Referência: `PRD Épico 7`, `ARCH §2, §5`. Este é o milestone de maior risco técnico do projeto — o M0/M1 deveriam ter reduzido boa parte da incerteza antes de chegar aqui.

- [ ] Backend (`apps/backend`): API de ingestão de eventos (recebe lote de eventos de um terminal, autenticado por credencial de terminal).
- [ ] Backend: projeção materializada em PostgreSQL (mesmo motor de `aplicarEvento` do `sync-engine`, reaproveitado).
- [ ] Backend: cadastro/pareamento de terminal (emissão de credencial vinculada ao estabelecimento).
- [ ] Sidecar: servidor de sync LAN (aceita conexões de outros terminais, autenticado por token de pareamento local) — `ARCH §2, §7`.
- [ ] Sidecar: integração de descoberta mDNS (reaproveitando o Spike 2 do M0) + fallback de IP manual.
- [ ] Sidecar: cliente de sync — tenta host primeiro, cai para qualquer peer alcançável se host estiver fora — `ARCH §2, item 3`.
- [ ] Sidecar: cliente de sync com a nuvem, independente do sync LAN (`ARCH §5`).
- [ ] UI: notificação visível e não bloqueante quando um merge automático de conflito acontece no terminal (`ARCH §4.2`, decisão de não deixar silencioso).

**Critério de saída do M9:** dois terminais na mesma rede local sincronizam entre si e com a nuvem; queda do host não bloqueia os demais terminais (testar isso explicitamente, não só assumir).

---

## M10 — Épico 8: Freemium e Gestão de Plano

Referência: `PRD Épico 8`, `ARCH §6`. Depende de M9 (precisa do backend e do sync).

- [ ] Backend: tabela de planos/assinaturas (`max_concurrent_orders`, `max_terminals`).
- [ ] Sidecar: cache local do plano, atualizado a cada sync com a nuvem.
- [ ] Enforcement real de limite de terminais (bloqueio de 2º terminal no free) — substitui o valor fixo usado provisoriamente no M5.
- [ ] Enforcement de limite de comandas usando o valor vindo do plano (não mais hardcoded).

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
