# Navegador de salas

Jogar abre uma tela própria com salas reais do servidor de partidas. O registro é o matchmaking do Colyseus; Supabase não decide ocupação, vagas ou disponibilidade em tempo real.

## Descoberta HTTP

`GET /rooms` usa o mesmo host e porta de `/health`, convertido de `ws(s)` para `http(s)`. A resposta tem `Cache-Control: no-store`:

```ts
{
  protocol: 9,
  rooms: Array<{
    code: string;
    name: string;
    visibility: 'public';
    hostSessionId: string;
    hostName: string;
    humans: number;
    botsDesired: number;
    botsPlanned: number;
    capacity: number;
    phase: MatchPhase;
    protocol: number;
    available: boolean;
    canStart: boolean;
    startReason: string;
    region?: string;
  }>;
}
```

O endpoint consulta `matchMaker.query({ name: ROOM_NAME, private: false })`. As salas publicam metadados após mudanças reais de participantes, configuração, Pronto e fase. Salas privadas e encerradas não aparecem. Salas cheias ou em preparação/partida continuam visíveis com Entrar indisponível.

`region` só aparece quando `GRAAO_REGION` está configurado no servidor. Ping não é fabricado nem deduzido da região. A lista omite ping; o HUD de uma conexão já estabelecida pode mostrar o RTT medido pelos PING/PONG existentes.

## Ocupação e bots

Uma sala com um humano e nove bots planejados continua disponível para humanos. Se outro humano entrar, ela passa a anunciar dois humanos e oito bots previstos. A capacidade não é calculada pelo número de linhas de bot desenhadas pela UI.

O servidor conta as vagas reais, incluindo as mantidas para reconexão, e limita humanos + bots efetivos a 10. Quando o host inicia o Draft, a composição fica congelada e a sala deixa de aceitar entrada tardia. A validação no servidor continua valendo mesmo que a lista tenha ficado desatualizada entre o clique e a entrada.

## Criação e entrada

Criar sala envia as opções normais de autenticação, aparência e versão junto de:

```ts
{
  roomName: 'Sala de Luiz',
  visibility: 'public' | 'private',
  bots: 0..9
}
```

O servidor normaliza o nome da sala, conserva no máximo 56 caracteres e usa `Sala de [nome do host]` quando vazio. A UI limita o formulário a 40 caracteres. A capacidade apresentada é 10.

Salas públicas são criadas explicitamente no servidor dedicado usado pelo navegador. Selecionar uma linha entra por seu código real com `joinById`. Entrar por código também atende salas privadas do servidor.

## Fallback de host no navegador

A arquitetura existente de salas privadas por código foi preservada. Se o servidor dedicado estiver indisponível e o build tiver signaling configurado, o formulário oferece explicitamente **Criar sala privada neste navegador**. A pessoa que cria hospeda a sala em um Web Worker; os convidados entram por código via WebRTC.

Essas salas privadas não são inseridas artificialmente na lista pública. O signaling do Supabase serve para encontrar o host e negociar a conexão; não é um registro autoritativo de vagas ou participantes. Depois da conexão, a mesma classe `GraaoMatchRoom` controla Lobby, Pronto, bots, Draft, preparação, OVNI e combate através do adaptador `colyseusShim`.

O host precisa permanecer na página. Sua saída encerra a sala. A listagem pública continua exigindo o servidor dedicado; não é substituída por linhas de demonstração quando o servidor falha.

## Apresentação e estados

- Atualização automática a cada 5 segundos enquanto a tela está aberta e botão Atualizar para consulta manual.
- Nome da sala e host com tratamento de nomes longos; humanos conectados, bots previstos, capacidade, fase e botão Entrar.
- Paginação de três salas em telas com menos de 900 px de altura, e cinco em telas maiores, mantém ações principais visíveis sem barra de rolagem da página.
- Estados claros para consulta em andamento, lista vazia, servidor indisponível e protocolo incompatível.
- Erros de criação e entrada aparecem no navegador ou no modal correspondente. A descoberta do servidor e a conexão à sala são estados distintos.
- ESC fecha o modal aberto ou volta ao menu; não cria, abandona ou inicia uma partida silenciosamente.

## Verificação

Os testes de integração criam uma sala pública e outra privada, consultam `/rooms`, entram com outro cliente, verificam a mudança de humanos/bots, confirmam salas cheias e em Draft como indisponíveis e comprovam a remoção da sala após a saída do host. O teste de concorrência tenta 12 entradas simultâneas nas nove vagas restantes e confirma nove admissões.

Arquivos principais: `apps/server/src/app.ts`, `apps/server/src/rooms/GraaoMatchRoom.ts`, `packages/shared/src/protocol.ts`, `apps/client/src/ui/RoomBrowser.ts`, `apps/client/src/net/NetSession.ts` e `tests/prematch.multiplayer.test.ts`.
