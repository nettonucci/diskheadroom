# Duplicatas exatas no iPhone, por hash

- **Data:** 2026-09-12
- **Commit / PR:** diskheadroom-app-mobile GH-08
- **Tipo:** feat
- **Público:** pessoas que testam o Disk Headroom no iPhone
- **Formato sugerido no Instagram:** carrossel

## O que mudou

- A aba Limpeza passa a comparar fotos e vídeos locais em busca de duplicatas **exatas**.
- Só entra na comparação quem tem o mesmo tamanho e o mesmo tipo; o SHA-256 é lido em pedaços, sem carregar o arquivo inteiro na memória.
- Arquivos do mesmo tamanho com conteúdo diferente **não** viram um grupo.
- Em cada grupo, uma cópia fica preservada. Nada vem marcado e similaridade visual fica de fora.

## Por que importa

Dá para ver cópias byte a byte de verdade, sem o app escolher o que apagar e sem confundir foto parecida com arquivo idêntico.

## Legenda pronta (PT-BR)

O Disk Headroom para iPhone agora encontra duplicatas exatas. 📱

Ele só compara arquivos do mesmo tamanho e do mesmo tipo. O conteúdo é lido em pedaços, com SHA-256, sem jogar um vídeo inteiro na memória.

Se dois arquivos têm o mesmo tamanho mas o conteúdo é outro, eles não entram no mesmo grupo. Foto parecida também não: isso não é busca por similaridade.

Em cada grupo, uma cópia fica preservada. Nada vem pré-selecionado e nada é apagado por conta própria. Você revisa as extras.

Deixe uma estrela no GitHub e conte se as duplicatas da sua galeria bateram com o que você esperava.

#DiskHeadroom #iPhone #iOS #Privacidade #OpenSource #Armazenamento #Fotos #Videos #ReactNative #Expo

## Hashtags

#DiskHeadroom #iPhone #iOS #Privacidade #OpenSource #Armazenamento #Fotos #Videos #ReactNative #Expo

## Imagens

> **Antes de postar:** capture no dispositivo a aba Limpeza com o card de duplicatas e a lista agrupada, com uma cópia marcada como preservada. Não use miniaturas de biblioteca pessoal sem borrar.

1. `imagens/duplicatas-limpeza.png` — card Duplicatas exatas na aba Limpeza, com grupos e espaço recuperável.
2. `imagens/duplicatas-grupo.png` — lista de um grupo, com a cópia preservada travada e as extras desmarcadas.

![Card de duplicatas exatas na aba Limpeza](imagens/duplicatas-limpeza.png)

![Grupo de duplicatas com uma cópia preservada](imagens/duplicatas-grupo.png)
