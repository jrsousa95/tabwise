# Spike 1 — Sidecar Node embutido no Tauri

**Referência:** `docs/architecture.md` §9, `docs/implementation-plan.md` M0
**Data:** 2026-09-20
**Status:** ✅ Totalmente validado — macOS/arm64 (incluindo confirmação visual) e Windows real (via CI, ver pendência 1)

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
- **Confirmado visualmente pelo usuário** rodando localmente no VS Code: janela do Tauri abriu corretamente exibindo a tela do Spike 1.

## Armadilhas encontradas e resolvidas

1. **Binário Node universal (macOS).** O `node` distribuído para macOS é **universal** (x86_64 + arm64 no mesmo arquivo). Isso duplica o "sentinel" que o `postject` procura para injetar o blob SEA, e a injeção falha com `Multiple occurences of sentinel`. **Solução:** usar `lipo -thin <arch>` para reduzir o binário à arquitetura nativa antes de injetar (implementado em `build-sea.mjs`, com detecção automática de binário universal).

2. **CORS entre frontend e sidecar (`Load failed` no WKWebView).** Na primeira execução real (fora desta sessão de desenvolvimento), o app abriu corretamente, mas a chamada `fetch` do React para o sidecar falhou com `Load failed` — mensagem genérica do WebKit/Safari para requisição bloqueada por CORS. Causa: o frontend roda em `http://localhost:1420` (dev) e o sidecar em `http://127.0.0.1:4550` — origens diferentes do ponto de vista do navegador, mesmo sendo processos do mesmo app na mesma máquina. O servidor HTTP do sidecar não enviava nenhum header de CORS. **Solução:** adicionar `Access-Control-Allow-Origin: *` (e headers relacionados) em toda resposta do sidecar — seguro aqui porque o servidor só escuta em loopback (127.0.0.1), nunca exposto fora da máquina.

Ambas as armadilhas são exatamente o tipo de coisa que a arquitetura já antecipava (`ARCH §9`) — só apareceram rodando de verdade, não lendo a documentação do Node SEA ou do Tauri. **Ação para o M1:** o `sync-engine` real vai precisar desses mesmos headers de CORS em qualquer endpoint local que o frontend consumir.

3. **`npx`/`npx.cmd` não pode ser chamado via `execFileSync` sem `shell:true` no Windows.** `execFileSync("npx", [...])` (usado para chamar o `postject`) falha no Windows: `npx` puro dá `ENOENT` (lá é um shim `.cmd`, não um binário); trocando para `"npx.cmd"` explicitamente, ainda falha com `EINVAL` — Node bloqueia `execFileSync`/`spawnSync` de arquivos `.cmd`/`.bat` sem `shell:true` (mitigação de uma CVE de injeção de comando). **Só apareceu rodando em Windows real via CI** — o cross-build a partir do Mac nunca executa esse trecho do jeito certo, então não pegaria esse bug. **Solução definitiva:** parar de depender de `npx`/shell — resolver o CLI do `postject` direto via `require.resolve("postject/dist/cli.js")` e rodá-lo com `execFileSync(process.execPath, [postjectCli, ...])`, idêntico em qualquer SO. Também guardado o `chmod +x` final para não rodar em Windows (não existe/não é necessário lá).

## Pendências para fechar o Spike 1 por completo

1. ~~Testar o instalador final em Windows real (VM ou máquina física)~~ — **resolvido**, via `.github/workflows/spike1-windows-validation.yml` (runner `windows-latest` do GitHub Actions, disparo manual via `workflow_dispatch`, [run 35517168909](https://github.com/jrsousa95/passa-a-regua/actions/runs/35517168909)): sidecar buildado nativamente em Windows, smoke test do `/health` respondeu `{"status":"ok","platform":"win32","arch":"x64"}`, e o instalador Tauri completo (`.msi`/`.exe`) foi gerado com sucesso e subido como artifact. A primeira execução já achou e corrigiu de quebra a armadilha 3 acima — confirma que o cross-build a partir do Mac não seria suficiente pra pegar esse bug.
2. Assinatura de código para distribuição real (o ad-hoc signing usado aqui — `codesign --sign -` — só serve para rodar localmente; um instalador distribuído precisará de um certificado de assinatura de verdade, tanto para macOS/notarization quanto para Windows/Authenticode, para não ser bloqueado por Gatekeeper/SmartScreen).

~~Confirmação visual do `fetch()` renderizando na tela~~ — **resolvido**: confirmado rodando localmente (tela exibindo "✅ Sidecar respondendo" com pid/plataforma corretos), após a correção de CORS acima.

## Como rodar

```bash
cd apps/desktop
npm install
npm run dev:tauri   # builda o sidecar automaticamente (predev:tauri) e abre o app
```
