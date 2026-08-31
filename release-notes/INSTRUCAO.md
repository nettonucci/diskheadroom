# Instrução: sempre atualizar `release-notes/`

Toda **feature nova**, **melhoria visível** ou **task** que o usuário possa perceber no app **deve** ganhar um pacote nesta pasta **antes** do commit/PR ser considerado pronto.

Isso existe para montar posts no Instagram (e reutilizar o mesmo texto em outras redes). Não substitui o `CHANGELOG.md` gerado pelo semantic-release.

## Quando criar

Crie um pacote quando o trabalho for `feat:` (ou equivalente: tela nova, grupo de scan, fluxo de UI, copy visível, captura nova).

Não crie pacote para `chore:`, `ci:`, `test:` ou `docs:` que não mudem o produto na tela.

## Onde e como

1. Pasta: `release-notes/AAAA-MM-DD-slug-curto/`
2. Arquivo obrigatório: `post.md` (sempre Markdown, com **todos** os dados abaixo)
3. Pasta obrigatória: `imagens/` com **toda** captura nova da feature (PNG/JPG/SVG). Não deixe só um link para `docs/screenshots` — copie os arquivos para cá.
4. Atualize o índice em `release-notes/README.md`

Se a UI mudou, rode `npm run screenshots` e copie as capturas relevantes para `imagens/`.

## Conteúdo mínimo de `post.md`

```markdown
# Título curto da feature

- **Data:** AAAA-MM-DD
- **Commit / PR:** hash ou #número
- **Tipo:** feat | melhoria de UI
- **Público:** quem se importa (devs iOS, quem usa Docker, etc.)
- **Formato sugerido no Instagram:** carrossel | único | Reels (roteiro)

## O que mudou
Texto factual, em 3–6 bullets.

## Por que importa
Uma frase para quem não lê o changelog.

## Legenda pronta (PT-BR)
Texto copiável, com quebras de linha, CTA e hashtags.

## Hashtags
Lista curta (8–15).

## Imagens
Liste cada arquivo em `imagens/` com alt text e ordem do carrossel.

![descrição](imagens/arquivo.png)
```

Inclua as imagens **embutidas** no `.md`. Sem screenshot da feature, o pacote está incompleto.

## Tom

- Português do Brasil na legenda.
- Sem milagre de “limpa o Mac em um clique”.
- Deixe claro: revisão manual, opt-in para leftovers de desenvolvedor, envio para a **Lixeira**.
- CTA usual: baixar o DMG em GitHub Releases / estrela / sponsor.

## Checklist antes de mergear a task

- [ ] Pasta `AAAA-MM-DD-slug` criada
- [ ] `post.md` com dados + legenda + imagens embutidas
- [ ] Arquivos reais em `imagens/`
- [ ] `release-notes/README.md` atualizado
