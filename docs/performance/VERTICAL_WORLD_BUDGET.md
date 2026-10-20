# Orçamento do mundo vertical

Medido em 19/10/2026 nesta máquina (Windows 10, RX 570), com outra sessão de desenvolvimento rodando ao lado: os
números absolutos de CPU variam muito entre execuções (o `motor-bench` deu 48–83 µs no mesmo cenário); por isso a
comparação de travessia é A/B intercalada no mesmo processo.

## Geometria

| Item | Valor |
|---|---|
| Conteúdo vertical (13 placements `vert-*`) | 6.742 triângulos (maciço 3.424; Ilha do Sino 1.446; Oratório 638; Torre 554; ponte 288; pedras 50 cada) |
| Kit do mapa inteiro | 88.764 triângulos (o vertical é 7,6%) |
| Cena no chão (referência, BUDGETS.md) | ~638 mil triângulos, 87 draws |
| Draw calls novas | 2 (faixas e folhas de vento, instanciadas); o kit vertical entra nos chunks de kit já existentes |
| Pipa | ~300 triângulos, geometria/material compartilhados |

Sem trimesh novo, sem textura nova (cores do kit), sem LOD extra: partes pequenas usam o `lod: 'near'` do kit.

**Arte de rocha (4ª rodada, 19/10 à noite):** somando cada placement `vert-*` (inclui paredões, rampas, sineira etc.),
**7.782 triângulos**: maciço — patamares facetados 1.150 + 492 + 272, crista 64; Ilha do Sino (laje + rocha) 588,
Oratório 410, Torre 340; pedra flutuante 96. O kit do mapa inteiro foi a **90.872** (+2,4% sobre os 88.764 da
primeira rodada; as facetas custam mais que as lâminas de antes nos patamares, e a rocha única das ilhas, menos que as
camadas). Nenhum material ou malha nova: as rochas entram nos chunks do kit (as draw calls medidas abaixo subiram
também na vila, por mudanças de outras rodadas). Colisores do mundo: 2.363 (as ilhas trocaram 3 caixas
+ 1 cone por um casco; a crista acrescentou 3 cascos; matacões trocaram caixa por casco).

## Física

| Item | Antes | Depois |
|---|---|---|
| Colisores do mundo | 2.182 | 2.339 (+157 caixas/cilindros/cones); 2.363 depois das rodadas seguintes e dos cascos de rocha |
| Construção do mundo no servidor | 757 ms | 748 ms |
| Custo da travessia por passo (A/B, correndo e pulando na vila, pior caso: casas marcadas por toda parte) | +14 µs (sem filtro) | +8 µs com o filtro `taggedNear` (35,3 × 27,3 µs) |
| Consultas por passo no ar perto de algo marcado | 1 sobreposição + 4 raios de parede + 1–3 de topo + 1–2 sobreposições de cápsula | — |
| Consultas no ar sem nada marcado perto | 1 sobreposição | — |
| Vento | uma amostragem por passo no ar (5 volumes, aritmética pura) | — |

Com 20 personagens a ~3 passos por tick (20 Hz), o pior caso medido dá ≈ 2,1 ms de motor por tick, dentro do
orçamento de 5 ms do servidor.

## Rede

+3 inteiros por jogador no snapshot (stamina, temporizadores, beirada). Estimativa (não medida): codificados como
inteiros pelo Colyseus, 3 a 13 bytes por jogador por snapshot — no máximo ~0,26 KB/s por jogador observado a 20 Hz,
quase sempre menos (fora de travessia dois deles são 0). Eventos de sino são raros.

## Servidor com 10 participantes (2 clientes + 8 bots, ao redor da Serra)

Cenário de `tests/vertical.bots.multiplayer.test.ts` instrumentado por fase (19/10, terceira rodada; 553 ticks em
35 s; no Windows o intervalo do Colyseus é o do temporizador da plataforma, ~63 ms, e não 50 ms):

| Medida | Valor |
|---|---|
| Custo do tick | p50 3,9 ms · p95 6,3 ms · p99 10,4 ms |
| Média por tick, por fase | motor 2,19 ms (≈ 38 passos de 1/60 s → ~58 µs/passo) · bots 0,77 · snapshot 0,21 · magias 0,09 · loot 0,01 |
| Pior tick | 31 ms, dos quais 28 ms foram uma coleta de lixo maior do V8 (processo único: servidor, clientes do teste e o teste) |
| Outros picos (8–18 ms) | rajadas de passos do motor (fila de comandos acumulada) ou vários bots replanejando no mesmo tick (até 8 ms) |

Folga grande para o tick de 50 ms; o "5 ms com 20 jogadores" de BUDGETS.md não vale para 20 participantes com bots
e travessia — com 10 já é ~4 ms de mediana. Se 20 participantes virarem alvo: escalonar replanejamentos dos bots
(no máximo um ou dois por tick) e medir o servidor sozinho, sem os clientes do teste no mesmo processo.

## Navegador (quadros sintéticos)

Laço pausado, 30 quadros de aquecimento e 90 medidos com `app.frame(t)` a 60 Hz, cada um seguido de `gl.finish()`
(o tempo inclui o trabalho da GPU), 1024×768, DPR 1, modo solo, câmera de jogo. Contadores do renderer somam todos
os passes (sombra, tinta, principal).

| Vista | Mediana | p95 | Draw calls | Triângulos (todos os passes) |
|---|---|---|---|---|
| Pé da Serra olhando o maciço e as ilhas | 5,4 ms | 9,5 ms | 163 | 1,24 M |
| Mesmo ponto, olhando para o outro lado | 4,0 ms | 7,5 ms | 164 | 1,24 M |
| Largo da Vila (referência) | 4,6 ms | 7,5 ms | 163 | 1,27 M |

A Serra com o arquipélago na tela custa ~0,8 ms a mais que a vila, dentro do quadro de 16,7 ms.

Depois da arte de rocha (mesmo método, 19/10 à noite, sem outra sessão rodando ao lado — por isso tudo mais rápido):

| Vista | Mediana | p95 | Draw calls | Triângulos (todos os passes) |
|---|---|---|---|---|
| Pé da Serra olhando o maciço e as ilhas (duas medições) | 3,9 / 4,1 ms | 6,1 / 5,7 ms | 171 | 1,30 M |
| Mesmo ponto, olhando para o outro lado | 3,0 ms | 4,2 ms | 165 | 1,27 M |
| Largo da Vila (referência) | 3,1 ms | 5,9 ms | 175 | 1,37 M |

A diferença para a vila continua ~1 ms; a arte nova não mudou a ordem de grandeza.

## Quinta rodada (20/10)

- **Chão é apoio caminhável:** cada passo em que o controlador relata chão faz agora um raio curto (0,4 m) sob o eixo
  da cápsula; só na borda de um degrau ou de um penhasco, até mais quatro sob a borda. Andando no chão, quase sempre
  um raio por passo (a travessia já fazia de 1 a 7 consultas por passo no ar perto de algo marcado). Os testes de
  motor e de mapa (118) e as rotas medidas não mudaram de tempo de forma perceptível; não houve medição A/B isolada.
- **Repasse travado:** depois de um silêncio de todos, a sala pode simular até 90 passos de um jogador num tick (a
  rajada que ficou para trás). Num travamento de 350 ms são ~21 passos por jogador num tick — o mesmo custo que um
  tick normal tem em 6 ou 7 ticks, uma vez.
- **Animação:** três clipes procedurais novos (`climb`, `shimmy`, `updraft`) feitos na carga, 9 quadros-chave cada;
  nenhuma malha, textura ou draw call nova.

## Não medido nesta rodada

GPU isolada (timer query), memória da GPU, 1080p/DPR 2 e celular. Medir antes do V10.
