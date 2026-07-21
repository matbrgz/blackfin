# Handoff — Blackfin: fleet de features + loop de melhorias via react-grab
<!-- 2026-07-21 13:51 · branch main @ 22a750dcff · sessão anterior (Claude) -->

## TL;DR
Blackfin (fork GitHub Desktop → Desktop Plus → matbrgz/blackfin, "Agentic Control Center for Developers"). A sessão entregou ~20 PRs: várias waves de features do roadmap via worktree-agents, um sync completo do upstream, e — na parte final — melhorias de UI dirigidas pelo usuário via **react-grab** (ele aponta um elemento no app rodando e descreve a mudança). **Estado agora:** `main` limpo, 0 PRs abertos, dev server caído. **Próximo passo:** reiniciar o dev server e esperar a próxima requisição react-grab do usuário — cada uma vira `issue → worktree-agent (ou edição própria) → PR → merge`.

## Objetivo
Continuar implementando o backlog do roadmap e as melhorias de UI que o usuário pede via react-grab, **sempre** pelo fluxo: uma issue por item → implementar o núcleo puro/testável → gate limpo → PR contra `matbrgz/blackfin` `main` → merge. Restrições fixas: comentar/reivindicar a issue **antes** de codar (outros agents compartilham o backlog); nunca commitar direto em `main` (branch sempre); segurança (segredos nunca persistidos/exibidos; todo input de CLI/arquivo é não-confiável).

## Estado atual
- **Repo/branch:** `/Users/jobs/Dev/1-opendigital/a-projetos/blackfin` @ `main` (`22a750dcff`)
- **Working tree:** limpo
- **PRs abertos:** 0 · **Issues abertas:** 30
- **Atrás do upstream:** 1 commit (`536c06c69c Update Winget package name` — trivial, rebrand)
- **Dev server:** CAÍDO (o `yarn start` do usuário no terminal dele foi parado; porta 3000 vazia)
- **Worktrees de agent:** 0 (limpos)

## Feito (verificado — mergeado em main, CI verde)
Waves de fleet (worktree-agents, cada um gated tsc+unit+prettier+eslint):
- #96 GitHub Issues provider (#73) · #97 Blackfin Skill (#66) · #98 AI-attribution model (#70) · #99 CLI checkpoint (#64)
- #100 CLI dispatch (#62) · #101 attribution filters (#71) · #102 read-only CLI commands (#63)
- #103 CLI mutating commands + policy (#65) · #104 diff annotations (#68) · #105 branch-from-task (#74)
- #106 batch annotations (#69) · #109 TaskProvider abstraction (#75) · #110/#108 rebrand cleanup · #111/#107 issue-triage workflow adaptado
- **Sync upstream v3.6.3.1** (52 commits: named stashes, Copilot conflict-resolution, PKCE OAuth) — 80 testes ok, branding Blackfin preservado nos 3 conflitos de identidade.

Loop react-grab (features de UI que o usuário pediu apontando no app):
- **#114** seletor de escopo de projeto no `AppRail` (`app/src/ui/rail/app-rail.tsx`) — "Todos os projetos" vs. um projeto
- **#116** clicar num context file abre um **leitor modal in-app com o visual do diff** (`app/src/ui/workspace/context-file-reader-dialog.tsx`) — reusa o `highlight` worker + `.cm-s-default` do diff de verdade
- **#117** dismiss do popover do rail por outside-click / Escape
- **#119** dropdown do escopo passou a usar `SectionFilterList` (busca + teclado, igual ao `branch-list.tsx`)

Integração geral confirmada: `tsc` limpo e **598 testes** passam em main após todas as waves.

## Feito (NÃO verificado)
- **O visual das features de UI de react-grab (#114/#116/#119) não foi confirmado a olho por mim** — worktree-agents não veem render. Confiança alta (#116 e #119 reusam componentes reais do diff/filter-list), mas o **usuário ainda vai confirmar no dev app** o tamanho/ancoragem do dropdown no rail estreito (68px) e o look do leitor. Se estiver torto, é o próximo ajuste.

## Em andamento — onde parei exatamente
Nenhuma edição pela metade. Estava **aguardando a próxima requisição react-grab do usuário**. O `yarn start` do terminal dele acabou de ser parado (notificação), então a sessão interativa está fora do ar. Não há trabalho pendente commitável.

## Próximos passos
1. **Quando o usuário voltar a pedir uma melhoria via react-grab:** abrir 1 issue (`gh issue create`, label `area:*`+`type:feature`, corpo com o alvo exato do react-grab + design), reivindicar, e implementar. Para UI, preferir **worktree-agent** (não perturba o dev app do usuário) e **verificar o visual rebuildando** antes do merge.
2. **Reabrir o dev app** (é o usuário quem roda, no terminal dele, pra durar): `cd /Users/jobs/Dev/1-opendigital/a-projetos/blackfin && yarn start`. Se der `Couldn't launch... run yarn build:dev`, rodar `yarn build:dev` uma vez antes. NÃO segurar a porta 3000 com um yarn start em background meu (morre e conflita — ver gotchas).
3. **Follow-up deferido, precisa de design do usuário:** escopar de verdade Agents/Docs/Disk a um projeto selecionado (hoje o seletor só afeta Home/Code via `selectRepository`). É decisão de produto — **perguntar como cada seção deve filtrar** antes de construir.
4. **Sync trivial:** `git merge upstream/main` traz 1 commit (winget). Baixa prioridade.
5. **Backlog restante (30 issues):** a maioria é RFC-gated (extensions/marketplace/MCP dependem das RFCs #10/#13 não escritas) ou runtime/UI. As RFCs destravam o maior número mas são decisão de arquitetura do usuário.

## Decisões e porquês
- **Fluxo fleet:** cada issue → worktree-agent isolado → PR → merge. Reivindicar comentando **antes** de codar (backlog compartilhado).
- **Merge:** `gh pr merge <n> --repo matbrgz/blackfin --merge --delete-branch` funciona (mergeei ~20 PRs assim nesta sessão). Só mergear com CI core verde — **ignorar E2E Windows (flaky)**, esperar os builds de compile (macOS/Windows/Linux).
- **react-grab é dev-only:** import dinâmico dentro de `if (__DEV__)` em `app/src/ui/index.tsx`; sai do bundle de produção por dead-code-elimination. Pacote `grab` em `app/package.json` devDependencies.
- **Seletor de escopo do rail** reusa `dispatcher.selectRepository` (null = All → Home); não inventou store de escopo paralelo.
- **Incrementos puros:** a complexidade mora em funções puras (sem I/O, nunca lançam; falha é resultado) com testes `node:test`; wiring de runtime/UI é deferido quando não dá pra verificar headless.

## Armadilhas / gotchas (todas custaram tempo nesta sessão)
- **`main` local desatualizado → agent parte de base velha.** Sempre `git checkout main && git merge --ff-only origin/main` **antes** de lançar um worktree-agent. Aconteceu com #119 (partiu de antes do #117 e quase reverteu o dismiss); resolvido com rebase onto origin/main.
- **zsh NÃO faz word-split de variável sem aspas.** `prettier --write $FILES` vira no-op silencioso e o CI Lint quebra. Passar **caminhos explícitos**.
- **Bytes NUL literais em `.ts` → git trata como binário** (diff ilegível). Usar escape `\u0000`, nunca o byte cru. (Pegou #98/#106.)
- **Windows CRLF:** teste que lê arquivo e compara byte-a-byte com uma string embutida (template literal normaliza CRLF→LF) falha só no Windows. Normalizar `\r\n`→`\n` e/ou pinar `eol=lf` no `.gitattributes`. (Pegou #97.)
- **Worktrees isolados não têm `node_modules`** (layout com `app/node_modules`). No prompt do agent: `ln -sfn <repo>/node_modules node_modules` e idem `app/node_modules` (nunca commitar os symlinks). Sem isso o `tsc` do agent reporta ~416 erros fantasmas — **não os descarte como "ambientais"**, resolva o node_modules.
- **Tela branca no dev app = renderer não carregou.** O build `build:dev` referencia `renderer.js` de `http://localhost:3000/build/renderer.js` (publicPath do dev-server). O app packaged **precisa do `yarn start`** (dev server) rodando; sem ele → `ERR_CONNECTION_REFUSED` no renderer → branco. Prod build (`yarn build:prod`) é standalone (`src="renderer.js"` relativo).
- **`yarn start` em background meu é frágil** — morreu 3x nesta sessão (lifecycle do harness, ~3h de limite). Deixar o **usuário** rodar no terminal dele. Se eu segurar a 3000, o `yarn start` dele dá `EADDRINUSE`.
- **`.github/workflows/*.lock.yml` (gh-aw, "DO NOT EDIT")** está no `.prettierignore` — não reformatar.
- **Vendored `file:` deps** (`desktop-notifications`, `desktop-trampoline`) buildam com `node-gyp rebuild && tsc`; um `yarn add` no `app/` recopia sem rodar o build (`tsc: command not found` no contexto do script) e quebra o `tsc`. Recuperar buildando o dist na mão: `PATH=<repo>/node_modules/.bin:$PATH; (cd app/node_modules/<mod> && tsc)`.

## Como validar
```bash
cd /Users/jobs/Dev/1-opendigital/a-projetos/blackfin
git status --short                 # limpo
node_modules/.bin/tsc --noEmit --skipLibCheck -p tsconfig.json 2>&1 | grep -E '^app/'   # vazio = ok
node script/test.mjs app/test/unit/cli-*.ts app/test/unit/task-*.ts   # suítes verdes
gh pr list --repo matbrgz/blackfin --state open   # 0
# dev app (rodar no SEU terminal, não em background do agente):
# yarn start   (se pedir, yarn build:dev antes)
```

## Em aberto / bloqueios / perguntas pro usuário
- **Design do escopo por seção** (Agents/Docs/Disk filtrados a 1 projeto): como cada seção deve se comportar? Decisão de produto — perguntar antes de implementar.
- **Confirmação visual** das features react-grab (#114/#116/#119) no dev app — especialmente o dropdown `SectionFilterList` no rail de 68px.
- **RFCs #10/#13** (definir Plugin/Skill/MCP): destravam ~metade do backlog mas são decisão de arquitetura do usuário — ele quer que um agent rascunhe, ou decide junto?
