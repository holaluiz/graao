/** Keyboard controls persisted by the settings UI. Mouse and match-navigation keys stay fixed. */
export const BINDING_ACTIONS = [
  { id: 'forward', label: 'Avançar' },
  { id: 'back', label: 'Recuar' },
  { id: 'left', label: 'Mover à esquerda' },
  { id: 'right', label: 'Mover à direita' },
  { id: 'jump', label: 'Pular' },
  { id: 'sprint', label: 'Correr' },
  { id: 'weapon1', label: 'Arma 1' },
  { id: 'weapon2', label: 'Arma 2' },
  { id: 'reload', label: 'Recarregar' },
  { id: 'ability1', label: 'Habilidade 1' },
  { id: 'ability2', label: 'Habilidade 2' },
  { id: 'ability3', label: 'Habilidade 3' },
  { id: 'ultimate', label: 'Suprema' },
  { id: 'interact', label: 'Interagir' },
  { id: 'item1', label: 'Usar vida' },
  { id: 'item2', label: 'Usar escudo' },
  { id: 'item3', label: 'Usar mana' },
  { id: 'ready', label: 'Ficar pronto' },
] as const;

export type RebindableAction = (typeof BINDING_ACTIONS)[number]['id'];
export type KeyBindings = Record<RebindableAction, string>;

export const DEFAULT_BINDINGS: Readonly<KeyBindings> = Object.freeze({
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft',
  weapon1: 'KeyE', weapon2: 'KeyQ', reload: 'KeyR',
  ability1: 'Digit1', ability2: 'Digit2', ability3: 'Digit3', ultimate: 'Digit4',
  interact: 'KeyF', item1: 'KeyZ', item2: 'KeyX', item3: 'KeyC', ready: 'Enter',
});

const EXTRA_CODES = new Set(['Space', 'Enter', 'NumpadEnter', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight']);
const RESERVED_CODES = new Set([
  'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
  'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'CapsLock', 'NumLock', 'ScrollLock',
  'Pause', 'PrintScreen', 'ContextMenu',
]);

export function isBindingCode(code: unknown): code is string {
  return typeof code === 'string' && (/^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code) || EXTRA_CODES.has(code));
}

export function isReservedCode(code: string): boolean {
  return RESERVED_CODES.has(code) || /^F[0-9]+$/.test(code);
}

/** Keep valid unique saved choices; fill missing/invalid entries with unused defaults. */
export function normalizeBindings(value: unknown): KeyBindings {
  const saved = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const normalized: Partial<KeyBindings> = {};
  const used = new Set<string>();
  for (const { id } of BINDING_ACTIONS) {
    const code = Object.hasOwn(saved, id) ? saved[id] : undefined;
    if (isBindingCode(code) && !used.has(code)) {
      normalized[id] = code;
      used.add(code);
    }
  }
  // Assign every available original default before repairing collisions. This keeps unrelated controls unchanged.
  for (const { id } of BINDING_ACTIONS) {
    if (normalized[id] === undefined && !used.has(DEFAULT_BINDINGS[id])) {
      normalized[id] = DEFAULT_BINDINGS[id];
      used.add(DEFAULT_BINDINGS[id]);
    }
  }
  for (const { id } of BINDING_ACTIONS) {
    if (normalized[id] !== undefined) continue;
    // There are as many distinct defaults as actions, so at least one default remains available here.
    const replacement = Object.values(DEFAULT_BINDINGS).find((code) => !used.has(code))!;
    normalized[id] = replacement;
    used.add(replacement);
  }
  return normalized as KeyBindings;
}

export type RebindResult =
  | { ok: true; bindings: KeyBindings }
  | { ok: false; reason: 'reserved' | 'invalid' }
  | { ok: false; reason: 'conflict'; conflict: RebindableAction };

/** Conflicts are explicit: the editor keeps its current bindings and can name the occupied action. */
export function rebindKey(bindings: KeyBindings, action: RebindableAction, code: string): RebindResult {
  if (isReservedCode(code)) return { ok: false, reason: 'reserved' };
  if (!isBindingCode(code)) return { ok: false, reason: 'invalid' };
  const current = normalizeBindings(bindings);
  const conflict = BINDING_ACTIONS.find(({ id }) => id !== action && current[id] === code);
  if (conflict) return { ok: false, reason: 'conflict', conflict: conflict.id };
  return { ok: true, bindings: { ...current, [action]: code } };
}

export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  const labels: Record<string, string> = {
    Space: 'Espaço', ShiftLeft: 'Shift esq.', ShiftRight: 'Shift dir.', ControlLeft: 'Ctrl esq.', ControlRight: 'Ctrl dir.',
    Enter: 'Enter', NumpadEnter: 'Enter num.', Escape: 'Esc', Tab: 'Tab',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  };
  return Object.hasOwn(labels, code) ? labels[code]! : code;
}
