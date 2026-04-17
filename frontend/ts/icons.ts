// Tabler Icons を単一 path の組み合わせで DOM 生成する。
// アイコンはツリーヘッダ・ツールバー相当でしか使わないので、
// 必要なものだけインラインで持つ。
const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(paths: string[]): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('tree-icon');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

export const iconFile = (): SVGElement => icon([
  'M14 3v4a1 1 0 0 0 1 1h4',
  'M17 21H7a2 2 0 0 1 -2 -2V5a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z',
  'M9 9l1 0',
  'M9 13l6 0',
  'M9 17l6 0',
]);

export const iconFolder = (): SVGElement => icon([
  'M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2',
]);

export const iconTrash = (): SVGElement => icon([
  'M4 7l16 0',
  'M10 11l0 6',
  'M14 11l0 6',
  'M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12',
  'M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3',
]);

export const iconOutline = (): SVGElement => icon([
  'M4 6l16 0',
  'M8 12l12 0',
  'M8 18l12 0',
  'M4 12l0 .01',
  'M4 18l0 .01',
]);

export const iconFolderOpen = (): SVGElement => icon([
  'M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2',
]);

export const iconSparkle = (): SVGElement => icon([
  'M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8 -4.6L6 9l4.2 -1.4z',
  'M19 15l.9 2.3L22 18l-2.1 .7L19 21l-.9 -2.3L16 18l2.1 -.7z',
]);

export const iconTranslate = (): SVGElement => icon([
  'M4 5h7',
  'M9 3v2c0 4.418 -2.239 8 -5 8',
  'M5 9c0 2.144 2.952 3.908 6.7 4',
  'M12 20l4 -9l4 9',
  'M19.1 18h-6.2',
]);

export const iconSummary = (): SVGElement => icon([
  'M9 5h9',
  'M9 12h9',
  'M9 19h6',
  'M5 5l0 .01',
  'M5 12l0 .01',
  'M5 19l0 .01',
]);

export const iconCopy = (): SVGElement => icon([
  'M8 8m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z',
  'M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2',
]);

export const iconQuestion = (): SVGElement => icon([
  'M8 9h.01',
  'M12 9h.01',
  'M16 9h.01',
  'M18 13.3l-3 -1.3h-2a3 3 0 0 1 -3 -3v-4a3 3 0 0 1 3 -3h7a3 3 0 0 1 3 3v4a3 3 0 0 1 -3 3h-1l-1 1',
  'M10 16h-1a3 3 0 0 1 -3 -3v-1',
]);

export const iconMore = (): SVGElement => icon([
  'M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
  'M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
  'M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
]);

export const iconPencil = (): SVGElement => icon([
  'M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4',
  'M13.5 6.5l4 4',
]);
