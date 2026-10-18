# Graao Host — instalador Windows

## Gerar

```bash
pnpm install
node tools/hosting/fetch-cloudflared.mjs          # cloudflared 2026.9.3, SHA-256 + assinatura conferidos
node tools/hosting/make-icon.mjs                  # ícone (já versionado em apps/host/resources)
pnpm --filter @graao/host dist                    # build + electron-builder --win nsis --x64
```

Saída: `apps/host/release/GraaoHost-Setup-<versão>.exe` (≈ 122 MB: Electron 43.7.7 + servidor 6,3 MB + cloudflared
53 MB). A configuração baked no app vem de `GRAAO_HOST_CENTRAL_URL`/`GRAAO_HOST_CENTRAL_KEY`, ou de
`VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` (ambiente ou `apps/client/.env.local`) — **só valores
publicáveis**; o build recusa chaves secretas. `GRAAO_HOST_SITE_URL` (padrão `https://graao.vercel.app`).

## O que o instalador faz

| Item | Detalhe |
|---|---|
| Tipo | NSIS assistido, **por usuário** (sem administrador, `asInvoker`), pt-BR, pasta alterável |
| Pasta padrão | `%LOCALAPPDATA%\Programs\Graao Host` |
| Atalhos | Menu Iniciar e Área de Trabalho "Graao Host" |
| Protocolo | `HKCU\Software\Classes\graao-host` → `"…\Graao Host.exe" "%1"` (`resources/installer.nsh`; o electron-builder só registra protocolos no macOS) |
| Executar ao terminar | Sim (modo assistido) |
| Iniciar com o Windows | **Não**; só se a pessoa ligar em Configurações (abre escondido na bandeja) |
| Dados do app | `%APPDATA%\Graao Host` (identidade cifrada, configurações); mantidos na desinstalação |
| Desinstalar | Remove pasta, atalhos, entrada no Painel e o protocolo |
| Atualizar | Instalar a versão nova por cima (o NSIS desinstala a anterior em silêncio) |
| Firewall | Nenhuma regra: o servidor escuta só em `127.0.0.1` e o túnel é conexão de saída — o Windows não pergunta |

Silencioso (suporte/testes): `GraaoHost-Setup-0.1.0.exe /S`; desinstalar:
`"%LOCALAPPDATA%\Programs\Graao Host\Uninstall Graao Host.exe" /currentuser /S`.

## Verificado nesta máquina (Windows 10 Home 19045, 2026-10-18)

| Teste | Resultado |
|---|---|
| Instalação silenciosa | 37 s; pasta padrão; protocolo e atalhos criados |
| Abrir `graao-host://…` pelo Windows (`Start-Process`, como um navegador) | Link chegou ao app aberto; sala pronta |
| Servidor do app instalado (fuses ativas, `app.asar.unpacked`) | Sala pronta em 1,4 s (loopback) |
| Reinstalar por cima | 40 s; uma entrada no Painel |
| Atualizar 0.1.0 → 0.1.1 | 42 s; versão 0.1.1 no Painel; protocolo aponta para o novo exe |
| Desinstalar | 6 s; pasta, atalhos, entrada e protocolo removidos |
| `cloudflared.exe` instalado | Assinatura Cloudflare válida |
| `Graao Host.exe` | **Não assinado** |

Observação: rodar o instalador silencioso a partir do Git Bash instalou em `D:\Graao Host` (a consulta da pasta
`UserProgramFiles` falha nesse ambiente); pelo PowerShell/Explorer vai para o padrão.

## Não testado

- Máquina Windows **limpa** (este PC tem Node/ferramentas; o app não depende deles: o servidor rodou dentro do Electron,
  e o bundle rodou numa pasta vazia).
- Windows 11, antivírus de terceiros, contas sem privilégio, reinício do Windows com "Iniciar com o Windows" ligado.
- Fluxo assistido clicando nas telas do instalador (só o silencioso foi automatizado).

## Assinatura de código

Sem certificado, o SmartScreen mostra "O Windows protegeu o computador" (o site já explica: "Mais informações" →
"Executar assim mesmo"). Para distribuição pública: certificado OV/EV (ou Azure Trusted Signing) e
`win.signtoolOptions`/`azureSignOptions` no `electron-builder`. Ver `GRAAO_HOST_RELEASE.md`.
