# Spike 1 — Sidecar Node embutido no Tauri

**Referência:** `docs/architecture.md` §9, `docs/implementation-plan.md` M0
**Data:** 2026-09-20
**Status:** ✅ Validado no host (macOS/arm64) — validação em Windows real ainda pendente

## O que foi testado

Provar a cadeia completa decidida na arquitetura: um processo Node/TS, empacotado como binário standalone (Node SEA — Single Executable Application, sem exigir Node instalado na máquina do cliente), spawnado automaticamente pelo Tauri no startup do app, expondo um servidor HTTP local que o frontend React consegue consultar.

## Implementação

- `apps/desktop/sidecar/`: código-fonte TS do sidecar (servidor HTTP mínimo com endpoint `/health`) + script de build (`scripts/build-sea.mjs`) que compila TS → JS e empacota como binário SEA nomeado com o target triple exigido pelo Tauri (`passa-a-regua-sidecar-<triple>`).
- `apps/desktop/src-tauri/`: `tauri-plugin-shell` adicionado; `lib.rs` spawna o sidecar no hook `setup()` e encaminha stdout/stderr do processo filho para o log do Tauri; capability `shell:allow-execute` configurada para o sidecar específico.
- `apps/desktop/src/App.tsx`: tela de validação que faz `fetch` em `http://127.0.0.1:4550/health` a cada 2s e exibe o resultado.

## Resultado

- Binário SEA gerado e executado standalone com sucesso, respondendo no `/health`.
- `cargo check` e `npm run dev:tauri` (via `tauri dev`) rodaram sem erros; log confirmou: `[sidecar stdout] [sidecar] ouvindo em http://127.0.0.1:4550 (pid ...)`.
- `curl` ao endpoint, com o app rodando, retornou o JSON esperado — confirma que o sidecar foi de fato spawnado pelo processo pai do Tauri (não por um processo solto).
- **Não verificado visualmente**: esta sessão de desenvolvimento não tem acesso a um display para screenshot da janela renderizada. A leitura do `fetch()` no React não foi confirmada visualmente, mas não há motivo técnico esperado para falhar onde o `curl` já teve sucesso (mesmo host, mesma porta, CSP permissivo). **Ação de acompanhamento:** confirmar visualmente na primeira vez que alguém rodar `npm run dev:tauri` numa máquina com display.

## Armadilha encontrada e resolvida

O binário `node` distribuído para macOS é **universal** (x86_64 + arm64 no mesmo arquivo). Isso duplica o "sentinel" que o `postject` procura para injetar o blob SEA, e a injeção falha com `Multiple occurences of sentinel`. **Solução:** usar `lipo -thin <arch>` para reduzir o binário à arquitetura nativa antes de injetar (implementado em `build-sea.mjs`, com detecção automática de binário universal).

Isso é exatamente o tipo de armadilha de empacotamento que a arquitetura já antecipava (`ARCH §9`, spike 1) — reforça que testar de verdade, e não só ler a documentação do Node SEA, era necessário.

## Pendências para fechar o Spike 1 por completo

1. **Testar o instalador final em Windows real (VM ou máquina física)** — conforme já registrado no `implementation-plan.md`, cross-build a partir do Mac pode esconder problemas (empacotamento do `.exe`, antivírus bloqueando binário não assinado, etc.) que só aparecem rodando de verdade. O binário Windows (`passa-a-regua-sidecar-x86_64-pc-windows-msvc.exe`) ainda não foi gerado nesta sessão — geração cross-platform exigiria baixar o `node.exe` da versão correspondente do nodejs.org e rodar o `postject` sobre ele (tecnicamente viável a partir do Mac, já que o `postject` só edita bytes do binário, mas a validação de execução só é real em Windows).
2. Confirmação visual do `fetch()` renderizando na tela (ver acima).
3. Assinatura de código para distribuição real (o ad-hoc signing usado aqui — `codesign --sign -` — só serve para rodar localmente; um instalador distribuído precisará de um certificado de assinatura de verdade, tanto para macOS/notarization quanto para Windows/Authenticode, para não ser bloqueado por Gatekeeper/SmartScreen).

## Como rodar

```bash
cd apps/desktop
npm install
npm run dev:tauri   # builda o sidecar automaticamente (predev:tauri) e abre o app
```
