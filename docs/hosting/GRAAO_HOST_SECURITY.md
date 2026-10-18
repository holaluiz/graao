# Graao Host — segurança

Um PC doméstico passa a aceitar conexões de outros jogadores. Princípio: **o público só alcança a partida**; tudo que
controla o app fica dentro do PC; nenhum segredo administrativo existe no executável.

## Superfícies

| Superfície | Exposta a | Proteção |
|---|---|---|
| Servidor da partida (Colyseus) | Internet, **só pelo túnel** (`127.0.0.1:<porta>` ← cloudflared) | Rotas: matchmaking (`joinById`), WebSocket, `/health`, `/rooms`. `create` recusado sem a chave do processo. Mensagens validadas (`validate.ts`), limite de 90 msg/s por cliente, payload WebSocket ≤ 4 KB, 10 vagas (reserva atômica do Colyseus; 13 entradas simultâneas → 10), versão de protocolo checada, aparência validada |
| Controle do servidor | Só o processo do app | IPC (`parentPort`), nunca HTTP; comandos validados |
| Janela do app | Só o app | Conteúdo local, `contextIsolation`, `sandbox`, `nodeIntegration: false`, CSP `default-src 'none'`, `connect-src 'none'`, navegação e janelas novas bloqueadas, IPC aceita só a própria janela (`senderFrame` `file://`), argumentos checados |
| Protocolo `graao-host://` | Qualquer página (o navegador pergunta antes) | Só duas ações (`host`, `open`); ticket UUID + segredo 32–128 chars; nunca carrega URL de servidor; vincular PC novo exige clique; PC vinculado recusa outra conta |
| API central | Internet | Tabelas com RLS e sem políticas; só funções `security definer` com `search_path=''`; grants mínimos (anon/authenticated/service_role); segredos guardados como SHA-256; limite de tickets |
| Edge Function de túnel | Internet | Exige token de sessão válido; token Cloudflare só nos segredos da função; limpeza só com segredo de admin |
| Executável | Quem baixa | Fuses do Electron: `RunAsNode` off, `NODE_OPTIONS` off, `--inspect` off, só carrega `app.asar`, integridade do asar; sem assinatura ainda (ver Release) |

Não existe API HTTP local do app (decisão: o protocolo + a central bastam). Por isso não há porta em `localhost` para
ataques de CSRF/DNS rebinding: o servidor da partida escuta em loopback, mas só aceita o que qualquer jogador já pode
fazer pelo túnel, e nada administrativo.

## Segredos

| Segredo | Onde | Nunca |
|---|---|---|
| Token administrativo da Cloudflare | Segredos da Edge Function (Supabase) | No app, no site, no repositório |
| Token do conector do túnel | Memória do app → variável de ambiente `TUNNEL_TOKEN` do `cloudflared` | Em disco, em linha de comando, em log (mascarado) |
| `service_role` da Supabase | Só no ambiente da Edge Function | No app/site |
| `GRAAO_SERVER_SECRET` (gravar resultados) | Só servidores oficiais | No bundle desktop (o modo desktop não lê `.env`) |
| Segredo da instalação | `identity.json` cifrado com DPAPI (`safeStorage`) | Em texto puro quando a cifra está disponível |
| Token de sessão | Memória do app; SHA-256 na central | Em disco |

Rotação: o segredo do túnel gerenciado é trocado a cada sessão de hospedagem (o token anterior para de funcionar);
sessões expiram em 12 h sem heartbeat; revogação imediata pela conta.

## Confiança no host

Quem hospeda controla o próprio PC e pode alterar o processo. Por isso: partidas do Graao Host não gravam histórico nem
ranking, não recebem o token Supabase de ninguém, e convidados só entregam um nome e uma aparência. O host vê o
tráfego da partida (como qualquer servidor), **não** o IP dos convidados nem eles o dele (a Cloudflare fica no meio).

## Privacidade na lista pública

A lista mostra nome da sala, nome do host, contagens, fase e um id opaco por conta (hash, não o id da conta). Não
publica IP, caminhos, credenciais, token do túnel nem identificadores de máquina.

## Riscos conhecidos

- Código de sala privada (31⁴ ≈ 923 mil combinações) resolve o endpoint; não há limite de taxa por IP em
  `host_room_endpoint` (PostgREST). Mitigação futura: limite na borda/Edge Function.
- Rotas de matchmaking do Colyseus não têm limite de taxa próprio; o túnel de teste limita a 200 requisições em voo.
- Sem assinatura de código: o SmartScreen avisa; usuários podem ser enganados por instaladores falsos. Publicar só pelo
  site oficial e assinar antes de divulgar.
