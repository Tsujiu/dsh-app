# Biblioteca de modelos incorporada

Este diretório contém os assets da biblioteca de modelos de layout do plugin PPT.
Eles são distribuídos com o plugin e lidos somente pelas ferramentas de modelos
(`ppt_list_templates` / `ppt_get_template_reference` / `ppt_get_template_pages`)
e pelo painel de seleção. O runtime não grava neste diretório.

## Estrutura de diretórios

Cada modelo tem um diretório: `<category>/<template id>/`.

| Arquivo/diretório | Finalidade |
|---|---|
| `metadata.json` | Metadados do modelo: nome, categoria, fontes, paleta e índice estrutural por página (inclui a contagem sugerida de caracteres `textCapacity` por área de texto, em pixels de referência 1280x720) |
| `design.md` | Notas de design do modelo: sintaxe de layout, combinação de fontes, semântica de cores e regras de composição (retorno de `ppt_get_template_reference`) |
| `pages/NN.jpg` | Prévia de layout por página (compactada para largura de 560px, qualidade 70; `pages/01.jpg` também serve como capa do painel de seleção) |
| `source-zh/` | Projeto PPTD de exemplo em chinês (`deck.pptd` + `pages/NN.page`, com bounds no espaço de pontos 960x540), usado como referência de layout por página |

## Categorias

`academic` / `business` / `consulting` / `editorial` / `promotion` / `work`: seis categorias, com cinco modelos em cada uma.

Cada categoria tem um modelo base; os demais são variantes de cor desse modelo:
usam o mesmo esqueleto de layout (a geometria e as combinações de fontes de
`source-zh` são idênticas), trocando apenas a paleta; as prévias em `pages/` são
renderizadas novamente com a paleta da variante. As variantes são derivadas pelo
`scripts/generate-template-variant.mjs` (configuração em `scripts/template-variants.json`)
a partir do modelo base; uma entrada pode usar `baseCategory` para apontar ao
modelo base de outra categoria. O fluxo e o uso estão nos comentários iniciais do script.

## Família de layouts geométricos

Além dos esqueletos originais, `business/dsh-slate-grid` (Slate Grid) e suas
variantes introduzem uma família geométrica independente: doze páginas com
layouts estruturais 16:9 open source (capa / seção / conteúdo / três cartões /
comparação em duas colunas / linha do tempo / KPI / gráfico / tabela / citação /
conteúdo dividido / encerramento), cada uma com geometria diferente. A família é
extraída por `scripts/import-layout-family.mjs` (configuração em
`scripts/layout-family-imports.json`) de `--layouts <asset root>`: slots
`data-pptx-placeholder` em SVG tornam-se elementos de texto editáveis, decoração
fixa vira forma/linha e coordenadas em pixels são convertidas para o espaço de
pontos 960x540 de `.page` (zones preserva os pixels de referência 1280x720).
Slots `picture` / `chart` / `table` sem dados viram blocos de texto placeholder no
mesmo retângulo e zone; o script de extração imprime a lista de degradações.

## Origem e licença

A biblioteca de modelos incorporada deriva de projetos open source, sob MIT/Apache-2.0.
Os modelos foram reconstruídos como layouts nativos editáveis e incluem exemplos
em chinês e combinações de fontes Office; nenhum arquivo binário de fonte é incluído.
As prévias são miniaturas de layout, não fundos da saída. A estrutura da família de
layouts geométricos é baseada em assets de layout open source (MIT/Apache-2.0).
