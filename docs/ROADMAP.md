# Blackfin — síntese da arquitetura e do roadmap

Documento de fechamento da auditoria que produziu as 83 issues em
[matbrgz/blackfin/issues](https://github.com/matbrgz/blackfin/issues).

Ele existe para responder três perguntas que uma lista de issues não responde
sozinha: **o que estamos construindo**, **em que ordem**, e **o que ainda não
sabemos**.

---

## 1. Visão de produto

Blackfin é o **centro de controle do desenvolvedor que trabalha com agentes**.

O problema que ele resolve não é escrever código — os agentes já fazem isso. O
problema é que o desenvolvedor perdeu a visão do próprio ambiente. O contexto que
governa o comportamento dos agentes está espalhado por dezenas de arquivos que
ninguém consegue ver de uma vez: um `CLAUDE.md` na raiz de cada projeto, outro em
`~/.claude/` que alcança **todos** os projetos e é invisível de dentro de qualquer
um deles, skills, comandos, subagents, hooks, servidores MCP configurados em uma
dúzia de formatos diferentes. Quando um agente faz algo surpreendente em um
projeto, a causa frequentemente está em um arquivo que aquele projeto nunca ouviu
falar.

Ao mesmo tempo, o trabalho se fragmentou: worktrees paralelos, cada um com um
agente trabalhando em uma tarefa diferente, e nenhuma tela que responda "o que
está acontecendo em cada um deles". E o disco enche de `node_modules`, `.venv`,
`target` e caches que ninguém sabe quando foi a última vez que serviram para
alguma coisa.

Blackfin observa, organiza e controla tudo isso. Ele mostra o que existe, de onde
veio, qual o escopo, quem é afetado, e o que está quebrado. Ele deixa o
desenvolvedor instalar, habilitar, mover e remover — com segurança e com
confirmação. E, criticamente, ele deixa **os agentes participarem**: uma CLI que
descreve a si mesma permite que o agente pergunte "que contexto se aplica a mim
aqui?" e reporte "é isto que eu escrevi, é aqui que o trabalho parou".

Duas coisas que Blackfin **não é**, e cuja recusa é uma decisão de produto, não
uma limitação temporária: **não é uma IDE** e **não hospeda agentes**. Não há
terminal embutido, não há navegador embutido, não há Monaco como editor de
projeto, não há supervisão de processos de agente. O agente é do usuário, roda
onde o usuário quiser, e o Blackfin conversa com ele — não manda nele. Toda vez
que uma feature parecer exigir que o Blackfin vire um desses, a feature está
errada, não a fronteira.

---

## 2. Arquitetura da informação

O rail global à esquerda é a moldura. Git é **um** dos destinos, não o quadro em
que os outros são pendurados — essa inversão é a mudança conceitual que separa o
Blackfin do cliente git de onde ele veio.

| Destino | O que ele responde |
|---|---|
| **Home** | O que precisa da minha atenção agora, em todos os projetos? |
| **Agents** ⚠️ | Que contexto governa meus agentes, em que escopo, e o que está quebrado? |
| **Code** | O trabalho de git no projeto selecionado (o cliente que herdamos). |
| **Docs** | O que está documentado em cada projeto? |
| **Disk** | O que posso recuperar e o que é lixo de desenvolvimento? |

⚠️ **"Agents" é um nome errado e sabemos disso.** A seção não contém agente
nenhum — contém aquilo que *condiciona* os agentes. Um rótulo que promete controle
de agentes é um convite a implementar controle de agentes, exatamente o que
decidimos não fazer. A decisão está aberta em [#16](https://github.com/matbrgz/blackfin/issues/16),
e ela precisa ser tomada **antes** de a CLI publicar um comando com esse nome —
um comando publicado é um contrato com os agentes, e renomear depois quebra
contrato.

A arquitetura definitiva do rail é decidida em
[#15](https://github.com/matbrgz/blackfin/issues/15).

---

## 3. Modelo de escopo

Todo item de contexto ou extensão existe em um escopo, e o escopo é o que
determina **quem é afetado**.

- **Global** — vive em `~/.claude/`, `~/.codex/` e afins. Alcança todos os
  projetos da máquina. É o escopo mais perigoso, porque é o único invisível de
  dentro dos projetos que ele governa.
- **Project** — vive na raiz do repositório. Afeta quem trabalha nele.
- **Worktree** — afeta só aquela ramificação de trabalho. Ainda pouco explorado
  pelos agentes, mas é onde o modelo de frota se apoia.
- **Inherited** — o item não é do projeto, mas se aplica a ele. Hoje o Blackfin
  literalmente diz *"Nothing steers what gets written here"* em projetos que têm
  um `~/.claude/CLAUDE.md` regendo-os. É uma falsidade que ele tem os dados para
  desmentir, e [#23](https://github.com/matbrgz/blackfin/issues/23) a corrige.
- **Override** — o projeto contradiz ou substitui o global. O agente escolhe um
  em silêncio; o usuário não vê qual. [#24](https://github.com/matbrgz/blackfin/issues/24).

**A linha dura que atravessa o modelo inteiro:** configuração *detectada no
sistema de arquivos* e dado *gerenciado pelo Blackfin* nunca se misturam. Um item
detectado é do usuário — o Blackfin o lê, o exibe, e não o move nem o reescreve.
Um item instalado é do Blackfin — ele sabe de onde veio, em que versão, e pode
atualizá-lo ou removê-lo. Nenhum caminho de código promove um no outro. Isso é o
que impede o Blackfin de corromper arquivos que ele não entende inteiramente.

---

## 4. Fluxo do marketplace

`descobrir → avaliar → instalar → configurar → usar → atualizar → remover`

Cada etapa tem uma issue, e a etapa **avaliar** é a que justifica o resto:

1. **Descobrir** — busca, categorias, autores ([#48](https://github.com/matbrgz/blackfin/issues/48)).
2. **Avaliar** — versões, changelog, compatibilidade, procedência e **as permissões que o item pede, antes de instalar** ([#49](https://github.com/matbrgz/blackfin/issues/49)).
3. **Instalar** — atrás de uma revisão explícita de permissões. Sem instalação de um clique ([#50](https://github.com/matbrgz/blackfin/issues/50)), com verificação de integridade ([#51](https://github.com/matbrgz/blackfin/issues/51)).
4. **Configurar** — escopo, habilitar/desabilitar ([#40](https://github.com/matbrgz/blackfin/issues/40)).
5. **Usar** — o agente encontra o item porque ele está onde o agente procura.
6. **Atualizar** — manual, com pinning, e recusando sobrescrever edições do usuário ([#41](https://github.com/matbrgz/blackfin/issues/41)).
7. **Remover** — com revalidação, relatório de impacto e lixeira ([#30](https://github.com/matbrgz/blackfin/issues/30)).

**A honestidade que ancora essa milestone inteira:** `app-window.ts` roda com
`nodeIntegration: true` e `contextIsolation: false`. Não existe fronteira de
privilégio dentro do Blackfin. E o processo que de fato *executa* uma extensão
pertence ao agente, não ao Blackfin. Portanto **nenhuma issue promete
isolamento**. A única defesa real do Blackfin é *não escrever*, e as permissões
declaradas por um autor são afirmações que ele não consegue fazer valer. Isso está
escrito nas issues, não escondido.

---

## 5. Caminho crítico

```
#10 rfc-taxonomy
     └── #11 rfc-extension-model
           ├── #12 rfc-trust ──────────► M2 (git/url), M3 inteiro, #65 (CLI que muta)
           ├── #14 rfc-persistence ────► #55 (worktrees), #35 (registro local)
           └── #21 arch-reconcile ─────► #22 ctx-unified-catalog ──► quase todo o M1
```

Uma única issue, [#10](https://github.com/matbrgz/blackfin/issues/10), governa o
grafo inteiro: enquanto não estiver decidido **o que é um Plugin, o que é uma
Skill e o que é um MCP**, nada abaixo pode ser modelado sem chutar.

**Três trilhas correm em paralelo desde o dia um**, e é isso que impede a equipe
de ficar bloqueada esperando as RFCs:

- **Design** — [#17](https://github.com/matbrgz/blackfin/issues/17) → [#18](https://github.com/matbrgz/blackfin/issues/18) destrava toda a UI.
- **CLI** — [#61](https://github.com/matbrgz/blackfin/issues/61) → [#62](https://github.com/matbrgz/blackfin/issues/62) destrava checkpoints e atribuição de IA.
- **Independentes** — [#56](https://github.com/matbrgz/blackfin/issues/56) (estado de PR), [#67](https://github.com/matbrgz/blackfin/issues/67) (âncoras de diff), [#72](https://github.com/matbrgz/blackfin/issues/72) (domínio de tarefas) não dependem de nada.

---

## 6. Primeira onda: as dez issues para começar

Escolhidas para desbloquear o máximo do grafo e para pagar a dívida que a própria
auditoria encontrou.

| # | Issue | Por que agora |
|---|---|---|
| [#10](https://github.com/matbrgz/blackfin/issues/10) | RFC: taxonomia de Plugin, Skill e MCP | Raiz do grafo. Tudo espera. |
| [#83](https://github.com/matbrgz/blackfin/issues/83) | Três tokens CSS que o SCSS usa e nunca declara | Bug entregue. O badge principal está invisível e o rail não mostra foco de teclado. |
| [#81](https://github.com/matbrgz/blackfin/issues/81) | Confirmar antes de remover um artefato | A limpeza apaga sem perguntar. Estabelece o padrão que #30 e #31 vão herdar. |
| [#82](https://github.com/matbrgz/blackfin/issues/82) | Expor os resultados da limpeza | O dispatcher joga fora toda recusa de segurança. XS. |
| [#17](https://github.com/matbrgz/blackfin/issues/17) | Design tokens | Destrava a trilha de UI inteira, em paralelo às RFCs. |
| [#61](https://github.com/matbrgz/blackfin/issues/61) | Arquitetura da CLI | Destrava a trilha de participação do agente, em paralelo. |
| [#15](https://github.com/matbrgz/blackfin/issues/15) | RFC: destinos do rail | Precisa fechar antes de a CLI batizar comandos. |
| [#84](https://github.com/matbrgz/blackfin/issues/84) | "Nunca escaneado" ≠ "sem contexto" | O app afirma um fato que não apurou. Corrigir antes que #22 construa em cima. |
| [#67](https://github.com/matbrgz/blackfin/issues/67) | Âncoras estáveis de diff | Sem bloqueador. Bloqueia todo o M6. |
| [#11](https://github.com/matbrgz/blackfin/issues/11) | RFC: modelo de domínio da extensão | Assim que #10 fechar. |

---

## 7. Riscos

**A taxonomia pode não convergir.** Claude Code, Codex, Cursor e Copilot discordam
sobre o que as palavras significam. Uma taxonomia que não sobrevive aos doze
agentes suportados vira um modelo que precisa de exceções — e exceções em um
modelo de domínio são dívida permanente. *Mitigação:* [#10](https://github.com/matbrgz/blackfin/issues/10)
é uma RFC com opções e trade-offs explícitos, não um design imposto.

**Segredos podem vazar no momento em que o MCP for modelado.** Hoje nenhum segredo
é persistido — mas **por acidente de tipo, não por design**: `IContextFile`
simplesmente não tem campo de conteúdo bruto. No instante em que
[#43](https://github.com/matbrgz/blackfin/issues/43) começar a dar `JSON.parse`
nesses arquivos, o acidente acaba, e `putInventory` serializa o modelo inteiro
para o IndexedDB. *Mitigação:* [#43](https://github.com/matbrgz/blackfin/issues/43)
e [#45](https://github.com/matbrgz/blackfin/issues/45) **saem na mesma release**.
Se o discover for sozinho com um campo `value`, os tokens já estarão no disco dos
usuários, e remover o campo depois não apaga as linhas.

**Clonar a extensão de um estranho com a configuração de git de hoje é perigoso.**
`clone.ts` seta `GIT_CLONE_PROTECTION_ACTIVE: 'false'` e passa `--recursive` —
corretos para o usuário clonar o próprio repo, inaceitáveis para código de
terceiros. *Mitigação:* [#38](https://github.com/matbrgz/blackfin/issues/38) exige
um clone endurecido e um teste de regressão que impede esses dois flags de voltar.

**`request()` em `http.ts` anexa `Authorization: Bearer`.** Usá-lo para buscar uma
URL colada pelo usuário vazaria o token dele para um host arbitrário. *Mitigação:*
[#39](https://github.com/matbrgz/blackfin/issues/39) exige um cliente sem
credenciais, e diz isso no comentário do próprio arquivo.

**O filtro de atribuição pode mentir por omissão.** Se não houver dado de
atribuição e o filtro estiver ligado, ele colapsa o diff inteiro — afirmando "o
agente não escreveu nada disto". O usuário concluiria que revisou o trabalho do
agente quando não revisou nada. *Mitigação:* em
[#71](https://github.com/matbrgz/blackfin/issues/71), "sem dado ⇒ filtro
desabilitado" é um **requisito de segurança** com critério de aceite próprio, não
uma sutileza de UX. E o tipo de atribuição não tem estado `human` — é
`'agent' | 'unknown'`. Tornar "humano" *irrepresentável* é o que impede a feature
de mentir daqui a seis meses.

**Desabilitar pode virar mentira.** Para a maioria dos agentes, "desabilitado" não
é um conceito — o agente simplesmente lê um diretório inteiro. *Mitigação:*
[#40](https://github.com/matbrgz/blackfin/issues/40) deriva uma estratégia real
(`quarantine`/`native`/`unsupported`) e **recusa** a opção de só registrar o item
como desabilitado. Se o Blackfin não consegue fazer o agente parar de carregar
aquilo, ele não escreve "Disabled" na tela.

---

## 8. Decisões arquiteturais em aberto

Estas não têm resposta ainda, e as issues que dependem delas dizem isso em vez de
fingir que têm:

1. **Plugin é um contêiner de Skills e MCPs, ou um par deles?** ([#10](https://github.com/matbrgz/blackfin/issues/10))
2. **Uma Skill é portátil entre agentes, ou é específica de um?** ([#10](https://github.com/matbrgz/blackfin/issues/10))
3. **Um servidor MCP é uma extensão, ou uma capacidade da qual uma extensão depende?** ([#10](https://github.com/matbrgz/blackfin/issues/10))
4. **Qual é a raiz de confiança do marketplace?** Sem ela, verificação de integridade é só checksum — que não protege contra um registry comprometido nem contra um publisher malicioso. ([#12](https://github.com/matbrgz/blackfin/issues/12), [#51](https://github.com/matbrgz/blackfin/issues/51))
5. **Como a CLI alcança o app rodando?** Socket local, arquivo de lock + IPC, HTTP em localhost, ou modo headless lendo os mesmos bancos. Cada um tem um custo de segurança real: qualquer coisa escutando localmente é alcançável por qualquer coisa na máquina. ([#61](https://github.com/matbrgz/blackfin/issues/61))
6. **O que um agente pode fazer sem supervisão?** Um agente que pode invocar o Blackfin para *mudar* coisas é um agente que pode ser vítima de prompt injection para fazê-lo. ([#65](https://github.com/matbrgz/blackfin/issues/65))
7. **"Agents" continua sendo o nome da seção?** ([#16](https://github.com/matbrgz/blackfin/issues/16))
8. **Curadoria do marketplace: aberta, humana, ou dois níveis?** ([#54](https://github.com/matbrgz/blackfin/issues/54) recomenda "aberta, e declarada como aberta" até existir uma raiz de confiança.)

---

## 9. Correções na chave do worktree — um erro do briefing, corrigido

O `docs/BRIEFING.md` afirma que `gitDir` é a âncora estável de um worktree. **Não
é.** `getRepositoryType()` (`rev-parse.ts:45-52`) resolve `--git-dir` a partir do
caminho consultado, então dentro de um worktree vinculado ele devolve
`<common>/.git/worktrees/<nome>` — ou seja, `gitDir` **também** muda ao trocar de
worktree, junto com `Repository.path` (`repositories-store.ts:524`).

A chave que sobrevive é `[commonGitDir + worktreeName + generation]`. O contador de
geração é o que impede um worktree removido e recriado no mesmo caminho de herdar
o checkpoint de um trabalho anterior. Está em
[#55](https://github.com/matbrgz/blackfin/issues/55).

---

## 10. Relatório de execução

| | |
|---|---|
| **Issues criadas** | 83 (8 épicos + 71 de implementação + 4 correções de dívida da auditoria) |
| **Issues reaproveitadas** | 0 — o fork tinha **zero** issues próprias |
| **Issues atualizadas** | 83 (segunda passada convertendo dependências em links `#N`) |
| **Duplicatas evitadas** | 0 possíveis — não havia backlog anterior |
| **Milestones** | 8 (M0–M7), todas as issues atribuídas |
| **Labels** | 44 (`area:*`, `type:*`, `priority:p0–p3`, `size:xs–xl`, `status:*`) |
| **Sem milestone** | 0 |
| **Sem label** | 0 |

**Uma armadilha de fork que quase custou caro:** `gh issue list` estava retornando
issues de **`desktop-plus/desktop-plus`** — o upstream — porque o `gh` não tinha
repositório padrão e, em um fork, ele cai no repositório pai. Rodar `gh issue
create` teria aberto dezenas de issues no projeto de outra pessoa. Corrigido com
`gh repo set-default matbrgz/blackfin`, e toda chamada passa `--repo
matbrgz/blackfin` explicitamente.

**Validação executada, com resultado real:** os 83 corpos foram verificados antes
da criação — 15 seções obrigatórias presentes e na ordem (7 nos épicos), cercas de
código balanceadas, zero bytes NUL. Após a criação: 83 issues abertas, 0 sem
milestone, 0 sem label, 0 chaves de manifesto deixadas sem resolver em link.

---

## 11. Tabela completa das issues

Legenda de tamanho: XS < S < M < L < XL.

| Issue | Título | Milestone | Prioridade | Tamanho | Bloqueadores |
|---|---|---|---|---|---|
| #2 | EPIC: Product and architecture foundations | M0 | p0 | — | — |
| #3 | EPIC: A visual language for a control center | M0 | p0 | — | — |
| #4 | EPIC: The Context Control Center | M1 | p0 | — | — |
| #5 | EPIC: The extension system | M2 | p1 | — | — |
| #6 | EPIC: Marketplace | M3 | p2 | — | — |
| #7 | EPIC: Fleet and worktrees | M4 | p1 | — | — |
| #8 | EPIC: The blackfin CLI — making agents participants | M5 | p0 | — | — |
| #9 | EPIC: Review intelligence | M6 | p1 | — | — |
| #10 | RFC: Define what a Plugin, a Skill, and an MCP server actually are | M0 | p0 | L | — |
| #11 | RFC: The extension domain model — kind, scope, source, state, manifest | M0 | p0 | L | #10 |
| #12 | RFC: Extension trust, provenance and permissions | M0 | p0 | L | #11 |
| #13 | RFC: Marketplace architecture — registry, distribution, versioning | M0 | p1 | L | #11, #12 |
| #14 | RFC: Filesystem truth, Blackfin metadata, and cache — a persistence contract | M0 | p0 | M | #11 |
| #15 | RFC: The rail's destinations and what each one owns | M0 | p0 | M | — |
| #16 | Research: is "Agents" the right name for a section holding skills, MCPs and plugins? | M0 | p1 | S | #15 |
| #17 | Establish Blackfin's design tokens: colour, type scale, spacing, density | M0 | p0 | L | — |
| #18 | Component library: cards, badges, status indicators, trees, tables | M0 | p1 | L | #17 |
| #19 | Empty, loading, skeleton and error states as a system | M0 | p1 | M | #18 |
| #20 | Keyboard navigation and focus model across the control center | M0 | p1 | M | #18 |
| #21 | Reconcile the shipped workspace inventory with the extension model | M0 | p0 | M | #11 |
| #22 | Unify the workspace inventory into a single extension catalog | M1 | p0 | L | #21, #14 |
| #23 | Show inherited global context inside the project context view | M1 | p1 | M | #22 |
| #24 | Detect and surface conflicts between global and project context | M1 | p1 | M | #23 |
| #25 | Detect duplicated, orphaned and unused context items | M1 | p2 | M | #22 |
| #26 | Extension details: origin, scope, agents, affected projects, permissions | M1 | p1 | L | #22, #18 |
| #27 | Repair broken references in context files | M1 | p2 | M | #26 |
| #28 | A safe editor for context files with diff-before-save | M1 | p1 | L | #22 |
| #29 | Detect external modification and prevent silent overwrite | M1 | p1 | M | #28 |
| #30 | A safe delete flow for context and extension items | M1 | p0 | M | #26 |
| #31 | Move a context item between global, project and worktree scope | M1 | p2 | M | #30 |
| #32 | Global search and filters across every scope and kind | M1 | p1 | M | #22 |
| #33 | Command palette | M1 | p1 | M | #32, #20 |
| #34 | A context health report, per project and globally | M1 | p2 | M | #24, #25 |
| #35 | The local extension catalog and installation registry | M2 | p0 | L | #11, #14 |
| #36 | Register an already-installed item without moving it | M2 | p1 | M | #35 |
| #37 | Install an extension from a local folder or file | M2 | p1 | M | #35 |
| #38 | Install an extension from a Git repository | M2 | p1 | M | #35, #12 |
| #39 | Install an extension from a URL or a manifest | M2 | p2 | M | #38 |
| #40 | Enable and disable an extension per scope | M2 | p1 | M | #35 |
| #41 | Manual update and version pinning | M2 | p2 | M | #35 |
| #42 | Export a scope's agent stack | M2 | p3 | S | #35 |
| #43 | Detect and normalize MCP configurations across supported agents | M2 | p0 | L | #10 |
| #44 | MCP server details: transport, command, args, consumers, affected projects | M2 | p1 | M | #43, #26 |
| #45 | Never display secret values: classify env vars by presence, not content | M2 | p0 | S | #43 |
| #46 | Structural validation and an explicit, opt-in connection test | M2 | p2 | M | #44, #45 |
| #47 | Remote registry client and catalog cache | M3 | p1 | L | #13 |
| #48 | Marketplace browse: search, categories, authors, popularity | M3 | p1 | L | #47, #18 |
| #49 | Marketplace item page: versions, changelog, compatibility, provenance | M3 | p1 | L | #47, #12 |
| #50 | Install from the marketplace behind an explicit permission review | M3 | p0 | M | #49, #35 |
| #51 | Integrity verification: checksums, signatures, provenance | M3 | p0 | M | #12, #47 |
| #52 | Update channels: stable, beta, experimental | M3 | p2 | M | #47 |
| #53 | Organizational policy: allowlists and blocking | M3 | p2 | M | #12 |
| #54 | Publishing and curation | M3 | p3 | L | #47, #51 |
| #55 | Persist worktree metadata: lineage, status and checkpoint | M4 | p0 | L | #14 |
| #56 | Persist pull request state so board lanes can be derived | M4 | p1 | M | — |
| #57 | Fleet view: the project → worktree hierarchy with live state | M4 | p1 | L | #55, #18 |
| #58 | Worktree checkpoints, written by the agent | M4 | p1 | M | #55, #64 |
| #59 | Worktree board: status lanes, manual and derived | M4 | p2 | L | #55, #56 |
| #60 | Activity feed across projects and worktrees | M4 | p2 | L | #55 |
| #61 | The blackfin CLI: architecture and its protocol to the running app | M5 | p0 | L | — |
| #62 | Publish a machine-readable schema of Blackfin CLI commands | M5 | p0 | M | #61 |
| #63 | Read-only CLI commands: context, extension, project and worktree inspect | M5 | p1 | M | #62, #22 |
| #64 | CLI: checkpoint set and get | M5 | p1 | S | #63, #55 |
| #65 | CLI: mutating commands, behind safety controls | M5 | p1 | M | #63, #12 |
| #66 | The official Blackfin Skill that teaches agents the CLI | M5 | p1 | M | #62 |
| #67 | Stable annotation anchors that survive hunk expansion and re-diff | M6 | p0 | L | — |
| #68 | Add unresolved line annotations to the side-by-side diff | M6 | p1 | L | #67, #18 |
| #69 | Batch unresolved diff annotations into a single Copilot turn | M6 | p1 | M | #68 |
| #70 | AI attribution: record and render agent-authored line ranges | M6 | p1 | L | #67, #65 |
| #71 | Attribution filters: review what the agent wrote, skip what you did | M6 | p2 | M | #70 |
| #72 | An internal task domain, independent of any provider | M7 | p1 | M | — |
| #73 | GitHub Issues provider and the task list | M7 | p1 | L | #72 |
| #74 | Create a branch from a task, and keep the link | M7 | p1 | M | #73 |
| #75 | A TaskProvider abstraction for trackers that are not git forges | M7 | p1 | L | #73 |
| #76 | A GraphQL foundation, built only as far as Linear and Projects require | M7 | p1 | M | #75 |
| #77 | Linear provider | M7 | p2 | L | #75, #76 |
| #78 | Jira provider | M7 | p2 | L | #75 |
| #79 | Sync status back to the tracker, with honest failure modes | M7 | p2 | M | #73 |
| #80 | GitHub Projects v2 board | M7 | p3 | XL | #76 |
| #81 | Confirm before removing an artifact — cleanup deletes with no dialog | M1 | p0 | S | — |
| #82 | Surface cleanup outcomes — the dispatcher throws away every refusal | M1 | p0 | XS | — |
| #83 | Define three CSS tokens the shipped SCSS uses but never declares | M0 | p1 | S | — |
| #84 | Stop reporting a never-scanned project as a project with no agent context | M1 | p1 | S | — |
