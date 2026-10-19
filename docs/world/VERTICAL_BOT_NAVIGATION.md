# Bots e creeps no mundo vertical

Estado em 19/10/2026: **parcial, de propósito.** O movimento vertical dos humanos foi validado primeiro.

## O que os bots fazem

- **Nenhuma travessia própria:** a sala dá aos bots `traversalCaps = 0` — não agarram beirada, não escalam, não
  planam (o `BotBrain` pula quando bloqueado; sem o bloqueio eles entrariam em estados que a navegação não planeja).
  Ventos ainda agem sobre eles como sobre qualquer corpo (física igual para todos).
- **Usam a trilha da Serra:** as rampas entram no grafo pelos nós automáticos de rampas do kit, e o mapa tem nove
  waypoints `vert-wp-*` (pé da trilha → topo de cada rampa → cume, tipo `trilha`/`mirante`). Teste: um bot dirigido
  pelo `BotNavigator` e pelo `botIntent` do servidor sai do pé do maciço e chega ao cume sem nenhum modo de travessia
  (`tests/world.vertical.test.ts`).
- **Ilhas fora do grafo:** nenhuma aresta caminhável liga o chão às ilhas; `route` não acha caminho, então nenhum
  bot escolhe ir para lá (teste). Não há link de corrente, escalada ou queda controlada que um bot possa seguir.

## Link de travessia (projeto, não implementado)

Quando os bots ganharem travessia, o grafo recebe arestas tipadas (`BotTraversalLink`): origem, destino, tipo
(`escada`, `escalada`, `salto`, `corrente`, `queda`), requisitos (capacidade, stamina mínima, magia), custo, risco e
disponibilidade (vento de evento ligado?). O navegador só escolhe links cujo requisito o bot cumpre; um link que
falha duas vezes fica indisponível por um tempo (sem laço de sobe/desce). Até lá, nenhum link desses existe — nada a
bloquear.

## Creeps

Continuam terrestres (não sobem rampas de propósito nem usam ilhas). Criaturas aéreas: expansão futura.

## Limites conhecidos

- Bot não foge da Tormenta pela corrente nem desce de ilha planando (não chega lá).
- Bot no cume desce pela trilha (mesmo grafo).
- Bot empurrado para fora da trilha cai no chão e replaneja (sem dano de queda).
