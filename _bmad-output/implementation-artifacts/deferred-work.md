- source_spec: `_bmad-output/implementation-artifacts/spec-sistema-de-design-visual.md`
  summary: Mapa de mesas perdeu semântica de tabela pra leitor de tela ao virar um grid de `table-tile` (`<div>`s no lugar de `<table>`/`<tr>`/`<td>`).
  evidence: Achado real (`blind-hunter`, verificado) — nenhum `role`/landmark substitui a semântica de tabela perdida. A correção exige escolher um padrão ARIA (grid/list/landmark por tile) que serve o produto como um todo, não uma correção pontual desta spec de repaginação visual.
