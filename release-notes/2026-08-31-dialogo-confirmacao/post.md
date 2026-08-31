# Diálogo de confirmação no app

- **Data:** 2026-08-31
- **Commit / PR:** `b54d189` / [#33](https://github.com/nettonucci/diskheadroom/issues/33)
- **Tipo:** feat
- **Público:** todo mundo que usa “Mover para a Lixeira”
- **Formato sugerido no Instagram:** único ou carrossel (antes: nativo feio / depois: diálogo do app)

## O que mudou

- O `confirm` nativo do sistema sai de cena.
- Diálogo **dentro do app**: título, texto com tamanho, Cancelar e Confirmar.
- Escape e clique fora cancelam.
- Se a seleção inclui dados do Docker Desktop, o texto avisa que imagens, containers e volumes podem ser perdidos.

## Por que importa

Confirmar uma limpeza agora parece o resto do app — e o aviso do Docker não fica escondido num diálogo genérico do macOS.

## Legenda pronta (PT-BR)

Último passo antes da Lixeira: um diálogo do próprio Disk Headroom.

Quantos itens. Quanto espaço. Cancelar ou confirmar.

Se tiver Docker no meio, o aviso vem junto: imagens e volumes podem ir embora.

Ainda dá para restaurar da Lixeira. Espaço livre só aumenta quando você esvazia ela.

#DiskHeadroom #macOS #UX #DesignDeProduto #SSD #Docker #OpenSource

## Hashtags

`#DiskHeadroom` `#macOS` `#UX` `#DesignDeProduto` `#SSD` `#Docker` `#OpenSource`

## Imagens

A captura de `npm run screenshots` ainda mostra a tela de resultados (fluxo em que o diálogo abre). Use como fundo do post; recorte o diálogo na mão se gravar a tela no app.

![Tela de resultados — de onde se abre Mover para a Lixeira](imagens/results.png)
