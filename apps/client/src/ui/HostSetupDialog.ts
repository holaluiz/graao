/**
 * "Criar e hospedar": follows a `HostLaunch` — opening the Graao Host app, explaining the one-time install when the
 * app does not answer, the app preparing the room, and every failure in plain words. The room is joined by the caller
 * once it is ready (reachable and listed).
 */
import type { HostLaunch, LaunchState } from '../net/graaoHost/hostSite';
import { button, Modal, node } from './components';

export class HostSetupDialog {
  readonly modal = new Modal('Hospedar com o Graao Host', () => this.close());
  private closed = false;

  constructor(
    private readonly launch: HostLaunch,
    private readonly downloadUrl: () => Promise<string>,
    private readonly onReady: (s: Extract<LaunchState, { s: 'ready' }>) => void,
    private readonly click: () => void,
  ) {
    this.modal.card.classList.add('host-setup');
    launch.onChange = (s) => this.render(s);
    this.render(launch.state);
  }

  private close(): void {
    if (!this.closed) {
      this.closed = true;
      this.launch.cancel();
    }
    this.modal.el.remove();
  }

  private steps(active: number): HTMLElement {
    const list = node('ol', 'host-steps');
    ['Abrir o Graao Host', 'Iniciar o servidor no seu PC', 'Abrir a conexão segura', 'Publicar a sala'].forEach((label, i) => {
      const li = node('li', '', label);
      li.dataset.s = i < active ? 'done' : i === active ? 'now' : 'next';
      list.append(li);
    });
    return list;
  }

  private act(label: string, fn: () => void, primary = false): HTMLButtonElement {
    return button(label, () => {
      this.click();
      fn();
    }, primary);
  }

  private render(s: LaunchState): void {
    if (this.closed) return;
    const b = this.modal.body;
    b.replaceChildren();
    const row = node('div', 'gra-toolbar host-actions');
    if (s.s === 'creating') {
      b.append(node('p', 'gra-fine', 'Pedindo uma sala ao graao…'), this.steps(0));
    } else if (s.s === 'opening') {
      b.append(
        node('p', '', 'Abrindo o Graao Host no seu computador…'),
        node('p', 'gra-fine', 'Seu navegador pode perguntar se deseja abrir o Graao Host: confirme para continuar.'),
        this.steps(0),
      );
      row.append(this.act('Cancelar', () => this.modal.hide()));
    } else if (s.s === 'not-detected') {
      const list = node('ul', 'host-explain');
      for (const t of [
        'Só quem hospeda instala. Seus amigos jogam direto no navegador, sem instalar nada.',
        'O Graao Host roda o servidor da partida no seu PC (até 10 participantes, incluindo bots) e cria um endereço seguro para os amigos entrarem — sem configurar roteador nem portas.',
        'Instalação única para Windows 10 e 11 (cerca de 125 MB). Nada é instalado sem você confirmar.',
        'Ainda sem assinatura digital: o Windows pode avisar "O Windows protegeu o computador". Clique em "Mais informações" e depois em "Executar assim mesmo".',
      ])
        list.append(node('li', '', t));
      b.append(node('h3', '', 'O Graao Host não respondeu'), node('p', '', 'Para hospedar uma sala no seu computador, instale o Graao Host uma vez:'), list);
      const download = this.act('Baixar Graao Host', () => void this.downloadUrl().then((url) => (url ? window.open(url, '_blank', 'noopener') : this.modal.message('O instalador ainda não foi publicado para download.', true))), true);
      row.append(download, this.act('Já instalei — abrir de novo', () => this.launch.reopen()), this.act('Cancelar', () => this.modal.hide()));
    } else if (s.s === 'starting') {
      b.append(
        node('p', '', 'O Graao Host está preparando sua sala…'),
        node('p', 'gra-fine', 'Na primeira vez, confirme na janela do Graao Host que este PC pode hospedar para a sua conta. A sala só aparece para os outros quando estiver pronta de verdade.'),
        this.steps(1),
      );
      row.append(this.act('Cancelar', () => this.modal.hide()));
    } else if (s.s === 'ready') {
      b.append(node('p', '', `Sala ${s.code} pronta! Entrando…`), this.steps(4));
      this.closed = true;
      this.modal.hide();
      this.onReady(s);
      return;
    } else {
      b.append(node('h3', '', 'Não foi possível hospedar'), node('p', '', s.reason));
      if (s.update) row.append(this.act('Baixar atualização', () => void this.downloadUrl().then((url) => url && window.open(url, '_blank', 'noopener')), true));
      if (s.canRetry) row.append(this.act('Tentar de novo', () => void this.launch.start(), !s.update), this.act('Verificar de novo', () => this.launch.watchAgain()));
      row.append(this.act('Fechar', () => this.modal.hide()));
    }
    if (row.childElementCount) b.append(row);
  }
}
