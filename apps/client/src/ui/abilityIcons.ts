/** Ability glyphs shared by the HUD slots and the Ability Draft cards (SVG, viewBox −16..16). */
import type { AbilityIcon } from '@graao/game-data';

/** One glyph per ability (viewBox −16..16): every ability reads by shape, color is a second cue. */
export const ABILITY_ICONS: Record<AbilityIcon, string> = {
  orb: '<circle class="f" r="6.5"/><path d="M0 -14 V-10 M0 10 V14 M-14 0 H-10 M10 0 H14 M-9.9 -9.9 L-7.1 -7.1 M9.9 9.9 L7.1 7.1 M9.9 -9.9 L7.1 -7.1 M-9.9 9.9 L-7.1 7.1"/>',
  wind: '<path d="M-13 -5 H5 A4 4 0 1 0 1 -9 M-13 1 H9 A4 4 0 1 1 5 5 M-10 7 H-1"/>',
  pollen: '<circle class="f" r="3.2"/><circle class="f" cx="0" cy="-9" r="2.4"/><circle class="f" cx="8" cy="-4.5" r="2.4"/><circle class="f" cx="8" cy="5" r="2.4"/><circle class="f" cx="0" cy="9.5" r="2.4"/><circle class="f" cx="-8" cy="5" r="2.4"/><circle class="f" cx="-8" cy="-4.5" r="2.4"/>',
  leaf: '<path class="f" d="M0 -13 L11 -7 L11 6 L0 13 L-11 6 L-11 -7 Z"/><path d="M-5 6 Q0 -6 6 -7 M-1 1 L3 3"/>',
  seed: '<path class="f" d="M0 -11 C7 -4 7 6 0 10 C-7 6 -7 -4 0 -11 Z"/><path d="M0 -11 V-15 M7 2 L12 0 M-7 2 L-12 0"/>',
  ring: '<circle r="5"/><circle r="11" stroke-dasharray="4 3"/><path d="M0 -15 L-2.5 -12 M0 -15 L2.5 -12 M15 0 L12 -2.5 M15 0 L12 2.5"/>',
  drop: '<path class="f" d="M0 -12 C6 -3 9 2 9 5 A9 9 0 0 1 -9 5 C-9 2 -6 -3 0 -12 Z"/>',
  flower: '<circle class="f" r="3"/><ellipse cx="0" cy="-8" rx="3.5" ry="5"/><ellipse cx="7.6" cy="-2.5" rx="3.5" ry="5" transform="rotate(72 7.6 -2.5)"/><ellipse cx="4.7" cy="6.5" rx="3.5" ry="5" transform="rotate(144 4.7 6.5)"/><ellipse cx="-4.7" cy="6.5" rx="3.5" ry="5" transform="rotate(216 -4.7 6.5)"/><ellipse cx="-7.6" cy="-2.5" rx="3.5" ry="5" transform="rotate(288 -7.6 -2.5)"/>',
  sun: '<circle class="f" r="5.5"/><path class="f" d="M0 -15 L3 -9 L-3 -9 Z M15 0 L9 3 L9 -3 Z M0 15 L-3 9 L3 9 Z M-15 0 L-9 -3 L-9 3 Z M10.6 -10.6 L8.5 -4.2 L4.2 -8.5 Z M10.6 10.6 L4.2 8.5 L8.5 4.2 Z M-10.6 10.6 L-8.5 4.2 L-4.2 8.5 Z M-10.6 -10.6 L-4.2 -8.5 L-8.5 -4.2 Z"/>',
  spiral: '<path d="M0 0 C3 -1 3 -5 0 -5 C-5 -5 -6 2 -2 5 C3 9 10 4 9 -2 C8 -9 0 -13 -6 -10 C-13 -6 -13 4 -8 9"/><ellipse class="f" cx="10" cy="-9" rx="2" ry="3.5" transform="rotate(40 10 -9)"/>',
  lance: '<path class="f" d="M0 -15 L4 0 L0 15 L-4 0 Z"/><path d="M-8 0 H8"/>',
};
