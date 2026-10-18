# Graao Host — release e atualização

## Versões que precisam andar juntas

| Versão | Onde | Regra |
|---|---|---|
| `PROTOCOL_VERSION` (hoje 9) | `packages/shared/src/version.ts` | Site e servidor do app precisam ser iguais. O site na Vercel atualiza sozinho; o app não. **Todo aumento de protocolo exige uma nova versão do Graao Host publicada antes (ou junto) do deploy do site.** |
| Versão do app | `apps/host/package.json` | SemVer; exibida no app e no Painel do Windows |
| `HOST_API_VERSION` (1) | `packages/shared/src/hosting.ts` | Contrato app ↔ site ↔ funções da central |
| `min_app_version`, `latest_app_version`, `download_url` | `private.host_config` | O app consulta ao abrir e a cada 6 h: abaixo do mínimo → não hospeda e mostra "Baixar atualização"; abaixo do mais recente → aviso no rodapé/configurações |

Quando o site está numa versão de protocolo diferente da do app instalado, o pedido de sala falha com
`version_mismatch` e o site mostra "Atualize o Graao Host".

## Política de atualização

- O app **nunca** reinicia nem atualiza no meio de uma hospedagem. A atualização é: baixar o instalador novo
  (botão no app/site) e instalá-lo por cima, entre partidas.
- Instalar por cima com o app hospedando: o NSIS pede para fechar o app; fechar pela bandeja encerra a sala avisando
  os jogadores.
- Atualização automática em segundo plano (`electron-updater`) ficou de fora do MVP: exige um servidor de publicação e
  assinatura para não disparar o SmartScreen a cada versão.

## Passo a passo de um release

1. Subir a versão em `apps/host/package.json` (e `CLIENT_VERSION`/`PROTOCOL_VERSION` se o jogo mudou).
2. `pnpm --filter @graao/host dist` → `apps/host/release/GraaoHost-Setup-<v>.exe`.
3. Testes: `pnpm vitest run tests/graaoHost.e2e.test.ts tests/hostCentral.test.ts apps/server/src/desktop`,
   `pnpm exec tsx tools/hosting/packaged-check.ts --exe "apps/host/release/win-unpacked/Graao Host.exe"`,
   `pnpm exec tsx tools/hosting/three-hosts.ts --tunnel quick`.
4. (Quando houver) assinar o `.exe`.
5. Publicar o instalador como **GitHub Release** `host-v<v>` em `holaluiz/graao` (repositório público; o arquivo de
   ~122 MB não cabe no repositório — limite de 100 MB — nem deve ir para `apps/client/public`). Gerar o `.exe` a partir
   de um commit limpo, enviar esse commit e marcar a tag nele:

   ```
   gh release create host-v<v> -R holaluiz/graao --target <sha do commit do build> --title "Graao Host <v>" --notes-file <notas.md> apps/host/release/GraaoHost-Setup-<v>.exe apps/host/release/GraaoHost-Setup-<v>.exe.blockmap
   ```

   Notas em português com os passos do SmartScreen e o SHA-256 do `.exe` (modelo: a release `host-v0.1.0`). Conferir
   sem login: `curl -sIL https://github.com/holaluiz/graao/releases/download/host-v<v>/GraaoHost-Setup-<v>.exe` →
   302 e depois 200 com o tamanho do arquivo.
6. Atualizar `private.host_config` pela CLI (`supabase db query --linked --project-ref roxnhqzeznsdnsqjcmmn -f <arquivo>`):

   ```sql
   update private.host_config set value = to_jsonb('<v>'::text) where key = 'latest_app_version';
   update private.host_config set value = to_jsonb('https://github.com/holaluiz/graao/releases/download/host-v<v>/GraaoHost-Setup-<v>.exe'::text) where key = 'download_url';
   -- só se o protocolo mudou: ... where key = 'min_app_version';
   ```

   Conferir com a chave publishable: `POST https://roxnhqzeznsdnsqjcmmn.supabase.co/rest/v1/rpc/host_config` (corpo
   `{}`, cabeçalho `apikey`).
7. Deploy do site — seção "Publicar o site".

## Instalador publicado: 0.1.0 (2026-10-18)

| | |
|---|---|
| Página | https://github.com/holaluiz/graao/releases/tag/host-v0.1.0 |
| Download direto (o `download_url`) | https://github.com/holaluiz/graao/releases/download/host-v0.1.0/GraaoHost-Setup-0.1.0.exe |
| Arquivos | `GraaoHost-Setup-0.1.0.exe` (128.188.290 bytes) e `.exe.blockmap` (134.789 bytes) |
| SHA-256 do `.exe` | `7eb087616b7b69fb35ab32fe49608446f2ad7b66af48d28291d81510104da358` |
| Tag | `host-v0.1.0` → `5e0e6eb` (enviado para `origin/mvp-online-1v1` para a tag apontar para o código do app) |
| Assinatura | nenhuma — as notas da release explicam o aviso do navegador (*Manter*) e do SmartScreen (*Mais informações* → *Executar assim mesmo*) |

O `.exe` foi gerado às 16:02 a partir de `5e0e6eb` **mais** a confirmação "Encerrar a hospedagem agora?" de
`apps/host/src/renderer/renderer.ts`, que ainda não estava commitada; a próxima versão deve sair de um commit limpo.

`private.host_config` em produção: `download_url` trocado de `https://graao.vercel.app/graao-host` (404) para o link
direto acima; `latest_app_version` e `min_app_version` continuam `0.1.0`. Verificação em
`GRAAO_HOST_TEST_REPORT.md` ("Instalador publicado").

## Publicar o site (Vercel)

**Como funciona hoje** (verificado em 2026-10-18 pelos status de commit no GitHub): o projeto `holaluiz/graao` na
Vercel está ligado ao repositório pela integração Vercel↔GitHub. Todo push num branch gera uma **prévia** (protegida
por login da Vercel); o **`main` vira produção** em graao.vercel.app (merge do PR #5 às 15:03:24 UTC → deploy concluído
às 15:03:41 → `Last-Modified` do site 15:03:59). Não há `vercel.json`: comando de build e pasta de saída estão nas
configurações do projeto e funcionam (a prévia de `5e0e6eb` foi gerada sem erro). A CLI da Vercel não é necessária.
O build de produção atual não tem `VITE_SUPABASE_*`: as variáveis não existiam em Production quando ele foi feito.

Passo a passo:

1. Vercel → projeto `graao` → Settings → Environment Variables → adicionar, marcando **Production** e **Preview**:

   | Variável | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://roxnhqzeznsdnsqjcmmn.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | a chave `sb_publishable_…` de `apps/client/.env.local` (publicável; nunca uma `sb_secret_…`) |

   Não definir `VITE_SERVER_URL` (mandaria as salas de volta para um servidor dedicado). `VITE_GRAAO_HOST_DOWNLOAD_URL`
   não é necessária: o botão "Baixar Graao Host" usa o `download_url` da central.
2. As `VITE_*` entram no bundle **na hora do build**: depois de salvar, fazer **Redeploy** da prévia mais recente de
   `mvp-online-1v1` (Deployments → ⋯ → Redeploy). Um deploy anterior às variáveis continua sem elas.
3. Testar na prévia (logado na Vercel): Jogar → a lista de salas carrega; Criar sala → **Criar e hospedar** → sem o app,
   **Baixar Graao Host** abre o link da release; com o Graao Host instalado, a sala fica pronta e aparece na lista de
   outra aba. Na prévia, testar pela própria aba do site: o botão "Abrir no site" do app abre sempre graao.vercel.app.
4. Produção: PR `mvp-online-1v1` → `main` e merge. Vai para o ar o que estiver **commitado** no branch (trabalho não
   commitado de outras frentes fica de fora). Conferir antes que `PROTOCOL_VERSION` continua igual ao do app publicado
   (hoje 9 nos dois); se mudou, publicar um Graao Host novo primeiro.
5. Conferir produção — o bundle precisa citar a Supabase e o botão (vazio = build antigo; comando testado em
   2026-10-18 só contra o build antigo):

   ```bash
   S=https://graao.vercel.app; JS=$(curl -s $S/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.js'); for c in $JS $(curl -s "$S$JS" | grep -o 'assets/[A-Za-z0-9_.-]*\.js' | sort -u); do curl -s "$S/${c#/}"; done | grep -o 'roxnhqzeznsdnsqjcmmn\|Baixar Graao Host' | sort | uniq -c
   ```

## Central em produção (Supabase `roxnhqzeznsdnsqjcmmn`)

A migration `0003_graao_host.sql` foi aplicada em **2026-10-18** (histórico `supabase_migrations.schema_migrations`,
versão `20261018175557`, nome `0003_graao_host`), numa única transação, com
`supabase db query --linked --project-ref roxnhqzeznsdnsqjcmmn -f <arquivo>` (CLI logada; o arquivo é a migration
seguida do `insert` no histórico). As 19 funções `host_*` existem, `host_config` responde `tunnel_mode = quick-test`,
e um Graao Host headless publicou uma sala real na lista pública e a tirou de lá ao encerrar — evidência em
`GRAAO_HOST_TEST_REPORT.md` ("Central em produção") e `evidence/prod-central-smoke.json`.

Para repetir o smoke contra produção (precisa da chave publishable, a mesma de `apps/client/.env.local`):

```
pnpm exec tsx tools/hosting/headless-host.ts --central https://roxnhqzeznsdnsqjcmmn.supabase.co --key <publishable> --tunnel quick --link "<link do site>"
```

Migrations futuras do Graao Host: arquivo novo em `packages/database/migrations`, aplicado do mesmo jeito (ou pelo
MCP `apply_migration` / SQL Editor) — `supabase db push` não serve aqui, porque os arquivos não estão em
`supabase/migrations` com o nome no formato de timestamp. A central de desenvolvimento e os testes carregam a lista de
`tools/hosting/centralDb.ts` (`MIGRATIONS`): acrescentar a nova ali.

`0004_host_ticket_expired.sql` (ticket expirado aparece como "Pedido expirado", não "Pedido já usado"; só redefine
`host_ticket_peek` e `host_ticket_claim`) foi **aplicada em produção em 2026-10-18** do mesmo jeito (histórico
`20261018214059`). Conferido: o ticket real que tinha expirado na rodada de testes passou de `ticket_used` para
`ticket_expired` (peek e claim), dono/`security definer`/`search_path`/grants iguais, advisor sem achado novo —
`evidence/prod-0004-check.json`.

## Bloqueios atuais (precisam do dono do projeto)

| Bloqueio | Por quê | O que fazer |
|---|---|---|
| Conta/zona Cloudflare + domínio | Túnel gerenciado precisa de zona própria (ex.: `play.graao.com`) e token | Ver `GRAAO_HOST_TUNNELS.md`; enquanto isso `tunnel_mode = quick-test` |
| Site publicado desatualizado | graao.vercel.app (verificado em 2026-10-18, depois da release) ainda serve o build do `main` de 15:03 UTC, sem Supabase nem Graao Host; por isso o botão "Baixar Graao Host" ainda não existe no site no ar | Variáveis `VITE_SUPABASE_*` na Vercel (Production e Preview), Redeploy da prévia, teste, merge `mvp-online-1v1` → `main` — seção "Publicar o site" |
| Assinatura de código | Certificado pago | OV/EV ou Azure Trusted Signing |
| Teste em outro PC/rede | Exige uma segunda máquina | Roteiro em `GRAAO_HOST_TEST_REPORT.md` (TESTE C/F com PCs reais) |

Resolvido em 2026-10-18: **local de download do instalador** → GitHub Release `host-v0.1.0`, já em `download_url`
(seção "Instalador publicado").
