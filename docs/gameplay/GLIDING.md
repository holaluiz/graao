# Planagem universal (pipa)

Todo jogador pode planar um pouco, sem magia. É deliberadamente mais fraca que as magias aéreas, que continuam
valendo a escolha no Draft. Código: `CharacterMotor.step` (ramo `gliding`), ajustes em `TRAVERSAL.glide`; apresentação
em `apps/client/src/character/GliderKite.ts` (uma pipa de festa junina sobre a cabeça, ~300 triângulos, geometria e
material compartilhados) e a pose `glide` procedural.

## Ativação

Segurar **Pular** enquanto cai: depois de 0,3 s no ar, caindo a mais de 1 m/s, com pelo menos 2 m livres abaixo e
stamina ≥ 10. Um pulo pressionado no ar gasta antes o pulo duplo; o segurar seguinte abre a pipa. Dentro de uma
corrente ascendente a pipa abre após 0,12 s no ar, subindo ou não (o vento a pega).

## Física

- Queda: a gravidade atua a 45% até a queda chegar a 4,8 m/s; uma queda mais rápida é freada até 4,8 m/s. Nunca sobe
  sem corrente ascendente.
- Horizontal: até 6,6 m/s com aceleração de 9 m/s² (controle tangencial no plano local).
- Duração: 2,6 s por voo, recarregada no chão e na água. Dentro de corrente ascendente o tempo não corre, mas a
  stamina sim (8/s): pairar numa corrente acaba em ~12 s.
- Fecha ao soltar pular, ao pousar (no mesmo passo), na água, num dash, enraizado, empurrado, quando uma magia de
  movimento assume, sem tempo ou sem stamina.
- Não protege da Tormenta e não sobe acima do teto radial (42 m).

## Comparação com as magias

| | Planagem universal | Asa de Papel | Voo de Papagaio | Pulo de Pipa |
|---|---|---|---|---|
| Duração | 2,6 s | 4 s | 7 s | instantâneo |
| Queda | 4,8 m/s | 3,5 m/s | sobe (até +18 m) | pulo extra |
| Velocidade | 6,6 m/s | 9 m/s | voo | — |
| Custo | stamina | mana + recarga | mana + recarga | mana + recarga |

As magias de mobilidade podem ser lançadas planando (assumem o movimento); as outras não.

## Armas

Mãos na barra da pipa: sem tiro, sem soco, sem interação; recarregar e trocar de arma são permitidos.

## Testes

`traversal.test.ts` (abre segurando pular na descida, freia na velocidade de planagem, fecha por tempo e não reabre
no mesmo voo; soltar fecha; pousar recarrega; não abre de um pulo no chão plano; dash, enraizamento, empurrão e
personagem sem capacidade; plana até uma beirada e agarra) e `wind.test.ts` (sobe na corrente sem gastar tempo, a
stamina limita o pairar).
