# Plano: Pro via GitHub Sponsors

- **Data:** 2026-09-10
- **Decisão:** só GitHub Sponsors por agora. Sem Paddle, sem Pagar.me, sem segundo checkout.
- **Motivo:** o Paddle recusou o domínio (`device cleaner` + `donations` na AUP). Sponsors já existe e não exige API de pagamentos grande.
- **Limite consciente:** quem não tem (e não quer) conta GitHub não compra Pro neste recorte.

Este arquivo é a fonte do trabalho. Implementar só o que está nos to-dos abaixo.

## Recorte

O Pro deixa de ser checkout Paddle. Um **tier one-time** no GitHub Sponsors (preço atual de marketing, US$ 19) inclui a chave vitalícia da major 1.x.

Fluxo:

1. A pessoa patrocina o tier Pro na conta `nettonucci`.
2. Abre `https://www.diskheadroom.com/{locale}/pro`.
3. Entra com o **mesmo** GitHub.
4. O site confirma o patrocínio no GraphQL e mostra `dh1.…` para copiar.
5. No app, cola em Ajustes (aba única Pro/apoio) e ativa. A verificação continua **offline**.

Tiers menores do Sponsors continuam só agradecimento: **não** geram chave.

## Repos envolvidos

| Repo | Papel |
| --- | --- |
| [nettonucci/diskheadroom](https://github.com/nettonucci/diskheadroom) | App Electron/macOS. Ajustes (fundir Pro + Doar), copy, links, testes, `release-notes/`. **Não** muda o verificador Ed25519. |
| [nettonucci/diskheadroom-web](https://github.com/nettonucci/diskheadroom-web) | Site Next.js na Vercel. OAuth GitHub, claim da chave, `/pro` e `/apoiar`, textos legais, testes, docs. |
| Conta GitHub `nettonucci` (não é repo) | Tier Sponsors + OAuth App. |
| Projeto Vercel do site | Env vars de produção (e preview se for testar OAuth). |

Fora de escopo neste plano: Paddle (já recusado), Pagar.me, Stripe, Polar, fila, banco, API no Electron.

## Como a chave funciona (não redesenhar)

- Site assina `{ product: "diskheadroom", major: 1, transactionId }` com Ed25519 (`LICENSE_PRIVATE_KEY_PEM`).
- App verifica com a pública em `src/main/license.ts`. Campos extra no JSON são ignorados na checagem além de `product`, `major`, `exp`.
- Idempotência: o mesmo GitHub user id sempre produz a mesma chave (`transactionId: "gh:{numericId}"`).
- Script local já existe: `scripts/sign-license.mjs` no app (fallback manual se o claim falhar).

## App — uma aba só

Hoje em Ajustes (`SETTINGS_TABS` em `src/renderer/src/lib/copy.ts`):

1. Donate  
2. Scan  
3. Permissions  
4. Pro  
5. General  
6. Updates  

A aba **Donate** (`DonateView`) e a aba **Pro** (status, campo da chave, Comprar, “doar em vez disso”) viram **um único tabpanel**.

Comportamento:

- Uma aba na barra (nome visível: **Pro**; se a copy ficar melhor, **Apoiar** — escolher um e usar nos três idiomas).
- No mesmo painel, nesta ordem:
  1. Status Pro (ligado/desligado).
  2. Colar chave + Ativar (fluxo atual).
  3. CTA principal: abrir o tier/site (`proCheckoutUrl` → `/pro` no site, não overlay Paddle).
  4. CTA secundário: GitHub Sponsors (`SPONSORS_URL`) com texto claro: o **tier Pro** gera chave; valor menor não gera.
  5. Link do repositório (o que hoje está no card Doar).
- Remover a aba Donate e o botão que só troca de aba (`settings.proDonate`).
- Ajustes que hoje abrem Donate por padrão / atalho / bandeja (`onTrayDonate`, `SettingsSection: 'donate'`) passam a abrir **esta aba única**.
- Deep links e testes de tabs, Playwright/screenshots de settings, `languages.json` (en, pt-BR, es).
- `proCheckoutUrl` permanece `https://www.diskheadroom.com/{locale}/pro`; atualizar o comentário que cita Paddle.js.
- Categorias Pro do scan e previsão de headroom **não mudam**: só `isPro` local.

Na entrega do app: pasta `release-notes/AAAA-MM-DD-…` + `README` do índice + `npm run screenshots` copiados, conforme `release-notes/INSTRUCAO.md`.

## Site — claim sem Paddle

Substituir o overlay Paddle em `/pro`:

1. Explicar: Pro = tier one-time no Sponsors; depois entrar com GitHub nesta página.
2. Botão para `https://github.com/sponsors/nettonucci` (idealmente âncora do tier Pro).
3. **Entrar com GitHub** → OAuth (`state` CSRF em cookie) → sessão `HttpOnly`.
4. **Gerar / mostrar chave** se o GraphQL `sponsorshipForViewerAsSponsor` no user `nettonucci` atingir o piso (`GITHUB_SPONSORS_MIN_CENTS`, one-time preferencial).
5. Reusar o bloco de copiar chave que hoje o `ProCheckout` já tem.
6. Sem sessão ou sem tier: mensagem explícita (entrar / patrocinar o tier certo).
7. `/apoiar`: o Pro aponta para o mesmo fluxo; doação menor continua sem chave.

Rotas sugeridas (todas no App Router do `diskheadroom-web`):

| Método | Caminho | Função |
| --- | --- | --- |
| GET | `/api/github/login` | Redirect authorize + cookie `state` |
| GET | `/api/github/callback` | Troca code, grava sessão (`githubUserId`, `login`) |
| POST | `/api/github/logout` | Limpa sessão |
| POST | `/api/license/github` | Sessão obrigatória; GraphQL; assina `dh1.…` |

A rota atual `POST /api/license` (Paddle `txn_`) sai do fluxo público. Pode ser removida neste recorte.

## GitHub (manual)

- Tier **one-time** no valor do Pro (US$ 19). Título e descrição: inclui chave 1.x; reivindicar em `https://www.diskheadroom.com/pro` com a mesma conta.
- OAuth App: homepage `https://www.diskheadroom.com`; callback `https://www.diskheadroom.com/api/github/callback`. Preview da Vercel só se precisar testar OAuth (callback extra ou App de preview).
- Escopo mínimo para `sponsorshipForViewerAsSponsor` (em geral `read:user`).
- Webhook de sponsorship: **opcional**. A fonte da verdade na emissão é o GraphQL no login.

## Vercel (site)

| Variável | Uso |
| --- | --- |
| `LICENSE_PRIVATE_KEY_PEM` | Já existe; continua |
| `GITHUB_OAUTH_CLIENT_ID` | OAuth |
| `GITHUB_OAUTH_CLIENT_SECRET` | OAuth |
| `GITHUB_OAUTH_REDIRECT_URI` | Callback de produção |
| `GITHUB_SPONSORS_LOGIN` | `nettonucci` |
| `GITHUB_SPONSORS_MIN_CENTS` | `1900` (alinhar ao tier) |
| `PRO_PAGE_ENABLED` | `true` |
| `PRO_PRICE_DISPLAY` | Texto do preço |

Desligar do público: `NEXT_PUBLIC_PADDLE_*`, `PADDLE_API_KEY`. Cookie de sessão: `Secure`, `HttpOnly`, `SameSite=Lax`.

Não precisa de API “robusta”: três rotas no próprio Next, sem banco no dia 1. Mesmo `gh:{id}` = mesma chave se o webhook/GitHub retratar.

## Textos legais e docs (site)

Atualizar **en, pt-BR e es**: `/pro`, `/apoiar`, termos, reembolso, FAQ, contato, `README.md`.

Paddle deixa de ser Merchant of Record. Recibo e estorno = GitHub Sponsors. Ser honesto: chave já ativada no Mac não se auto-revoga se o GitHub estornar.

Trocar `docs/paddle-producao.md` por um guia Sponsors + OAuth + env.

## Testes

**diskheadroom-web:** Vitest com GraphQL mock (qualifica / abaixo do piso / não patrocina / sem sessão). Playwright: `/pro` com login + Sponsors, sem Paddle. Coverage ≥ 90%.

**diskheadroom:** tabs (uma aba, não duas), tray/atalho abre a aba unificada, `proCheckoutUrl`, copy. Screenshots de Ajustes.

**Smoke humano:** conta alt no tier Pro → claim em produção (ou preview com OAuth) → colar no app.

## Ordem de execução

1. GitHub: tier + OAuth App (senão o site não testa ponta a ponta).  
2. Env na Vercel (preview, depois production).  
3. Site: OAuth + claim + testes.  
4. Site: UI `/pro` e `/apoiar` + copy legal.  
5. App: aba única + copy + testes + release-notes.  
6. Smoke com conta sponsor de teste.

O app pode ir em paralelo à UI do site depois que `proCheckoutUrl` continuar apontando para `/pro`.

## Fora deste plano (depois)

- Pagar.me / PIX para quem não quer GitHub.  
- Appeal Paddle.  
- Banco para “perdi a chave” além da idempotência `gh:{id}`.  
- Revogação remota de chave (o app é offline).

---

## To-dos

Marcar no PR/issue correspondente. Repos: **app** = `diskheadroom`, **web** = `diskheadroom-web`.

### GitHub (conta, não código)

- [ ] **G1.** Criar/ajustar tier **one-time** = preço Pro (US$ 19), nome e descrição com chave 1.x + URL `/pro`.
- [ ] **G2.** Deixar explícito nos outros tiers: não incluem licença Pro.
- [ ] **G3.** Registrar OAuth App (homepage + callback produção; preview se necessário).
- [ ] **G4.** Guardar Client ID/Secret só na Vercel (nunca no git).

### Vercel (projeto do site)

- [ ] **V1.** Production: `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_REDIRECT_URI`, `GITHUB_SPONSORS_LOGIN=nettonucci`, `GITHUB_SPONSORS_MIN_CENTS=1900`.
- [ ] **V2.** Confirmar `LICENSE_PRIVATE_KEY_PEM` e `PRO_PAGE_ENABLED=true`.
- [ ] **V3.** Remover ou esvaziar vars Paddle do ambiente que ainda ligaria o overlay.

### Site (`diskheadroom-web`)

- [ ] **W1.** Rotas OAuth: login, callback, logout; cookie `state` + sessão `HttpOnly`.
- [ ] **W2.** `POST /api/license/github`: GraphQL `sponsorshipForViewerAsSponsor`; piso em cents; `isOneTime` preferencial; assinar `gh:{userId}`.
- [ ] **W3.** Testes unitários do claim (sucesso, 401, 403, abaixo do piso, idempotência).
- [ ] **W4.** `/pro`: tirar Paddle.js; CTAs Sponsors + Entrar com GitHub + copiar chave.
- [ ] **W5.** `/apoiar` alinhado (tier Pro vs doação sem chave).
- [ ] **W6.** Copy i18n en / pt-BR / es: pro, apoiar, termos, reembolso, FAQ, contato.
- [ ] **W7.** Remover fluxo público `POST /api/license` Paddle (e testes/docs associados).
- [ ] **W8.** README + guia operacional (substitui `docs/paddle-producao.md`).
- [ ] **W9.** Playwright e coverage; CI verde.

### App (`diskheadroom`)

- [ ] **A1.** Fundir abas **Pro** e **Donate** num tabpanel só; tirar Donate da `SETTINGS_TABS`.
- [ ] **A2.** Um painel: status, colar chave, abrir `/pro`, Sponsors (tier Pro vs menor), link do repo.
- [ ] **A3.** Tray, atalho e `SettingsSection 'donate'` passam a abrir a aba unificada.
- [ ] **A4.** i18n en / pt-BR / es; apagar chaves só da aba Donate ou reaproveitar no painel único.
- [ ] **A5.** Comentário/docs de `proCheckoutUrl`: site de claim, não Paddle.
- [ ] **A6.** Testes de UI/tabs/tray e `isAllowedExternalUrl` se mudar links.
- [ ] **A7.** `npm run screenshots`; copiar capturas novas.
- [ ] **A8.** Pacote `release-notes/AAAA-MM-DD-…` + índice (UI visível).

### Fechamento

- [ ] **C1.** Smoke: sponsor de teste → claim no site → ativar no app.
- [ ] **C2.** Conferir que scan Pro (arquivos grandes, downloads, duplicatas, previsão) ainda respeita `isPro`.
- [ ] **C3.** PRs separados (web e app) ou um epic com dois PRs; merge só com CI verde.
