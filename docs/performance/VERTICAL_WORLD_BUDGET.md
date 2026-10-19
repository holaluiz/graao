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

## Física

| Item | Antes | Depois |
|---|---|---|
| Colisores do mundo | 2.182 | 2.339 (+157 caixas/cilindros/cones) |
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

## Não medido nesta rodada

GPU isolada (timer query), memória da GPU, 1080p/DPR 2 e celular. Medir antes do V10.
