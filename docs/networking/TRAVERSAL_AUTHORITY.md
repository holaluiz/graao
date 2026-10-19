# Autoridade da travessia vertical

O servidor (Colyseus dedicado, Graao Host ou sala no navegador do host — todos rodam a mesma `GraaoMatchRoom`) é a
autoridade. O cliente prevê com o mesmo `CharacterMotor` e reconcilia.

## O que o cliente envia

Só intenção, no `InputCmd` de sempre (`[seq, wish×3, aim×3, buttons]` a 60 Hz): direção de movimento e os botões
pular/correr/mirar/atirar. Não existe mensagem "escalar", "agarrar", "planar" ou "estou no vento": agarrar, subir,
soltar, planar e o vento saem da geometria + intenção dentro do passo do servidor. Interações (sino) vão por
`WORLD_USE {s, id, k: 1}`.

## O que o servidor valida (por construção)

| Item | Onde |
|---|---|
| Estado atual, transições válidas | `CharacterMotor.step` (mesmo código do cliente) |
| Geometria, distância, colisão | sondas Rapier no mundo do servidor (filtradas pelos baús/portas/barreiras da sala) |
| Stamina, duração, esperas | `CharacterState.stamina/glideSteps/grabCooldown` (passos inteiros) |
| Limites de velocidade | velocidades fixas por estado; o servidor simula, o cliente não declara posição |
| Altitude | teto radial de 42 m |
| Permissões de ação | `TRAVERSAL_ACTIONS`: tiro, soco, magia, recarga, interação e troca recusados conforme o estado |
| Sino | alcance (2,6 m), intervalo, já tocando; liga os ventos da sala; tempo controlado pelo servidor |
| Bots | `traversalCaps = 0` |

## Replicação

`PlayerSnap` ganhou três campos (protocolo 11):

- `[20]` stamina × 100;
- `[21]` temporizadores empacotados (`packTraversal`: passos no modo, passos de planagem do voo, espera de agarre);
- `[22]` raio (mm) do topo da beirada pendurada/subindo, 0 quando nenhum.

O modo vai no `moveState` (7 pendurado, 8 subindo, 9 escalando, 10 planando). A parede, o topo e o caminho do mantle
são re-derivados da geometria a cada passo — por isso bastam esses campos para a predição reconstruir exatamente o
estado do servidor (teste `rebuilds a traversal from a quantized snapshot and converges on the server state`). O
estado do pular/correr segurado vem do último comando reconhecido (bordas de subida iguais no replay).

Eventos novos: `{ e: 'bell', id, on, by }`. `WORLD_STATE.b`: sinos tocando `[id, ms restantes]` para quem entra.

## Versionamento

`PROTOCOL_VERSION` 11 e `CLIENT_VERSION` 0.11.0: um cliente antigo é recusado na entrada (não interpreta
`moveState` 7–10 errado). Mapa (`mapVersion` 5) e prefabs entram no `MAP_HASH`: builds com colisões diferentes não
jogam juntas. **O Graao Host 0.1.0 publicado não joga com este site até um instalador novo (publicar exige
aprovação).**

## Predição e reconciliação (medido)

- Node, servidor real + 2 clientes SDK (`tests/traversal.multiplayer.test.ts`): B vê CLIMB → MANTLE → A em pé no
  terraço; GLIDE e A subindo na corrente; o sino só toca de perto, avisa os dois clientes, liga o vento no motor da
  sala e recusa um segundo toque.
- Chromium (predição) × servidor Node local, sala dev: escalada → mantle → terraço com correção máxima de 1,4 mm; rota
  B completa até o cume com correção máxima de 5,9 mm. Sem teleporte visível ao subir na beirada.
- Não medido: latência simulada alta (a ferramenta de latência da suíte não foi aplicada a estes cenários) e redes
  externas (dependem das máquinas do M2).
