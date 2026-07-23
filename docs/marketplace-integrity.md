# Verificação de integridade do marketplace

> **A Blackfin nunca diz que uma extensão é segura.** Ela verifica que os bytes
> que chegaram são os bytes que o registro publicou — e diz, na mesma frase, o
> que isso **não** prova. Esta página existe porque a diferença entre as duas
> coisas é a diferença entre segurança e teatro.

Ratificado em [RFC #12 (confiança)](superpowers/rfcs/2026-07-12-trust.md), D1 =
**divulgação sobre contenção**. A Blackfin não hospeda bytes, não curadoria
nada e não opera nenhuma chave ([RFC #13](superpowers/rfcs/2026-07-12-marketplace-arch.md)).
A verificação, portanto, é feita **sobre um artefato para o qual o usuário
aponta**, e reporta o que encontrou — ela **não** devolve um booleano
"confiável/seguro".

Implementação: `app/src/lib/marketplace/integrity.ts` (função pura, sem I/O,
nunca lança) e `app/src/models/marketplace.ts` (o modelo de dados).

## As três verificações

| Verificação | O que faz | O que devolve |
|---|---|---|
| **Checksum** | Computa o SHA-256 **sobre o buffer baixado**, antes de qualquer escrita ou descompactação, e compara em **tempo constante** (`timingSafeEqual`) ao digest que o registro publicou. | `checksum-only` se bate; `failed` se não. |
| **Assinatura** | Se — e somente se — o pacote traz uma assinatura Ed25519 **e** existe uma raiz de confiança configurada, verifica com o `crypto` do Node. | `verified-signature` / `unverifiable` / `failed`. |
| **Proveniência** | Interpreta um registro de proveniência (de onde veio, ref, autor **alegado**) em fatos, alegações e ignorância honesta. | `present` (com o autor sempre marcado como *não verificado*) ou `absent`. |

Nenhuma delas devolve, registra ou sugere "seguro".

## O veredito — `IntegrityVerdict`

Um union tipado em que **nenhum estado mente**. Recusa é um valor, não uma
exceção (a forma de `CleanupOutcome`, `app/src/lib/workspace/cleanup.ts:24`).

| Veredito | Significa | Instalação |
|---|---|---|
| `verified-signature` | Uma chave da raiz de confiança assinou **estes** bytes. | permitida |
| `checksum-only` | Os bytes conferem com o que o registro publicou. **Sem assinatura** — não prova quem publicou. | permitida |
| `unsigned` | O mesmo fato que `checksum-only`, dito da outra direção. | permitida |
| `unverifiable` | Não foi possível verificar (offline, sem digest publicado, ou sem raiz de confiança). **Não é evidência de adulteração.** | **bloqueada** |
| `failed` | Os bytes **não** conferem, ou uma assinatura presente não bateu. | **recusada** |

`failed` **recusa; não avisa.** Não há botão "instalar mesmo assim", checkbox,
preferência, flag de linha de comando ou variável de ambiente que contorne isso.
Um checksum que não bate é a única evidência de adulteração que a Blackfin tem, e
ignorá-la a pedido do usuário é jogar fora a única defesa que ele tem.

`unverifiable` **também bloqueia**, mas **não** é o mesmo que `failed`: pode ser
só que o usuário está offline. A ação é "tentar de novo com conexão".

## O que a verificação de checksum de v1 GARANTE

- Que os bytes chegaram íntegros: **descarta corrupção de download e um
  mirror/CDN adulterado**, desde que o *índice* com os checksums venha do
  registro por TLS.
- Que uma alteração posterior no arquivo em disco é detectável, via o hash
  pinado no momento da instalação (`IInstalledIntegrity`).

## O que ela NÃO garante — e a UI não pode sugerir que garante

- **Não protege contra um registro comprometido.** Se o atacante controla o
  registro, ele publica o pacote malicioso *e* o checksum dele. O checksum
  confere. Um checksum publicado pela mesma entidade que publica o artefato
  prova integridade de **transporte**, não autenticidade de **origem**.
- **Não protege contra um publisher malicioso.** Um autor que publica uma Skill
  hostil publica um pacote perfeitamente íntegro de uma Skill hostil.
- **Não prova quem publicou.** Isso exige assinatura, e assinatura exige uma raiz
  de confiança — que **não existe em v1**.
- **Não é antivírus.** A Blackfin verifica que a extensão é *a que foi
  publicada*, não que ela é *boa*. Ela não lê o conteúdo para decidir se é
  maliciosa.
- **Não contém nada depois da instalação.** A Blackfin não executa a extensão —
  o agente executa. Não há sandbox, e a documentação e a UI não usam essa palavra.

## Assinatura: um slot pronto, inerte por enquanto

O verificador Ed25519 existe e é testado. Mas enquanto **não houver raiz de
confiança configurada** — a realidade de v1, porque a Blackfin não opera nenhuma
chave — uma assinatura presente produz `unverifiable: no-trust-root`, **nunca**
`verified-signature`. A decisão sobre a raiz de confiança (quem assina, como a
chave chega ao app, rotação, revogação) é de [#12](https://github.com/matbrgz/blackfin/issues/12),
e nenhum item pode ser exibido como "assinatura verificada" enquanto ela não for
tomada. Sem essa honestidade, um selo verde transferiria confiança sem
transferir garantia — pior do que nenhum selo.

## Por que sobre o buffer, e antes de escrever

O hash é computado sobre os **bytes baixados**, não sobre o arquivo já escrito, e
**antes** de qualquer descompactação. Verificar depois de escrever é verificar
depois de ser tarde; descompactar um arquivo não verificado já é dar ao atacante
o controle dos caminhos de saída. Os bytes escritos são exatamente os bytes
verificados — sem janela TOCTOU.
