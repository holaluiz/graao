# Bots e creeps no mundo vertical

Estado em 19/10/2026 (terceira rodada): **bots usam travessia por links planejados e tocam sinos para abrir os
links de vento de evento**; creeps continuam terrestres.

## Como funciona

O grafo de navegação (`game-core/nav.ts`) ganhou **links de travessia** — o `BotTraversalLink` do pedido — lidos da
lista `traversalLinks` do mapa. Cada link é uma aresta de mão única entre dois waypoints que não é uma caminhada:

| Campo | Onde | O quê |
|---|---|---|
| origem / destino | `from` / `to` (ids de waypoint) | pé do paredão, base da coluna, borda da ilha → topo, ilha, chão |
| tipo | `kind` | `escalada`, `corrente`, `planagem`, `salto` |
| requisitos | `NavLink.caps` (TraversalCap) e `stamina` | escalada: beirada + escalada, 70 de stamina; corrente: pipa, 85; planagem: pipa, 30; salto: beirada, 20 (`BOT_TRAVERSAL` em `game-data/traversal.ts`) |
| custo | comprimento × (5,6 / ritmo do tipo) + `cost` + `risk` × 25 | o A* compara com caminhar |
| risco | `risk` (0–1) | exposição; entra no custo |
| disponibilidade | vento de evento (`wind` com `trigger`) vale enquanto sopra **ou** se o sino que o acorda está perto do início do link (o bot vai tocá-lo); links que falharam ficam bloqueados por um tempo | `NavContext.windOn`, `NavContext.bells`, `BotNavigator.isBlocked` |

Consultas comuns (`route`, `path`) **nunca** usam links; só o planejador do bot passa `allow` com o que aquele bot
pode fazer agora (`nav.plan(from, to, { allow, extra })`).

### Execução (servidor)

- `BotNavigator` (`apps/server/src/sim/BotNav.ts`) segue o caminho; ao chegar ao início de um link, **sai** nele: não
  replaneja no meio, espera no início até ter a stamina e acompanha o desfecho:
  - de pé no nível do fim (ou em qualquer lugar de onde se chega a ele a pé) → concluído;
  - de volta ao início (pulo curto) → erro de tentativa, até 4;
  - pouso em outro lugar ou tempo esgotado (14/18/10/5 s) → **falha**; duas falhas seguidas bloqueiam o link por 45 s.
  - link de vento de evento com o vento parado: se o sino que o acorda pende perto do início, o bot desvia até ele
    (`ring`), a sala toca o sino quando ele chega ao alcance — validado como o toque de uma pessoa
    (`InteractiveSystem.ring`) — e o bot volta ao início e sai no link; um sino que não toca a tempo conta como falha.
- `botLinkIntent` (`BotBrain.ts`) dá só as entradas que uma pessoa daria: escalada — empurrar para o paredão e pular
  quando encostado; corrente — entrar na coluna, pular e segurar pular, ficar no centro até passar 2,5 m acima do fim e
  então ir até ele; planagem — segurar pular e ir para o pouso; salto — pular de novo e de novo em direção à próxima
  pedra.
- A sala dá ao motor do bot `traversalCaps` = as capacidades do link em andamento (zero fora de um link): encostado
  numa parede ou pulando quando travado, um bot não agarra beiradas que nenhum plano conhece. Durante um link o bot não
  atira nem usa magia (as mãos estão ocupadas; o servidor recusaria de qualquer forma).
- Caminhadas também falham: se o bot cai de uma caminhada (fica bem abaixo das duas pontas) ou desiste de um ponto, aquela
  aresta custa +60 m nos planos dele por 60 s — o próximo plano tenta outro caminho (sem laço sobe/desce).

### Grafo mais honesto

Ao ligar os links apareceu um defeito antigo: o grafo aceitava como caminhada o "degrau" do terraço para o lado da laje
de uma rampa (1,2 m), porque achava apoio num bloco de enchimento dentro da laje. Agora uma caminhada que sobe é
amostrada a cada 0,3 m, cada degrau entre amostras precisa caber no autostep do controlador (0,38 m + inclinação), e um
apoio só conta com 1 m livre acima dele.

## Links do mapa (`tools/world/vertical-world.ts`)

| Link | Tipo | De → para |
|---|---|---|
| `vert-lk-paredao-1..3` | escalada | rota B: pé do paredão 1 → terraço 1 → terraço 2 → cume |
| `vert-lk-corrente-mirante` | corrente | rota C: base da corrente oeste → cume |
| `vert-lk-planagem-cume` | planagem | cume → chão na frente do maciço |
| `vert-lk-corrente-sino` | corrente | base da Corrente do Sino → Ilha do Sino |
| `vert-lk-salto-0..5`, `vert-lk-salto-torre` | salto | Oratório → pedras flutuantes → Ilha da Torre |
| `vert-lk-corrente-torre` | corrente (evento) | borda norte da Ilha do Sino → Ilha da Torre, só com o sino da ilha tocando |
| `vert-lk-planagem-sino/oratorio/torre` | planagem | cada ilha → chão |

Os waypoints das ilhas e da ponte são ligados à mão (o grafo automático deixa as ilhas, a ponte e o terraço da frente do
patamar 1 como peças soltas). Cada ponto foi sondado no motor (cápsula cabe, apoio real).

## Testes

- `apps/server/src/sim/BotNav.test.ts` (grafo de mão): sai no link do pé, conclui de pé no topo, erro de tentativa ≠
  falha, descansa pela stamina sem estourar o tempo, duas falhas bloqueiam e o bot dá a volta a pé sem repetir, tempo
  esgotado falha, sem capacidade não planeja link, vento de evento só quando sopra (e calar antes de sair não conta
  falha).
- `tests/world.vertical.test.ts` (mapa real, motor real, mesmo laço do servidor a 20 Hz): rota B pelos três paredões;
  rota C pela corrente; corrente até a ilha, travessia e ponte até o Oratório; da ilha ao chão planando; pedras até a
  Ilha da Torre; **na Ilha do Sino o bot toca o sino da ilha e sobe na corrente até a Ilha da Torre; no cume toca o
  sino do cume e plana na corrente até a Ilha do Sino**; a pé, para na borda da ilha em vez de cair; sem travessia,
  nenhum link e nenhuma ilha.
- `tests/vertical.bots.multiplayer.test.ts` (servidor real, clientes SDK): um bot na ilha quando a Tormenta fecha longe
  dela plana pelo link de planagem, entra na região segura e volta a lutar; dez participantes (2 clientes + 8 bots) ao
  redor da Serra, baús só no cume e nas ilhas: o servidor aguenta (custo de cada tick medido), ninguém sai da zona
  jogável nem vira NaN, bots lutam e a Tormenta encerra a partida (quanto os bots subiram depende de quem briga primeiro:
  é relatado, não exigido).

## Limites conhecidos

- Bots tocam um sino só para abrir o link que o plano deles quer usar, nunca para negar um vento a alguém.
- Escolha de destino continua a de sempre (baú mais próximo, alvo, Tormenta): um bot sobe à ilha quando o baú dela ou o
  alvo está lá, não por estratégia de altura.
- Creeps continuam terrestres; criaturas aéreas são expansão futura.
- Sem dano de queda no jogo: um link que falha só custa tempo.
