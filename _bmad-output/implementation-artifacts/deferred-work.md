- source_spec: `_bmad-output/implementation-artifacts/spec-sistema-de-design-visual.md`
  summary: Mapa de mesas perdeu semântica de tabela pra leitor de tela ao virar um grid de `table-tile` (`<div>`s no lugar de `<table>`/`<tr>`/`<td>`).
  evidence: Achado real (`blind-hunter`, verificado) — nenhum `role`/landmark substitui a semântica de tabela perdida. A correção exige escolher um padrão ARIA (grid/list/landmark por tile) que serve o produto como um todo, não uma correção pontual desta spec de repaginação visual.

- source_spec: `_bmad-output/implementation-artifacts/spec-correcao-juncao-de-mesas.md`
  summary: A trava contra sobreposição em `POST /table-groups` só enxerga o estado local de cada sidecar — dois terminais diferentes podem, cada um, passar na validação antes de sincronizar entre si e produzir grupos sobrepostos mesmo assim.
  evidence: Achado real (`blind-hunter`, verificado) — não há corrida dentro de um único processo (checagem e gravação são síncronas, sem `await` entre elas), então o risco é só entre terminais via sync LAN eventual-consistency (mesma característica de toda a arquitetura, não introduzida por este diff). Resolver de verdade pediria um mecanismo tipo `mergeWarnings` (já existe pra conflito de mesa, ARCH §4.2) aplicado a grupos — trabalho de arquitetura novo, fora do escopo desta correção pontual.
