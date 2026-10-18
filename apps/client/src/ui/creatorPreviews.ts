/** Drawn catalog illustrations. The central character remains the live 3D preview. */
import { colorHex } from '@graao/game-data';
import type { CharacterAppearance } from '@graao/shared';

const INK = '#2a2130';
const svg = (content: string, view = '0 0 100 88') => `<svg viewBox="${view}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g stroke="${INK}" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round">${content}</g></svg>`;
const ICONS: Record<string, string> = {
  body: '<circle cx="12" cy="4.5" r="3"/><path d="M6 21v-7L4 13l2-5h12l2 5-2 1v7m-6-7v7"/>',
  face: '<rect x="4" y="3" width="16" height="18" rx="7"/><path d="M8 10h.1M16 10h.1M8 15q4 4 8 0"/>',
  hair: '<path d="M5 18q-3-6 0-11 2-6 9-4 7 0 7 9l-4-3-2-4q-2 6-10 6m3 4q4 5 8 0"/>',
  top: '<path d="M8 4 2 8l3 5 3-2v10h8V11l3 2 3-5-6-4q-4 5-8 0Z"/>',
  bottom: '<path d="M5 3h14l1 18h-6l-2-12-2 12H4L5 3ZM5 7h14"/>',
  shoes: '<path d="M4 5h7v7l9 3q3 1 2 5H3V9q0-4 1-4Zm-1 12h19M13 12l-2 3m6-1-2 3"/>',
  hat: '<path d="M2 17q10 6 20 0l-3-2-2-10H7L5 15l-3 2Zm3-2h14M7 10h10"/>',
  acc: '<circle cx="6.5" cy="13" r="5"/><circle cx="17.5" cy="13" r="5"/><path d="M11.5 12h1M2 10V6m20 4V6"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 7h.1M17 7h.1M12 12h.1M7 17h.1M17 17h.1"/>',
  reset: '<path d="M4 10a8 8 0 1 1 2 8M4 3v7h7"/>',
  rotate: '<path d="M6 8a7 7 0 1 1-1 9M6 3v5H1"/><path d="m10 9 6 3-6 3Z"/>',
};
export function categoryIcon(id: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[id] ?? ICONS.acc}</svg>`;
}
function face(id: string): string {
  const eyes = id === 'face.sleepy' ? '<path d="M33 39h10m14 0h10"/>'
    : id === 'face.wink' ? '<path d="m33 38 10 3-10 3m29-7v5"/>'
    : id === 'face.bright' ? '<path d="m34 39 5-4 5 4m12 0 5-4 5 4"/>' : '<path d="M38 37v4m24-4v4"/>';
  const mouth = id === 'face.grin' ? '<path d="M37 51h26q-2 15-13 15T37 51Z" fill="#fff8ee"/><path d="M38 57h24"/>'
    : id === 'face.sleepy' ? '<ellipse cx="50" cy="56" rx="4" ry="5" fill="#fff8ee"/>'
    : id === 'face.bright' || id === 'face.wink' ? '<path d="M39 53q11 12 22 0" fill="none"/>'
    : '<path d="M43 55q7 5 14 0" fill="none"/>';
  return `${eyes}${mouth}${id === 'face.freckles' ? '<g fill="#8d4c32" stroke="none"><circle cx="30" cy="48" r="1.5"/><circle cx="35" cy="46" r="1.5"/><circle cx="38" cy="50" r="1.5"/><circle cx="62" cy="50" r="1.5"/><circle cx="66" cy="46" r="1.5"/><circle cx="70" cy="48" r="1.5"/></g>' : ''}`;
}
const HAIR: Record<string, string> = {
  ondulado: '<path d="M23 39V28q-7-18 11-18 8-14 22-6 16-5 22 9 11 5 3 22l-8-6-4-11q-15 12-29 5l-7 17Z"/>',
  bob: '<path d="M22 58V28Q20 2 50 3q30-1 28 25v30l-13 4V24q-15 10-30 0v38Z"/>',
  crop: '<path d="M25 30Q19 6 50 6q31-3 26 24l-10-9-26 3-9 10Z"/>',
  ponytail: '<path d="M72 20q26-7 20 18l-4 26-12-7 4-20-8-6M24 33Q19 5 50 5q30-3 26 26l-9-11-32 5-6 13Z"/>',
  buns: '<circle cx="22" cy="15" r="13"/><circle cx="78" cy="15" r="13"/><path d="M24 32Q20 5 50 5q31-2 26 27L61 18 37 28Z"/>',
  afro: '<path d="M25 47Q9 43 15 30 2 20 16 12q1-17 17-12Q45-10 55 0q17-7 23 8 19-1 18 14 9 14-8 22l-12 6-9-24-32 1Z"/>',
  cachos: '<path d="M24 46Q9 41 18 30q-9-12 5-17 0-16 15-10 12-12 22-2 17-4 18 11 15 1 10 15 10 12-4 20l-11-8-4-19q-13 12-30 2l-8 23Z"/>',
  trancas: '<path d="M25 29Q23 4 50 5q27-3 26 24l-12-7-28 3Z"/><path d="M25 27v38m8-39v42m34-43v43m8-42v39" stroke-width="7"/><path d="m22 37 7 4m1 5 7 4m27-13 7 4m1 5 7 4" fill="none"/>',
  dreads: '<path d="M25 25Q24 4 50 5q27-2 27 21Z"/><path d="m28 18-9 40m17-43-9 48m17-48-4 17m12-17 4 17m5-17 13 47m-5-43 15 37" fill="none" stroke-width="8"/>',
  liso: '<path d="M20 70V29Q19 2 50 3q31-1 30 26v41l-15 4V24L52 14 35 27v47Z"/>',
  chiquinha: '<path d="M27 24Q4 20 8 44l8 13 8-15-2-12M73 24q23-4 19 20L84 57l-8-15 2-12M24 30Q20 5 50 5q30-2 26 25L62 19 36 27Z"/>',
  coque: '<circle cx="50" cy="7" r="13"/><path d="M24 31Q21 5 50 6q29-2 26 25L63 21l-28 8Z"/>',
  moicano: '<path d="m41 27 2-17 7-12 9 10 3 19-12-6Z"/><path d="M26 29h8m32 0h8" fill="none" stroke-width="5"/>',
  raspado: '<path d="M25 27Q25 8 50 8q25-1 25 19l-9-8H34Z" stroke-dasharray="2 3"/>',
  careca: '',
};
const BEARDS: Record<string, string> = {
  none: '', bigode: '<path d="M50 49q-11-5-16 6 9 4 16-1 7 5 16 1-5-11-16-6Z"/>',
  cavanhaque: '<path d="M43 62h14l-3 10h-8Z"/><path d="M39 51q11-6 22 0l-2 5-9-3-9 3Z"/>',
  cheia: '<path d="M25 45q5 24 25 28 20-4 25-28l-5 22-20 14-20-14Z"/><path d="M39 52q11-8 22 0l-3 5-8-3-8 3Z"/>',
  porfazer: '<path d="M29 52q4 17 21 19 17-2 21-19" fill="none" stroke-dasharray="1 5" stroke-width="6"/>',
};
const hatArt = (part: string, hat: string): string => ({
  none: '',
  palha: `<path d="M10 35q40 24 80 0L70 27 62 10H38l-8 17Z" fill="#dfbf72"/><path d="M31 26h38v9H31Z" fill="${hat}"/>`,
  cangaceiro: `<path d="M12 23q-3 29 22 12L38 9h24l4 26q25 17 22-12l-8 5H20Z" fill="#8a5a32"/><path d="m39 20 4-6 4 6-4 6Zm14 0 4-6 4 6-4 6Z" fill="${hat}"/>`,
  malandro: `<path d="m29 29 9-23 12 7 12-7 9 23 19 7q-40 14-80 0Z" fill="${hat}"/><path d="M29 27h42v8H29Z" fill="#34343b"/>`,
  bone: `<path d="M24 32Q24 6 50 6q27-1 27 26Z" fill="${hat}"/><path d="M40 29h38l15 10H40Z" fill="${hat}"/>`,
  bonetras: `<path d="M24 32Q24 6 50 6q27-1 27 26Z" fill="${hat}"/><path d="M24 29h14v11H9Zm17-2h19v6H41Z" fill="${hat}"/>`,
  touca: `<path d="M24 35V23Q25 1 50 1q25 0 26 22v12Z" fill="${hat}"/><path d="M22 27h56v12H22Z" fill="${hat}"/><path d="M31 29v8m9-8v8m10-8v8m10-8v8m9-8v8" fill="none"/>`,
  bandana: `<path d="M24 25q26-18 52 0v12H24Zm51 5 15 13-16 2Z" fill="${hat}"/><path d="m33 28 3-3m12 1 3-3m12 5 3-3" stroke="#fff8ee"/>`,
  turbante: `<path d="M23 32Q13 12 35 5q16-9 35 3 18 8 7 24l-28-9Z" fill="${hat}"/><path d="m29 10 42 19M31 30 68 8M48 8l9 24" fill="none"/>`,
  flores: `<path d="M24 28q26-21 52 0" fill="none" stroke="#5ba361" stroke-width="9"/><g fill="${hat}"><circle cx="27" cy="24" r="7"/><circle cx="42" cy="17" r="8"/><circle cx="60" cy="18" r="8"/><circle cx="75" cy="25" r="7"/></g><path d="M27 24h.1m15-7h.1m18 1h.1m15 7h.1" stroke="#ffd36e" stroke-width="4"/>`,
} as Record<string, string>)[part] ?? '';
const ACCESSORIES: Record<string, string> = {
  none: '',
  glasses: '<g fill="none"><circle cx="37" cy="39" r="12"/><circle cx="63" cy="39" r="12"/><path d="M49 38h2m-27-4-6-4m57 4 6-4"/></g>',
  shades: '<path d="M24 30h24v18H29Zm28 0h24l-5 18H52Z" fill="#66bde6"/><path d="M48 34h4m-20 0 8 8m19-8 8 8" stroke="#fff8ee"/>',
  headphones: '<path d="M19 42V29Q19 4 50 4q31 0 31 25v13" fill="none" stroke-width="7"/><rect x="15" y="30" width="12" height="23" rx="5" fill="#ffd36e"/><rect x="73" y="30" width="12" height="23" rx="5" fill="#ffd36e"/>',
  hoops: '<ellipse cx="22" cy="52" rx="8" ry="11" fill="none" stroke="#e6b83c" stroke-width="5"/><ellipse cx="78" cy="52" rx="8" ry="11" fill="none" stroke="#e6b83c" stroke-width="5"/>',
  flor: '<path d="m73 21 13-10-3 17" fill="#5ba361"/><g fill="#e79bb0"><circle cx="71" cy="15" r="7"/><circle cx="81" cy="22" r="7"/><circle cx="75" cy="33" r="7"/><circle cx="65" cy="28" r="7"/><circle cx="62" cy="18" r="7"/></g><circle cx="71" cy="23" r="5" fill="#ffd36e"/>',
};
/** A small bust of the whole look (lobby seats, draft strip): skin, face, hair, beard, hat, glasses and top color. */
export function avatarPortrait(a: CharacterAppearance): string {
  const skin = colorHex(a.skinId), hair = colorHex(a.hairColorId), top = colorHex(a.topColorId), hat = colorHex(a.hatColorId);
  const part = (id: string) => id.split('.')[1] ?? '';
  return svg(
    `<path d="M10 116q1-30 26-36h28q25 6 26 36Z" fill="${top}"/><path d="M42 66h16v16H42Z" fill="${skin}"/>` +
      `<rect x="24" y="16" width="52" height="57" rx="24" fill="${skin}"/>${face(a.faceId)}` +
      `<g fill="${hair}">${HAIR[part(a.hairId)] ?? ''}${BEARDS[part(a.beardId)] ?? ''}</g>${hatArt(part(a.hatId), hat)}${ACCESSORIES[part(a.accessoryId)] ?? ''}`,
    '0 -10 100 120',
  );
}
export function appearancePreview(key: keyof CharacterAppearance, id: string, appearance: CharacterAppearance): string {
  const skin = colorHex(appearance.skinId), hair = colorHex(appearance.hairColorId), top = colorHex(appearance.topColorId);
  const bottom = colorHex(appearance.bottomColorId), shoes = colorHex(appearance.shoesColorId), hat = colorHex(appearance.hatColorId);
  const part = id.split('.')[1]!;
  const head = `<rect x="24" y="16" width="52" height="57" rx="24" fill="${skin}"/>`;
  const portrait = `${head}${face('face.calm')}`;
  if (key === 'bodyId') {
    const sturdy = part === 'sturdy';
    return svg(`<circle cx="50" cy="16" r="11" fill="${skin}"/><path d="M${sturdy ? 27 : 35} 34Q50 27 ${sturdy ? 73 : 65} 34l7 31-11 2-5-20v32H${sturdy ? 36 : 41}V47l-5 20-11-2Z" fill="${skin}"/><path d="M${sturdy ? 36 : 41} 64h${sturdy ? 28 : 18}v19H${sturdy ? 53 : 51}l-3-11-3 11H${sturdy ? 36 : 41}Z" fill="${bottom}"/>`);
  }
  if (key === 'faceId') return svg(`${head}${face(id)}`);
  if (key === 'hairId') return svg(`${portrait}<g fill="${hair}">${HAIR[part] ?? ''}</g>`, '0 -8 100 96');
  if (key === 'beardId') {
    return svg(`${portrait}<g fill="${hair}">${BEARDS[part] ?? ''}</g>`);
  }
  if (key === 'topId') {
    let outline = 'M33 13 9 29l10 18 12-7v37h38V40l12 7 10-18-24-16q-17 12-34 0Z';
    if (['xadrez', 'cortavento', 'hoodie', 'longsleeve'].includes(part)) outline = 'M33 13 17 24 4 68l15 6 12-32v36h38V42l12 32 15-6-13-44-16-11q-17 12-34 0Z';
    if (['regata', 'cropped', 'vest'].includes(part)) outline = `M34 13h8q8 10 16 0h8l4 16-2 ${part === 'cropped' ? '29' : '49'}H32l-2-${part === 'cropped' ? '29' : '49'}Z`;
    const details: Record<string, string> = {
      hoodie: '<path d="M34 13q16 28 32 0M42 31v17m16-17v17M39 62h22l5 8H34Z" fill="none"/>',
      time: '<path d="m32 18 8 7m28-7-8 7M42 41h15l-4 20" fill="none" stroke="#fff8ee" stroke-width="5"/><path d="M62 30h5v7h-5Z" fill="#ffd36e"/>',
      chita: '<g fill="#ffd36e" stroke="none"><circle cx="40" cy="33" r="5"/><circle cx="58" cy="52" r="5"/><circle cx="38" cy="67" r="5"/><circle cx="64" cy="29" r="5"/></g>',
      xadrez: '<path d="M39 24v52m22-52v52M31 37h38M31 51h38M31 66h38" stroke="#fff8ee" opacity=".7"/><path d="M50 24v52"/>',
      cortavento: '<path d="M50 24v54M27 37h46M34 53h12m10 0h11" fill="none"/><path d="M31 37h38v11H31Z" fill="#fff8ee" stroke="none"/>',
      longsleeve: '<path d="M31 37h38M31 48h38M31 59h38M31 70h38M12 48h12m52 0h12" stroke="#fff8ee" stroke-width="5"/>',
      vest: '<path d="m42 13 8 20 8-20M50 33v45M34 45h12v11H34Zm20 0h12v11H54Z" fill="none"/>',
    };
    return svg(`<path d="${outline}" fill="${top}"/>${details[part] ?? ''}`);
  }
  if (key === 'bottomId') {
    const skirt = ['skirt', 'rodada'].includes(part), long = ['pants', 'jogger', 'capoeira'].includes(part);
    const legs = long ? '' : `<path d="M34 47h11v31H34Zm21 0h11v31H55Z" fill="${skin}"/>`;
    const shape = skirt ? `M31 10h38l${part === 'rodada' ? '17 48H14' : '9 45H22'}Z` : `M27 10h46l5 ${long ? '68' : part === 'shorts' ? '34' : '43'}H55l-5-${long ? '42' : '23'}-5 ${long ? '42' : '23'}H22Z`;
    const detail = part === 'cargo' ? '<path d="M24 29h16v13H24Zm36 0h16v13H60Z" fill="none"/>'
      : part === 'jogger' ? '<path d="M23 70h21m12 0h21M43 15l7 7 7-7" fill="none"/>'
      : part === 'capoeira' ? '<path d="M28 16h44M50 16l15 16" stroke="#e6b83c" stroke-width="5"/>'
      : part === 'skirt' ? '<path d="m35 20-5 35m16-35-2 35m12-35 2 35m7-35 5 35"/>'
      : part === 'tactel' ? '<path d="m32 17-4 26m40-26 4 26" stroke="#fff8ee" stroke-width="4"/>' : '<path d="M28 18h44M50 18v14" fill="none"/>';
    return svg(`${legs}<path d="${shape}" fill="${bottom}"/>${detail}`);
  }
  if (key === 'shoesId') {
    if (['chinelo', 'sandalia'].includes(part)) return svg(`<path d="M29 28h22v22l29 6q13 5 5 15H24q-8-7-3-15Z" fill="${skin}"/><path d="M22 63h65v9H22Z" fill="${shoes}"/><path d="${part === 'chinelo' ? 'M37 51 50 63l10-9' : 'M29 32h22v9H29Zm-1 22h44v9H28Z'}" fill="${shoes}" stroke-width="5"/>`);
    return svg(`<path d="M27 ${part === 'boots' ? '13' : '25'}h24v25l26 7q13 4 10 16H21V49Z" fill="${shoes}"/><path d="M21 66h67v10H21Z" fill="#fff8ee"/><path d="M51 46 40 50m19 1-11 4m19 0-11 5" fill="none" stroke="#fff8ee" stroke-width="4"/>${part === 'retro' ? '<path d="M27 14h23v17H27Z" fill="#fff8ee"/><path d="M28 21h21" stroke="#e2478a"/>' : ''}${part === 'chunky' ? '<path d="m22 76 5 7h13l4-7 9 7h15l5-7 9 5 6-8" fill="#fff8ee"/>' : ''}${part === 'mola' ? '<path d="m25 75 7 8 8-8 8 8 8-8 8 8 8-8" fill="none"/>' : ''}${part === 'chuteira' ? '<path d="M30 77v6m18-6v6m20-6v6m12-6v6"/>' : ''}${part === 'slipons' ? '<path d="M43 39h12v21H43Z" fill="#fff8ee"/>' : ''}`);
  }
  if (key === 'hatId') {
    return svg(`${portrait}${hatArt(part, hat)}`);
  }
  if (key === 'accessoryId') {
    return svg(`${portrait}${ACCESSORIES[part] ?? ''}`);
  }
  if (key === 'extraId') {
    const extras: Record<string, string> = {
      none: '',
      cordao: '<path d="M35 21q0 30 15 35 15-5 15-35" fill="none" stroke="#e6b83c" stroke-width="6"/><circle cx="50" cy="57" r="6" fill="#e6b83c"/>',
      pochete: '<path d="M25 54h50" stroke-width="6"/><rect x="35" y="48" width="37" height="22" rx="7" fill="#e79bb0"/><path d="M41 55h24"/>',
      bag: '<path d="m30 15 41 51" stroke="#8a5a32" stroke-width="7"/><rect x="52" y="48" width="30" height="30" rx="5" fill="#8a5a32"/><path d="M52 57h30"/>',
      mochila: '<path d="M33 19h34v48H33Z" fill="#ec8a3a"/><path d="M39 23V12h22v11" fill="none"/><rect x="27" y="29" width="46" height="49" rx="12" fill="#ec8a3a"/><rect x="34" y="52" width="32" height="20" rx="5" fill="#ffd36e"/>',
      bandeira: '<path d="M32 77V9" stroke="#8a5a32" stroke-width="5"/><path d="M34 12q22-12 46 0v37q-24-10-46 0Z" fill="#1f9a52"/><path d="m41 29 16-12 16 12-16 12Z" fill="#f6d22c"/><circle cx="57" cy="29" r="7" fill="#4f86c9"/>',
      fitinhas: '<path d="m28 34-8 31m52-31 8 31" fill="none" stroke-width="11"/><path d="m15 53 13 4m44-4 13 4" stroke="#ffd36e" stroke-width="7"/><path d="m21 58-6 20m9-18 5 16" stroke="#e2478a" stroke-width="4"/>',
    };
    return svg(`<path d="M34 15 20 29l8 14 6-5v41h32V38l6 5 8-14-14-14q-16 12-32 0Z" fill="${top}" opacity=".55"/>${extras[part] ?? ''}`);
  }
  return svg('');
}
