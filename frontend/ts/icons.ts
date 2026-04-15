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

export const iconFolderOpen = (): SVGElement => icon([
  'M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2',
]);
