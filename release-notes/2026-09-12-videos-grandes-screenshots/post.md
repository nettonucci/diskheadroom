# Vídeos grandes e screenshots no iPhone

- **Data:** 2026-09-12
- **Commit / PR:** diskheadroom-app-mobile #48 e #50
- **Tipo:** feat
- **Público:** pessoas que testam o Disk Headroom no iPhone
- **Formato sugerido no Instagram:** carrossel

## O que mudou

- O inventário local agora separa vídeos grandes e capturas de tela em listas revisáveis.
- O limiar padrão é 80 MB e vale para o tamanho real medido no aparelho, não para uma estimativa.
- As capturas só entram quando o próprio iOS marca o item como screenshot ou quando ele está no álbum de capturas; nada é deduzido pelo nome do arquivo.
- Cada linha mostra miniatura, data, tamanho e o motivo da sugestão.
- A lista é uma linha do tempo: os itens vêm do mais recente para o mais antigo, agrupados por mês, e cada mês traz seu próprio total. O cabeçalho do mês fica fixo enquanto você rola aquele período.
- As miniaturas são pedidas à galeria do sistema, que devolve uma imagem no tamanho da célula. O arquivo original, de vários GB, nunca é aberto para desenhar a tela.
- Dá para marcar itens e ver quanto espaço a seleção representa. Nada vem marcado e nada é apagado.
- Os totais ficam guardados no aparelho e continuam disponíveis offline, sem nova análise.

## Por que importa

O app passa a dizer o que ocupa espaço de verdade e por quê, sem escolher nada por você.

## Legenda pronta (PT-BR)

O Disk Headroom para iPhone agora mostra onde o espaço foi parar. 📱

Vídeos grandes e capturas de tela aparecem em listas separadas, com miniatura, data, tamanho real e o motivo de cada sugestão. O limiar padrão é 80 MB, medido no arquivo que está no aparelho.

A lista é uma linha do tempo, do mais recente para o mais antigo, agrupada por mês e com o total de cada mês. Assim dá para enxergar em que período o espaço foi embora.

Captura de tela só entra quando o iOS marca o item como captura ou quando ele está no álbum de capturas. Nada é adivinhado pelo nome do arquivo, e nenhum item que mora só no iCloud é baixado.

Nada vem pré-selecionado e nada é apagado: você marca o que quer revisar e vê quanto aquilo representa. A exclusão, com confirmação do sistema, vem a seguir.

Deixe uma estrela no GitHub e conte o que você quer revisar primeiro.

#DiskHeadroom #iPhone #iOS #Privacidade #OpenSource #Armazenamento #Fotos #Videos #ReactNative #Expo

## Hashtags

#DiskHeadroom #iPhone #iOS #Privacidade #OpenSource #Armazenamento #Fotos #Videos #ReactNative #Expo

## Imagens

> **Antes de postar:** as duas capturas são de uma biblioteca real e as miniaturas mostram vídeos pessoais. Troque por uma biblioteca de teste ou borre as miniaturas. A bolha flutuante no canto direito é o menu de desenvolvimento e não aparece em build de produção.

1. `imagens/timeline-por-mes.png` — a linha do tempo agrupada por mês, com o total de cada período e as miniaturas vindas da galeria.
2. `imagens/videos-grandes.png` — lista de vídeos grandes com tamanho medido e motivo por item.

![Lista de vídeos grandes agrupada por mês, com Setembro de 2026 somando 7 itens e 4,7 GB, e cada linha trazendo miniatura, data, tamanho e motivo](imagens/timeline-por-mes.png)

![Lista de vídeos grandes mostrando 27 itens, 19 GB potenciais, com miniatura, data, tamanho e motivo em cada linha](imagens/videos-grandes.png)
