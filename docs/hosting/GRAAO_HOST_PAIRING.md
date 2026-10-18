# Graao Host — vinculação do PC à conta

Objetivo: o site acorda o aplicativo sem copiar tokens; o PC só hospeda para a conta que a pessoa confirmou nele; uma
conta não toma o Graao Host de outra.

## Identidades

| O quê | Onde fica | Para quê |
|---|---|---|
| Sessão Supabase do jogador (anônima ou conta) | Navegador (`localStorage`, supabase-js) | Criar tickets (`auth.uid()`); **nunca** sai para o PC de um host |
| Ticket `{id, segredo}` | Site (memória/`sessionStorage`) → link → app | Pedido de uso único, 5 min; a central guarda só `sha256(segredo)` |
| Instalação `{installationId, installSecret}` | `%APPDATA%\Graao Host\identity.json`, segredo cifrado com a chave do usuário do Windows (`safeStorage`/DPAPI) | Provar que é o mesmo PC; a central guarda `sha256(installSecret)` |
| Token de sessão | Memória do app | Publicar, heartbeat, encerrar; 12 h deslizantes; nunca gravado em disco |
| Chave de dono da sala | = segredo do ticket; a sala guarda o SHA-256 | Quem a apresenta no `joinById` é o host da sala |

## Sequência

```
site                         central (Supabase)                    Graao Host
 | host_ticket_create(hash) ─►  ticket PENDING (owner = auth.uid())
 | abre graao-host://host?t&s ─────────────────────────────────────► recebe link (2ª instância → 1ª)
 |                               ◄── host_ticket_peek(t, s, inst) ── (ainda não usa o ticket)
 |                               ── {sala, dono, linked, conflict} ─►
 |                                                                    linked=false → "Hospedar para <nome>?" [VINCULAR]
 |                               ◄── host_ticket_claim(t, s, inst, installSecret, versão, protocolo)
 |                               ── {hostId, sessão, código, config} ►  (ticket CLAIMED; instalação criada/validada)
 | host_ticket_status (1/s) ──►  CLAIMED → "preparando"
 |                               ◄── host_room_publish(sessão, t, endpoint)  (só com /health respondendo pelo túnel)
 | ◄── READY + endpoint ──────    ticket READY
 | joinById(endpoint, código, hostKey = s)  ─────────────────────────► sala: owner
```

## Regras (todas no SQL, testadas em `tests/hostCentral.test.ts`)

- Ticket: uso único (`ticket_used`), expira em 5 min (`ticket_expired`), segredo errado = `ticket_not_found` (não diz
  se existe), até 20 por conta a cada 10 min (`rate_limited`).
- Versão: o ticket leva o `PROTOCOL_VERSION` do site; o app manda o dele no claim; diferença → ticket `FAILED`
  `version_mismatch` (o site mostra "Atualize o Graao Host").
- Instalação nova → criada para o dono do ticket. Instalação existente: dono diferente → `installation_conflict`
  (não há como "assumir"); revogada → `installation_revoked`; segredo diferente → `installation_secret`.
- Primeira vez de uma conta neste PC: o app **exige o clique** em "Vincular e hospedar". Um site malicioso pode criar
  um ticket para a própria conta e abrir o link no PC de alguém, mas (a) o navegador pergunta antes de abrir o app,
  (b) o app mostra o nome da conta e só vincula com confirmação, (c) um PC já vinculado recusa outra conta.
- Revogar: o dono chama `host_revoke(hostId)` (site/console); a sala sai da lista na hora e o próximo heartbeat do app
  recebe `revoked` e encerra.
- Desvincular no app ("Configurações → Desvincular este PC") gera uma identidade nova; a próxima sala pede confirmação.

## O que nunca acontece

- Token Supabase do navegador em URL, no app ou no PC de outro jogador.
- `service_role` no app ou no site (só na Edge Function, do lado da Supabase).
- Um link `graao-host://` apontar o app para outro servidor: a central é fixa no build (variáveis de ambiente só para
  desenvolvimento).
