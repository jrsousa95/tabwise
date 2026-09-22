- source_spec: `_bmad-output/implementation-artifacts/spec-sistema-de-design-visual.md`
  summary: Mapa de mesas perdeu semântica de tabela pra leitor de tela ao virar um grid de `table-tile` (`<div>`s no lugar de `<table>`/`<tr>`/`<td>`).
  evidence: Achado real (`blind-hunter`, verificado) — nenhum `role`/landmark substitui a semântica de tabela perdida. A correção exige escolher um padrão ARIA (grid/list/landmark por tile) que serve o produto como um todo, não uma correção pontual desta spec de repaginação visual.

- source_spec: `_bmad-output/implementation-artifacts/spec-correcao-juncao-de-mesas.md`
  summary: A trava contra sobreposição em `POST /table-groups` só enxerga o estado local de cada sidecar — dois terminais diferentes podem, cada um, passar na validação antes de sincronizar entre si e produzir grupos sobrepostos mesmo assim.
  evidence: Achado real (`blind-hunter`, verificado) — não há corrida dentro de um único processo (checagem e gravação são síncronas, sem `await` entre elas), então o risco é só entre terminais via sync LAN eventual-consistency (mesma característica de toda a arquitetura, não introduzida por este diff). Resolver de verdade pediria um mecanismo tipo `mergeWarnings` (já existe pra conflito de mesa, ARCH §4.2) aplicado a grupos — trabalho de arquitetura novo, fora do escopo desta correção pontual.

- source_spec: `_bmad-output/implementation-artifacts/spec-renomear-remover-cadastros.md`
  summary: As 6 rotas novas de renomear/remover (mesa/categoria/produto) têm ramos de validação (400/404, incluindo as duas travas 409) sem nenhuma cobertura automatizada que rode num caminho de teste normal — só via `packaged-binary-smoke.mjs`, disparado manualmente.
  evidence: Achado real (`blind-hunter` + `verification-gap`, verificado) — não existe workflow `push`/`pull_request` no repo pra nenhum pacote hoje (ambos os workflows existentes são `workflow_dispatch` manual, por design). Resolver de verdade é decisão de infraestrutura de CI do repo inteiro, não algo que esta spec pontual deveria carregar sozinha.

- source_spec: `_bmad-output/implementation-artifacts/spec-renomear-remover-cadastros.md`
  summary: `table_removed` não trata a corrida entre terminais offline — terminal A remove uma mesa, terminal B (offline) abre uma comanda pra ela antes de sincronizar; depois do sync, a comanda referencia um `tableId` ausente de `tables`, sem nenhum reconhecimento do caso.
  evidence: Achado real (`edge-case-hunter`, verificado) — não quebra (fallbacks `?? "—"`/`?? "mesa"` já cobrem o label ausente), mas degrada silenciosamente. Mesma classe de trade-off arquitetural já deferida na spec de remoção de junção de mesas — resolver pediria um mecanismo tipo `mergeWarnings` aplicado a mesas removidas, trabalho de arquitetura novo fora do escopo desta spec.
