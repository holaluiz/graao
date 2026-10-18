# Descoberta de salas

A tela **Salas disponíveis** junta três fontes reais (nunca linhas de exemplo). Todas passam por validação de
contagem (humanos + bots ≤ capacidade ≤ 10) antes de aparecer.

| Fonte | Quando | Quem é autoridade | Atualização |
|---|---|---|---|
| **Graao Host** (`host_public_rooms`) | Build com `VITE_SUPABASE_URL` (ou `VITE_GRAAO_HOST_API`) | O servidor no PC do host; a central só repete o heartbeat (5 s) | A cada 5 s com a tela aberta |
| Salas no navegador (Presence `graao-rooms`) | Sem servidor dedicado, com Supabase | A sala no Web Worker do host | Ao vivo (Realtime) |
| Servidor dedicado (`GET /rooms`) | `VITE_SERVER_URL` ou `?server=` | O servidor | A cada 5 s |

As linhas do Graao Host aparecem primeiro, com o selo **GRAAO HOST**; códigos repetidos entre fontes ficam com a do
Graao Host. Quando a última sala do Graao Host fecha, a linha sai na consulta seguinte (≤ 5 s), mesmo que a outra fonte
não mude; ao sair da tela a lista do Graao Host é esquecida, para a volta (por exemplo depois de "O HOST ENCERROU A
PARTIDA") nunca mostrar a sala que acabou de fechar. Medido em produção em 2026-10-18: ~3 s entre "Encerrar
hospedagem" e a linha sumir da lista aberta de outro jogador.

## Modelo público (`GraaoPublicRoom`)

`roomId, roomCode, name, hostId, hostPlayerId (opaco), hostDisplayName, maxParticipants = 10, humanCount,
desiredBotCount, effectiveBotCount, visibility, status (LOBBY | DRAFT | DEPLOYMENT | MATCH | RESULTS | CLOSED),
available, endpointId, protocolVersion, createdAt, lastHeartbeatAt` — `packages/shared/src/hosting.ts`.

- Só salas **públicas**, com heartbeat há menos de 30 s, de instalações não revogadas.
- `available` = lobby, vaga humana livre, protocolo igual ao do site. Salas cheias ou em partida aparecem como
  indisponíveis, com o motivo.
- O navegador não altera nada disso: as contagens vêm só do heartbeat do host, validadas no SQL (`host_room_counts`).
- Ping: "—" até ser medido (não é estimado).

## Entrar

- Pela lista: `host_room_endpoint(código)` → `wss://…` → `Client(endpoint).joinById(código, {nome, aparência})`.
- Por código digitado: tenta primeiro o Graao Host; se não existir, segue o caminho antigo (servidor dedicado ou sala
  no navegador). Sala privada do Graao Host: o código é o convite (não aparece na lista, mas resolve).
- Link `/?sala=GR-XXXX` (o botão "Abrir sala no navegador" do app): entra direto; `#host=<chave>` torna o visitante o
  host (o fragmento nunca vai para servidor nenhum e é apagado da barra de endereço).

O servidor do host é quem decide: sala cheia, partida em andamento ou versão diferente são recusadas por ele, com
mensagem em português; uma linha velha na lista só leva a uma recusa clara.
