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
| Bots | `traversalCaps` = as capacidades do link de travessia em andamento, zero fora dele ([navegação](../world/VERTICAL_BOT_NAVIGATION.md)) |

## Replicação

`PlayerSnap` ganhou três campos (protocolo 11):

- `[20]` stamina × 100;
- `[21]` temporizadores empacotados (`packTraversal`: passos no modo, passos de planagem do voo, espera de agarre);
- `[22]` raio (mm) do topo da beirada pendurada/subindo, 0 quando nenhum.

O modo vai no `moveState` (7 pendurado, 8 subindo, 9 escalando, 10 planando). A parede, o topo e o caminho do mantle
são re-derivados da geometria a cada passo — por isso bastam esses campos para a predição reconstruir exatamente o
estado do servidor (teste `rebuilds a traversal from a quantized snapshot and converges on the server state`). O
estado do pular/correr segurado vem do comando anterior ao replay — o último reconhecido, ou nenhum botão depois de um
teleporte (`LocalPlayer.heldBefore`). Até 19/10 (segunda rodada) o cliente usava o estado da própria predição quando o
servidor ainda não tinha reconhecido nenhum comando novo: logo depois de um respawn ou reposicionamento, com latência,
o replay perdia a borda do pulo (e a planagem) e corrigia ~2 m. A decodificação do snapshot do jogador local fica em
`apps/client/src/net/snapState.ts` (a mesma no cliente e no teste de latência).

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
- **Latência simulada** (`tests/vertical.multiplayer.test.ts`): o `LocalPlayer` real do cliente no Node, 100 ms de
  atraso em cada sentido (200 ms de ida e volta), escalada → mantle → terraço e corrente oeste na pipa: mais de 80
  reconciliações, 95% abaixo de 5 cm, nenhuma acima de 35 cm, nenhum salto (> 4 m); parado, predição e servidor a
  menos de 10 cm.
- Node, partida real (mesmo arquivo): telhado da vila pela beirada (B vê LEDGE_HANG → MANTLE → A no telhado), Corrente
  do Sino até a ilha, tiro da borda da ilha acerta B no chão, a rocha da ilha bloqueia o tiro de baixo, empurrão para
  fora da borda → planagem → pouso visto por B, Tormenta fechando sobre B fere A na ilha (altitude não protege) e a
  partida termina com B vencedor.
- **Sala hospedada na aba (o modo do site, ADR-006), 19/10 à noite:** duas abas do Chromium no mesmo cliente dev
  (`graao-client-vertical`, sem `?server=`): A cria a sala (`GraaoMatchRoom` num Web Worker da aba de A), B entra pelo
  código com WebRTC e sinalização Supabase (entrou em ~0,5 s). Opções dev injetadas só na criação (`RoomHost.create`):
  aquecimento livre, sem OVNI/draft/creeps/Tormenta, nascimentos ao pé da Serra. B, dirigido como um jogador (teclas
  por `touchDown`): rota B inteira (ESCALADA → PENDURADO → MANTLE nos três paredões, cume em ~6 s); toca o sino do cume
  (o Worker valida, B vê "Sino tocando"); salta da borda leste e plana na corrente do sino até a Ilha do Sino, agarra a
  beirada e sobe — de pé no centro da ilha; plana de volta. A anfitriã recebeu pela rede a sequência de B (RUN → CLIMB
  → MANTLE → CLIMB → MANTLE → GLIDE → pouso). Correções da predição de B numa subida + planagem limpa: 133
  reconciliações, mediana 1 mm, p95 2 mm, máximo 7 mm (o mesmo que contra o servidor dedicado). Uma vez a aba
  anfitriã, em segundo plano, ficou 340 ms sem repassar mensagens (17 comandos pendentes em B): passados 0,3 s sem
  comandos de alguém no ar, a sala o faz cair sem entrada (`starvedFor`, a proteção contra quem para de mandar comandos
  para ficar suspenso) e a correção seguinte foi de 0,68 m em plena planagem. É o custo de a aba anfitriã travar, não
  da travessia; com a anfitriã jogando (aba na frente) não apareceu.
- Não medido: redes externas (dependem das máquinas do M2).
