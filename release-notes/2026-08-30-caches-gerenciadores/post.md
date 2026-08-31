# Caches de gerenciadores de pacotes

- **Data:** 2026-08-30
- **Commit / PR:** `5516802` / [#25](https://github.com/nettonucci/diskheadroom/issues/25)
- **Tipo:** feat
- **Público:** quem desenvolve com npm, Yarn, pnpm, Bun, pip, uv, Cargo ou Go
- **Formato sugerido no Instagram:** carrossel (2–3 slides) ou único

## O que mudou

- Novo grupo opt-in: caches de gerenciadores de pacotes.
- Cobre npm, Yarn, pnpm, Bun, pip, uv, Cargo (registry + git) e Go (módulos + build).
- Itens **desmarcados** por padrão — as ferramentas baixam de novo o que precisarem.
- Esses nomes saem da varredura genérica de `~/Library/Caches` para não duplicar.

## Por que importa

Quem desenvolve acumula gigas de cache sem perceber. Agora isso aparece na lista — e só vai para a Lixeira se você marcar.

## Legenda pronta (PT-BR)

npm, Yarn, pnpm, Bun, pip, uv, Cargo, Go.

O cache desses caras mora quieto no seu home e come SSD.

O Disk Headroom agora lista esses leftovers num grupo à parte.

Desmarcado por padrão. Você revisa, marca o que não precisa, confirma. Vai para a Lixeira.

As ferramentas baixam de novo o que precisarem no próximo install.

#DiskHeadroom #macOS #DevTools #npm #pnpm #Yarn #RustLang #Golang #Python #SSD

## Hashtags

`#DiskHeadroom` `#macOS` `#DevTools` `#npm` `#pnpm` `#Yarn` `#RustLang` `#Golang` `#Python` `#SSD`

## Imagens

1. Grupos de desenvolvedor (opt-in)
2. Tela de resultados para contexto do fluxo

![Grupos opcionais de leftovers de desenvolvedor, desmarcados](imagens/developer.png)

![Revisão antes de limpar](imagens/results.png)
