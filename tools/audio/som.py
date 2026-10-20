"""Caixa de ferramentas de sound design do graao: leitura e gravação (ffmpeg), filtros, dinâmica, espaço e síntese.

Sinais são arrays numpy float64 a TAXA Hz: mono com forma (n,), estéreo (n, 2). Toda função aceita os dois, e as que
misturam sobem o mono para estéreo quando preciso. Nada aqui sabe de jogo: as receitas ficam em sound_design.py.
"""
import functools
import subprocess
from fractions import Fraction

import numpy as np
from scipy import ndimage, signal

TAXA = 48000


# ------------------------------------------------------------------ entrada e saída
@functools.lru_cache(maxsize=None)
def _ler(caminho, canais):
    bruto = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", caminho, "-f", "f32le", "-ac", str(canais), "-ar", str(TAXA), "-"],
        capture_output=True,
        check=True,
    ).stdout
    x = np.frombuffer(bruto, np.float32).astype(np.float64)
    return x.reshape(-1, 2) if canais == 2 else x


def ler(caminho, estereo=False):
    """Qualquer arquivo que o ffmpeg abra, reamostrado para TAXA (cópia: quem recebe pode mexer)."""
    return _ler(str(caminho), 2 if estereo else 1).copy()


def gravar_mp3(x, caminho, qualidade=4):
    """MP3 VBR (LAME -V`qualidade`), mono ou estéreo conforme o sinal."""
    canais = 1 if x.ndim == 1 else 2
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(TAXA), "-ac", str(canais), "-i", "-",
         "-c:a", "libmp3lame", "-q:a", str(qualidade), str(caminho)],
        input=np.clip(x, -1, 1).astype(np.float32).tobytes(),
        check=True,
    )


# ------------------------------------------------------------------ tempo e forma
def seg(s):
    return int(round(s * TAXA))


def dur(x):
    return len(x) / TAXA


def vazio(segundos, estereo=False):
    n = seg(segundos)
    return np.zeros((n, 2)) if estereo else np.zeros(n)


def mono(x):
    return x if x.ndim == 1 else x.mean(axis=1)


def estereo(x):
    return x if x.ndim == 2 else np.stack([x, x], axis=1)


def recorte(x, ini=0.0, duracao=None):
    """Um trecho, com bordas de 2 e 5 ms para não estalar."""
    a = seg(ini)
    y = x[a:] if duracao is None else x[a:a + seg(duracao)]
    return fade(y, 0.002 if a > 0 else 0.0, 0.005)


def pico(x):
    return float(np.max(np.abs(x))) if len(x) else 0.0


def db(v):
    return 20 * np.log10(max(v, 1e-12))


def ganho(x, decibeis):
    return x * 10 ** (decibeis / 20)


def normalizar(x, decibeis=-1.0):
    p = pico(x)
    return x if p <= 0 else x * (10 ** (decibeis / 20) / p)


def _curva(n, x):
    return n if x.ndim == 1 else n[:, None]


def fade(x, entrada=0.0, saida=0.01):
    x = x.copy()
    a, b = min(seg(entrada), len(x)), min(seg(saida), len(x))
    if a > 0:
        x[:a] *= _curva(np.sin(np.linspace(0, np.pi / 2, a)) ** 2, x)
    if b > 0:
        x[len(x) - b:] *= _curva(np.cos(np.linspace(0, np.pi / 2, b)) ** 2, x)
    return x


def cauda(x, duracao, saida=0.06):
    """Corta em `duracao` s com um fade de `saida` s (para recortes de gravação longa)."""
    return fade(x[:seg(duracao)], 0.0, min(saida, duracao))


def decair(x, tau, ataque=0.0):
    """Multiplica por um envelope exponencial (constante `tau` s), com subida opcional."""
    t = np.arange(len(x)) / TAXA
    e = np.exp(-t / tau)
    if ataque > 0:
        e *= np.minimum(1.0, t / ataque)
    return x * _curva(e, x)


def envelope_pontos(x, pontos):
    """Envelope linear por pontos [(s, nível), ...] (dB não: nível linear)."""
    t = np.arange(len(x)) / TAXA
    ts, vs = zip(*pontos)
    return fade(x * _curva(np.interp(t, ts, vs), x), 0, 0.01)


def inicio(x, limiar=0.02, pre=0.0015):
    """Começa no ataque: corta o silêncio até o primeiro valor acima de `limiar`·pico, guardando `pre` s antes."""
    a = np.abs(mono(x))
    p = a.max() if len(a) else 0
    if p <= 0:
        return x
    i = int(np.argmax(a > p * limiar))
    return fade(x[max(0, i - seg(pre)):], pre * 0.6, 0)


def fim(x, limiar=0.0008, saida=0.02):
    """Corta a cauda abaixo de `limiar`·pico (o resto do arquivo é silêncio)."""
    a = np.abs(mono(x))
    p = a.max() if len(a) else 0
    if p <= 0:
        return x
    acima = np.nonzero(a > p * limiar)[0]
    ultimo = int(acima[-1]) + seg(saida) if len(acima) else len(x)
    return fade(x[:min(len(x), ultimo)], 0, saida)


def eventos(x, relativo=0.5, separacao=0.2, janela=0.003):
    """Inícios (amostra) dos eventos fortes: picos locais ≥ `relativo`·pico global, a `separacao` s um do outro."""
    a = np.abs(mono(x))
    w = max(1, seg(janela))
    e = np.convolve(a, np.ones(w) / w, "same")
    limiar = e.max() * relativo
    saida, i, n, sep = [], 0, len(e), seg(separacao)
    while i < n:
        if e[i] > limiar:
            # Volta até o envelope cair a 5 % do pico do evento (no máximo 15 ms).
            local = e[i:i + seg(0.01)].max()
            j = i
            while j > max(0, i - seg(0.015)) and e[j] > local * 0.05:
                j -= 1
            saida.append(j)
            i += sep
        else:
            i += 1
    return saida


def evento(x, k, duracao, relativo=0.5, separacao=0.2):
    """O k-ésimo evento forte de uma gravação, com `duracao` s (ciclando se houver menos eventos)."""
    ev = eventos(x, relativo, separacao)
    i = ev[k % len(ev)]
    return cauda(x[max(0, i - seg(0.001)):], duracao)


# ------------------------------------------------------------------ filtros
def _sos(x, sos):
    return signal.sosfilt(sos, x, axis=0)


def pb(x, f, ordem=2):
    return _sos(x, signal.butter(ordem, min(f, TAXA * 0.45), "low", fs=TAXA, output="sos"))


def pa(x, f, ordem=2):
    return _sos(x, signal.butter(ordem, f, "high", fs=TAXA, output="sos"))


def banda(x, f1, f2, ordem=2):
    return _sos(x, signal.butter(ordem, [f1, min(f2, TAXA * 0.45)], "band", fs=TAXA, output="sos"))


def _biquad(x, b, a):
    return signal.lfilter(b, a, x, axis=0)


def eq(x, f, decibeis, q=1.0):
    """Sino (RBJ peaking)."""
    A = 10 ** (decibeis / 40)
    w = 2 * np.pi * f / TAXA
    al = np.sin(w) / (2 * q)
    b = [1 + al * A, -2 * np.cos(w), 1 - al * A]
    a = [1 + al / A, -2 * np.cos(w), 1 - al / A]
    return _biquad(x, np.array(b) / a[0], np.array(a) / a[0])


def _prateleira(x, f, decibeis, alta):
    A = 10 ** (decibeis / 40)
    w = 2 * np.pi * f / TAXA
    c, s = np.cos(w), np.sin(w)
    al = s / 2 * np.sqrt(2)
    r = 2 * np.sqrt(A) * al
    if alta:
        b = [A * ((A + 1) + (A - 1) * c + r), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - r)]
        a = [(A + 1) - (A - 1) * c + r, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - r]
    else:
        b = [A * ((A + 1) - (A - 1) * c + r), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - r)]
        a = [(A + 1) + (A - 1) * c + r, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - r]
    return _biquad(x, np.array(b) / a[0], np.array(a) / a[0])


def agudos(x, f, decibeis):
    return _prateleira(x, f, decibeis, True)


def graves(x, f, decibeis):
    return _prateleira(x, f, decibeis, False)


# ------------------------------------------------------------------ altura e velocidade
def tom(x, fator):
    """Toca `fator` vezes mais rápido (mais agudo e mais curto), como o playbackRate do Web Audio."""
    if abs(fator - 1) < 1e-4:
        return x.copy()
    r = Fraction(1 / fator).limit_denominator(160)
    return signal.resample_poly(x, r.numerator, r.denominator, axis=0)


def semitons(x, st):
    return tom(x, 2 ** (st / 12))


def reverso(x):
    return x[::-1].copy()


def deslizar(x, f0, f1):
    """Toca com velocidade variando de f0 a f1 ao longo do som (sirene, queda, subida de carga)."""
    n = len(x)
    vel = np.geomspace(f0, f1, n)
    pos = np.concatenate([[0.0], np.cumsum(vel)[:-1]])
    pos = pos[pos < n - 1]
    i = pos.astype(int)
    fr = pos - i
    if x.ndim == 1:
        return x[i] * (1 - fr) + x[i + 1] * fr
    return x[i] * (1 - fr)[:, None] + x[i + 1] * fr[:, None]


# ------------------------------------------------------------------ dinâmica
def saturar(x, drive=2.0):
    """Saturação suave (tanh), mantendo o pico."""
    return np.tanh(x * drive) / np.tanh(drive)


def comprimir(x, limiar_db=-18.0, razao=4.0, ataque=0.002, soltura=0.08, bloco=32):
    """Compressor de pico com envelope por blocos (rápido em Python puro); devolve o sinal comprimido sem make-up."""
    a = np.abs(mono(x))
    nb = int(np.ceil(len(a) / bloco))
    a = np.pad(a, (0, nb * bloco - len(a)))
    picos = a.reshape(nb, bloco).max(axis=1)
    ka = np.exp(-bloco / (ataque * TAXA))
    ks = np.exp(-bloco / (soltura * TAXA))
    env = np.empty(nb)
    e = 0.0
    for i, p in enumerate(picos):
        e = ka * e + (1 - ka) * p if p > e else ks * e + (1 - ks) * p
        env[i] = e
    lim = 10 ** (limiar_db / 20)
    g = np.ones(nb)
    acima = env > lim
    g[acima] = (lim * (env[acima] / lim) ** (1 / razao)) / env[acima]
    gs = np.repeat(g, bloco)[:len(x)]
    return x * _curva(gs, x)


def limitar(x, teto_db=-1.0):
    """Limitador: comprime rápido acima do teto e arredonda o que ainda passar."""
    teto = 10 ** (teto_db / 20)
    y = comprimir(x, teto_db - 1.5, 12.0, 0.0005, 0.05, 16)
    over = np.abs(y) > teto * 0.9
    if over.any():
        k = teto * 0.9
        y = np.where(over, np.sign(y) * (k + (teto - k) * np.tanh((np.abs(y) - k) / (teto - k))), y)
    return y


def nivel(x):
    """Sonoridade de curto prazo (dB): o maior RMS em janelas de 50 ms, com peso de presença (aprox. K-weighting)."""
    m = agudos(pa(mono(x), 80), 1800, 4.0)
    w = seg(0.05)
    if len(m) < w:
        m = np.pad(m, (0, w - len(m)))
    q = np.convolve(m * m, np.ones(w) / w, "valid")
    return db(np.sqrt(q.max()))


def cliques(x, corte=6000, acima_db=20.0, janela=0.05, inicio_s=0.03):
    """Instantes (s) de estalos: picos agudos muito acima do agudo em volta (para checar a saída)."""
    h = np.abs(pa(mono(x), corte, 4))
    w = max(1, seg(0.001))
    e = ndimage.uniform_filter1d(h, w)
    viz = ndimage.uniform_filter1d(e, seg(janela)) + 1e-6
    razao = 20 * np.log10(e / viz + 1e-12)
    piso = 10 ** (-30 / 20) * max(1e-9, np.abs(mono(x)).max())
    alvo = np.nonzero((razao > acima_db) & (e > piso))[0]
    alvo = alvo[alvo > seg(inicio_s)]
    out, ultimo = [], -1e9
    for i in alvo:
        if i - ultimo > seg(0.02):
            out.append(round(i / TAXA, 3))
        ultimo = i
    return out


def ajustar_nivel(x, alvo_db, teto_db=-1.0, max_reducao=3.0):
    """Leva a sonoridade a `alvo_db`, mas sem pedir ao limitador mais que `max_reducao` dB: um som de ataque forte fica
    abaixo do alvo em vez de ter o transiente esmagado (o ataque é o que o faz soar alto)."""
    g = min(alvo_db - nivel(x), teto_db - db(pico(x)) + max_reducao)
    return limitar(ganho(x, g), teto_db)


# ------------------------------------------------------------------ espaço
def panorama(x, pan):
    """Pan de potência constante (-1 esquerda … 1 direita)."""
    m = mono(x)
    ang = (pan + 1) * np.pi / 4
    return np.stack([m * np.cos(ang), m * np.sin(ang)], axis=1) * np.sqrt(2)


def _ir(rt60, brilho, largura, pre, rnd, densidade=1.0):
    n = seg(min(4.0, rt60 * 1.3)) + seg(pre)
    t = np.arange(n) / TAXA
    canais = []
    base = rnd.standard_normal(n)
    for _ in range(2):
        r = largura * rnd.standard_normal(n) + (1 - largura) * base
        e = np.exp(-6.9 * np.maximum(0, t - pre) / rt60) * (t >= pre)
        r = r * e
        # A cauda escurece com o tempo: mistura da versão clara para a escura.
        escuro = pb(r, brilho * 0.35)
        claro = pb(r, brilho)
        mix = np.clip((t - pre) / max(rt60 * 0.5, 1e-3), 0, 1)
        canais.append(claro * (1 - mix) + escuro * mix)
    ir = np.stack(canais, axis=1)
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


def reverb(x, rt60=1.0, molhado_db=-12.0, brilho=6000.0, pre=0.012, largura=0.9, seco_db=0.0, semente=7):
    """Reverberação por convolução com uma resposta sintética estéreo; devolve estéreo (seco + molhado)."""
    rnd = np.random.default_rng(semente)
    ir = _ir(rt60, brilho, largura, pre, rnd)
    m = mono(x)
    w = np.stack([signal.fftconvolve(m, ir[:, 0]), signal.fftconvolve(m, ir[:, 1])], axis=1)
    s = estereo(x)
    out = np.zeros((max(len(s), len(w)), 2))
    out[:len(s)] += ganho(s, seco_db)
    out[:len(w)] += ganho(w, molhado_db)
    return out


def ecos(x, lista):
    """Reflexões discretas [(atraso s, ganho dB, corte Hz, pan)] somadas ao sinal; devolve estéreo."""
    s = estereo(x)
    fim_ = max(seg(a) for a, *_ in lista) + len(s)
    out = np.zeros((fim_, 2))
    out[:len(s)] += s
    for atraso, g, corte, p in lista:
        e = panorama(pb(mono(x), corte), p)
        i = seg(atraso)
        out[i:i + len(e)] += ganho(e, g)
    return out


def largura(x, quanto=0.3, atraso=0.011):
    """Abre o mono em estéreo (Haas sutil + diferença filtrada)."""
    m = mono(x)
    d = np.concatenate([np.zeros(seg(atraso)), m])[:len(m)]
    lado = pa(d, 900) * quanto
    return np.stack([m + lado, m - lado], axis=1)


# ------------------------------------------------------------------ mistura
def camada(sinal, em=0.0, decibeis=0.0):
    return (sinal, em, decibeis)


def mixar(*camadas):
    """Soma camadas (sinal, início s, ganho dB) num só sinal; estéreo se alguma for estéreo."""
    camadas = [c if isinstance(c, tuple) else (c, 0.0, 0.0) for c in camadas]
    est = any(c[0].ndim == 2 for c in camadas)
    n = max(seg(em) + len(s) for s, em, _ in camadas)
    out = np.zeros((n, 2)) if est else np.zeros(n)
    for s, em, g in camadas:
        s = estereo(s) if est else s
        i = seg(em)
        out[i:i + len(s)] += ganho(s, g)
    return out


# ------------------------------------------------------------------ síntese
def ruido(segundos, rnd, cor="branco"):
    n = seg(segundos)
    w = rnd.standard_normal(n)
    if cor == "rosa":
        b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
        a = [1, -2.494956002, 2.017265875, -0.522189400]
        w = signal.lfilter(b, a, w) * 8
    elif cor == "marrom":
        w = pa(np.cumsum(w) * 0.02, 20)
    return w / max(1e-9, np.std(w)) * 0.3


def seno(segundos, f0, f1=None, tau=None, ataque=0.002, fase=0.0):
    """Seno com glissando exponencial f0→f1 e queda exponencial `tau` (None = sustentado)."""
    n = seg(segundos)
    t = np.arange(n) / TAXA
    f1 = f0 if f1 is None else f1
    f = f0 * (f1 / f0) ** np.minimum(1.0, t / max(segundos, 1e-6))
    ph = fase + 2 * np.pi * np.cumsum(f) / TAXA
    e = np.ones(n) if tau is None else np.exp(-t / tau)
    if ataque > 0:
        e *= np.minimum(1.0, t / ataque)
    # Termina em zero: uma nota cortada antes de decair estala.
    return fade(np.sin(ph) * e, 0, min(0.03, segundos * 0.25))


def parciais(segundos, f, lista, tau, ataque=0.002, glissando=1.0):
    """Soma de parciais [(razão, amplitude)] com queda mais rápida nas altas (sinos, vidro, metal)."""
    out = np.zeros(seg(segundos))
    for razao, amp in lista:
        if f * razao >= TAXA * 0.45:
            continue
        out += amp * seno(segundos, f * razao, f * razao * glissando, tau / (razao ** 0.55), ataque)
    return out


def sino(f, segundos=1.2, tau=0.5, brilho=1.0, ataque=0.0015):
    """Sino/vidro: parciais inarmônicas de sino de mão."""
    return parciais(segundos, f, [(1, 1), (2.0, 0.42 * brilho), (2.76, 0.32 * brilho), (5.4, 0.16 * brilho),
                                  (8.93, 0.07 * brilho)], tau, ataque)


def marimba(f, segundos=1.0, tau=0.35, rnd=None):
    """Marimba: fundamental, quarta harmônica afinada (4×) e um parcial de 9,9×, mais o toque da baqueta."""
    s = parciais(segundos, f, [(1, 1), (3.98, 0.32), (9.92, 0.08)], tau, 0.0012)
    if rnd is not None:
        s[:seg(0.006)] += decair(banda(ruido(0.006, rnd), 1500, 6000), 0.0015)[:seg(0.006)] * 0.4
    return s


def kalimba(f, segundos=1.2, tau=0.5, rnd=None):
    """Kalimba: palheta com o parcial agudo inarmônico que some rápido."""
    s = parciais(segundos, f, [(1, 1), (5.95, 0.22), (12.1, 0.06)], tau, 0.001)
    if rnd is not None:
        s[:seg(0.004)] += decair(pa(ruido(0.004, rnd), 3000), 0.001)[:seg(0.004)] * 0.3
    return s


def sopro(segundos, rnd, f0, f1, q=1.2, pontos=None, cor="branco"):
    """Ruído por uma banda que desliza de f0 a f1 (vento, golpes de ar, varreduras); `pontos` = envelope linear."""
    x = ruido(segundos, rnd, cor)
    nper = 1024
    f, t, Z = signal.stft(x, TAXA, nperseg=nper, noverlap=nper * 3 // 4)
    frac = np.clip(t / max(segundos, 1e-6), 0, 1)
    centro = f0 * (f1 / f0) ** frac
    largura_ = centro / q
    G = np.exp(-0.5 * ((f[:, None] - centro[None, :]) / largura_[None, :]) ** 2)
    _, y = signal.istft(Z * G, TAXA, nperseg=nper, noverlap=nper * 3 // 4)
    y = y[:seg(segundos)]
    y = y / max(1e-9, np.max(np.abs(y)))
    if pontos:
        y = envelope_pontos(y, pontos)
    return y


def graos(segundos, rnd, quantos, f_min, f_max, tau=(0.02, 0.06), curva=1.6, amp=(0.4, 1.0)):
    """Brilho: `quantos` tins curtos (senos) espalhados, mais densos no começo (`curva` > 1)."""
    out = np.zeros(seg(segundos))
    for _ in range(quantos):
        em = segundos * 0.85 * rnd.random() ** curva
        f = np.exp(rnd.uniform(np.log(f_min), np.log(f_max)))
        d = rnd.uniform(*tau)
        g = seno(min(d * 5, segundos), f, f * rnd.uniform(0.985, 1.0), d, 0.0005) * rnd.uniform(*amp)
        i = seg(em)
        out[i:i + len(g)] += g[:len(out) - i]
    return out


def baque(f0=110, f1=45, tau=0.06, segundos=0.25, ataque=0.0008):
    """O soco grave por baixo de um impacto (game feel)."""
    return seno(segundos, f0, f1, tau, ataque)


def estalo(rnd, segundos=0.012, corte=2500, tau=0.003):
    """Um clique de ruído agudo (transiente)."""
    return decair(pa(ruido(segundos, rnd), corte), tau, 0.0002)


def autopan(x, hz=1.5, prof=0.8, fase=0.0):
    m = mono(x)
    t = np.arange(len(m)) / TAXA
    p = prof * np.sin(2 * np.pi * hz * t + fase)
    ang = (p + 1) * np.pi / 4
    return np.stack([m * np.cos(ang), m * np.sin(ang)], axis=1) * np.sqrt(2)


def tremolo(x, hz=6.0, prof=0.5):
    t = np.arange(len(x)) / TAXA
    return x * _curva(1 - prof * (0.5 + 0.5 * np.sin(2 * np.pi * hz * t)), x)
