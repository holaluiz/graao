# Navegador de salas

Jogar abre uma tela própria com salas reais. Nada é inventado: cada linha vem do servidor de partidas que roda aquela sala. Supabase não decide ocupação, vagas ou disponibilidade.

## Duas fontes reais, escolhidas pelo build

| Build | Quem roda as salas | De onde vem a lista | Selo de descoberta |
| --- | --- | --- | --- |
| `VITE_SERVER_URL` definido, ou aba aberta com `?server=` | Servidor Colyseus dedicado | `GET /rooms` (matchmaker do Colyseus) | ● Servidor disponível |
| Sem servidor dedicado e com `VITE_SUPABASE_*` (o modo publicado hoje) | Quem cria a sala, num Web Worker do próprio navegador | Lista ao vivo: cada host anuncia a própria sala | ● Lista ao vivo |
| Sem nenhum dos dois | — | Nenhuma | Online indisponível (só treino) |

A escolha fica em `GraaoApp` (`dedicatedServer()` / `signalingConfigured()`) e define, juntas, a lista, Criar sala e Entrar. Não há mistura: numa aba de teste com `?server=` tudo vai para o servidor dedicado; no build publicado tudo é hospedado no navegador.

### Por que a lista ao vivo existe

O deploy atual (Vercel) não tem servidor dedicado: quem cria a partida hospeda (ver [BROWSER_HOSTED_ROOMS.md](../architecture/BROWSER_HOSTED_ROOMS.md)). Antes desta mudança, JOGAR nesse build mostrava sempre “Servidor indisponível”, e criar sala dependia de um botão alternativo escondido no formulário. Era o mesmo modelo do Warcraft III: o PC do host é o servidor e um serviço só lista as partidas. Agora o build publicado lista as salas hospedadas.

## Servidor dedicado: `GET /rooms`

Mesmo host e porta de `/health`, convertido de `ws(s)` para `http(s)`, com `Cache-Control: no-store`:

```ts
{ protocol: 9, rooms: RoomListing[] }
// RoomListing = RoomMetadata da sala + { code, phase, region? }
```

O endpoint consulta `matchMaker.query({ name: ROOM_NAME, private: false })` e passa cada metadado por `parseRoomListing` (o mesmo validador do cliente). As salas publicam metadados a cada mudança real de participantes, configuração, Pronto e fase. `region` só aparece com `GRAAO_REGION` no servidor. A tela consulta ao abrir e a cada 5 s enquanto está aberta; Atualizar consulta na hora.

## Salas hospedadas: lista ao vivo

`apps/client/src/net/host/roomDirectory.ts`.

1. A sala de quem hospeda é o mesmo `GraaoMatchRoom` do servidor, no Worker. Toda vez que ela chama `setMetadata` (mudança de humanos, bots previstos, Pronto, fase), o shim do Colyseus repassa o metadado à página (`FromRoom { t: 'metadata' }`).
2. `RoomHost` monta a linha (`metadado + código`), valida com `parseRoomListing` e, **se a sala for pública e estiver online**, anuncia em Supabase Realtime Presence no canal `graao-rooms`. Salas privadas e treinos não são anunciados.
3. Quem abre Salas disponíveis assina o mesmo canal e vê o estado de presença atual, que se atualiza sozinho. Cada anúncio é validado de novo; por código vale o mais recente; abertas primeiro; no máximo 60 linhas.
4. A linha some quando o host retira o anúncio (sala fechada, host saiu) ou quando a conexão Realtime do host acaba (aba fechada). Atualizações do mesmo host são agrupadas (no máximo uma a cada 0,9 s) para respeitar o limite do Realtime.

O Supabase funciona aqui como um mural: só repassa o que o host da sala afirma. Quem decide quem entra é a sala do host. `onJoin` recusa sala cheia (`ROOM_FULL`), Draft ou partida em andamento (`IN_PROGRESS`) e versão diferente (`VERSION_MISMATCH`), então uma linha desatualizada ou falsa só termina numa recusa clara. Entrar usa o mesmo caminho por código (`PeerLink`, WebRTC).

Uma aba abre um único canal, compartilhado entre o próprio anúncio e a lista. Sem lista aberta e sem sala anunciada, o canal é fechado.

## Validação das linhas

`parseRoomListing` (`packages/shared/src/validate.ts`) aceita uma linha só se:

- o código for `GR-` + 4 caracteres do alfabeto de códigos;
- a sala for pública e tiver host;
- `humanos ≥ 1`, `bots previstos ≤ 9` e `humanos + bots previstos ≤ capacidade ≤ 10`;
- a fase existir e não for `CLOSED`.

Textos são limpos (controle, espaços, 56 caracteres no nome, nome do host pelo `sanitizeName`). `available` só é verdadeiro no `LOBBY`, com vaga humana e o mesmo protocolo. Uma sala de outra versão aparece como **Outra versão**, sem Entrar.

## Ocupação e bots

Uma sala com 1 humano e 9 bots previstos continua aberta para humanos. Se outro humano entrar, ela anuncia 2 humanos + 8 bots previstos (verificado com três abas: a linha mudou 0,4 s depois do clique em Entrar). A capacidade vem da sala, não do número de linhas desenhadas.

A sala conta as vagas reais, inclusive as reservadas para reconexão, e limita humanos + bots efetivos a 10. Quando o host inicia o Draft, a composição congela e a sala deixa de aceitar entrada; ela continua na lista como “Escolhendo habilidades”, “Preparando” ou “Em partida”.

## Criação e entrada

Criar sala envia, junto das opções normais de versão, nome e aparência:

```ts
{ roomName: 'Sala de Luiz', visibility: 'public' | 'private', bots: 0..9 }
```

A sala normaliza o nome (até 56 caracteres; `Sala de [nome do host]` quando vazio). O formulário limita a 40, mostra a conta “Você + N bots = N+1 de 10 participantes” e, no modo hospedado, avisa que o host mantém a sala na própria aba. No modo dedicado com servidor fora do ar, a alternativa **Criar sala privada neste navegador** continua disponível quando há signaling.

O build publicado tem um botão só, **Criar sala**, que hospeda na aba. Com `VITE_GRAAO_HOST=on` o botão principal vira **Criar e hospedar** (Graao Host) e a aba passa a ser a alternativa “Ou hospedar nesta aba do navegador (sem instalar)”; desligado desde 19/10/2026 (ADR-006 em [MASTER_GAME_DESIGN_2.md](../product/MASTER_GAME_DESIGN_2.md#decisões-adrs-curtos)).

Entrar pela lista usa o código real da linha. Entrar por código atende também salas privadas.

## Estados

- Carregando, lista vazia (com **Criar a primeira sala**), lista ou servidor indisponível (com **Tentar de novo**; o modo ao vivo tenta de novo sozinho a cada 5 s), versão incompatível e build sem online.
- Sala cheia, em andamento ou de outra versão: linha visível, **Indisponível** com o motivo.
- Erros de criação e entrada: no painel e no formulário aberto.
- Descoberta (“Servidor disponível”, “Lista ao vivo”) e conexão à sala (“Conectado à sala”, só no lobby) são selos diferentes.
- Ping: “—”. Nada mede a latência antes de entrar, e ela nunca é estimada. No jogo, o F3 mostra o RTT medido pelos PING/PONG existentes.
- ESC fecha o formulário aberto ou volta ao menu.

## Verificação

- `apps/client/src/net/host/roomDirectory.test.ts`: linhas válidas, 1+9, 2+8, 10+0, recusa de mais participantes que vagas, sala privada, fechada, código inválido, versão diferente, limpeza de textos e presença → uma linha por sala.
- `tests/hostRoom.test.ts`: a sala no Worker publica sua linha (1+9 → 2+8 → Draft indisponível → fechada).
- `tests/prematch.multiplayer.test.ts`: `/rooms` real do servidor dedicado, salas públicas e privadas, entrada, cheia/Draft indisponíveis, remoção após o host sair e 12 entradas simultâneas nas 9 vagas restantes.
- Navegador (18/10/2026, cliente sem HMR, sem servidor dedicado): três abas, criar → ver → entrar → linha atualizada → host sai → linha some. Ver [VERIFICATION.md](VERIFICATION.md).

Arquivos principais: `apps/client/src/ui/RoomBrowser.ts`, `apps/client/src/net/host/roomDirectory.ts`, `RoomHost.ts`, `colyseusShim.ts`, `apps/server/src/app.ts`, `apps/server/src/rooms/GraaoMatchRoom.ts` e `packages/shared/src/validate.ts`.
