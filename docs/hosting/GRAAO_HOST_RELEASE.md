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
5. Publicar o instalador num endereço HTTPS estável (GitHub Releases do repositório ou bucket R2 do graao) — arquivo
   de ~122 MB não cabe no repositório (limite de 100 MB do GitHub) nem deve ir para `apps/client/public`.
6. Atualizar `private.host_config`: `latest_app_version`, `download_url` e, se o protocolo mudou,
   `min_app_version`.
7. Deploy do site.

## Bloqueios atuais (precisam do dono do projeto)

| Bloqueio | Por quê | O que fazer |
|---|---|---|
| Migration `0003_graao_host.sql` não aplicada no Supabase | Supabase CLI sem login nesta máquina e sem MCP nesta sessão | `supabase login` → `supabase db push` (ou colar no SQL Editor). Sem isso o app/site mostram "Serviço de hospedagem ainda não configurado" |
| Conta/zona Cloudflare + domínio | Túnel gerenciado precisa de zona própria (ex.: `play.graao.com`) e token | Ver `GRAAO_HOST_TUNNELS.md`; enquanto isso `tunnel_mode = quick-test` |
| Local de download do instalador | Arquivo grande | GitHub Release ou R2; preencher `download_url` (ou `VITE_GRAAO_HOST_DOWNLOAD_URL` no build do site) |
| Assinatura de código | Certificado pago | OV/EV ou Azure Trusted Signing |
| Teste em outro PC/rede | Exige uma segunda máquina | Roteiro em `GRAAO_HOST_TEST_REPORT.md` (TESTE C/F com PCs reais) |
