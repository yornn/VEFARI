// Original VEFARI line icons, fibula emblem and rune line, drawn as SVG. No external fonts or icon assets.
// SPDX-License-Identifier: AGPL-3.0-or-later
const SVG = 'http://www.w3.org/2000/svg';
const round = value => +value.toFixed(2);
const polyline = points => 'M' + points.map(([x, y]) => `${round(x)} ${round(y)}`).join('L') + 'Z';

function gear() {
    const points = [];
    for (let tooth = 0; tooth < 8; tooth++) {
        const angle = tooth * Math.PI / 4;
        for (const [radius, offset] of [[7.6, -0.27], [10, -0.15], [10, 0.15], [7.6, 0.27]]) {
            points.push([12 + radius * Math.cos(angle + offset), 12 + radius * Math.sin(angle + offset)]);
        }
    }
    return `${polyline(points)} M15 12A3 3 0 1 1 9 12A3 3 0 1 1 15 12`;
}

// 24-unit grid; square caps and mitred joins give the forged, sharp look.
export const ICONS = Object.freeze({
    settings: [gear()],
    close: ['M6 6 18 18M18 6 6 18'],
    back: ['M10.5 6 4.5 12l6 6M4.5 12h15'],
    plus: ['M12 4.5v15M4.5 12h15'],
    minus: ['M4.5 12h15'],
    check: ['M5 12.5l4.5 4.5L19 7'],
    chevron: ['M6.5 9.5 12 15l5.5-5.5'],
    edit: ['M20 3.5C13.5 5 8.8 9.6 7 17c6-2 10.8-6.6 13-13.5Z', 'M17.5 6 9 14.5', 'M7 17l-3.5 3.5'],
    // A split-vane feather, not the quill of `edit`: it writes the description from the picture.
    feather: [
        'M19.2 4C16.3 4.1 13.5 5.3 11.1 7.7L11.5 10.5 9.5 9.4C7.7 11.7 7.3 14.2 7.9 16.6C10.3 16.9 12.7 16.4 14.4 14.7L14.1 12 16 13C17.8 10.8 19 7.8 19.2 4Z',
        'M4.8 20C8.8 15.1 12.9 10.7 17.3 6.6',
    ],
    delete: ['M4 6.5h16', 'M9.5 6.5v-3h5v3', 'M6 6.5 7.2 20.5h9.6L18 6.5', 'M10 10v7M14 10v7'],
    import: ['M14 3.5H5.5v17h13V8Z', 'M14 3.5V8h4.5', 'M12 10v6.5M9 13.5l3 3 3-3'],
    export: ['M14 3.5H5.5v17h13V8Z', 'M14 3.5V8h4.5', 'M12 16.5V10M9 13l3-3 3 3'],
    image: ['M3.5 5h17v14h-17Z', 'M3.5 16 9 10.5l4 4 2.5-2.5 5 5', 'M16 6.8l1.7 1.7L16 10.2l-1.7-1.7Z'],
    // The generator switch in the armory: a serifed T for text only, a framed picture for text and image.
    text: ['M5 5h14', 'M12 5v14', 'M5 5v3M19 5v3', 'M9 19h6'],
    picture: ['M4.5 5h15v14h-15Z', 'M5.2 15.8 9.5 11.5l3.5 3.5 2.5-2.5 3.3 3.3', 'M15.5 7.2l1.4 1.4-1.4 1.4-1.4-1.4Z'],
    algiz: ['M12 4v16M12 11 6.5 5M12 11l5.5-6'],
    othala: ['M12 3l5.5 5.5L7 19M12 3 6.5 8.5 17 19'],
    full: ['M9.5 3 7 5v5L5 21h14l-2-11V5l-2.5-2L12 5.5Z', 'M7 10h10'],
    top: ['M8.5 4 4 6.5 2.5 12l3 .5 1-3V19h11V9.5l1 3 3-.5L20 6.5 15.5 4 12 7Z'],
    bottom: ['M6 4h12l1 16.5h-5L12 10l-2 10.5H5Z', 'M6 7h12'],
    shoes: ['M8.5 3.5h5v9l6 2.5 1 3v2.5h-14L7.5 13Z', 'M8.5 6.5h5', 'M6.5 18h14'],
    accessories: ['M12 3.5l3 3-3 3-3-3Z', 'M10 8.6A5.8 5.8 0 1 0 14 8.6'],
    hair: ['M12 3 15.5 6.5 15 17 12 20 9 17 8.5 6.5Z', 'M9 9.5l3 2 3-2M9 13.5l3 2 3-2', 'M12 20v2.5'],
});

// ᚹ ᛖ ᚠ ᚨ ᚱ ᛁ — VEFARI in the Elder Futhark, each rune on an 8×14 cell.
const RUNES = [
    'M1 1V13M1 1l5 3-5 3',
    'M1 1V13M7 1V13M1 1l3 4 3-4',
    'M1 1V13M1 5l5-4M1 9l5-4',
    'M1 1V13M1 1l5 4M1 5l5 4',
    'M1 1V13M1 1l5 3-5 3 5 6',
    'M4 1V13',
];

function lineSvg(viewBox, className, strokeWidth) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', strokeWidth);
    svg.setAttribute('stroke-linecap', 'square');
    svg.setAttribute('stroke-linejoin', 'miter');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', className);
    return svg;
}

function appendPath(parent, d, attributes = {}) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    for (const [name, value] of Object.entries(attributes)) path.setAttribute(name, value);
    parent.append(path);
    return path;
}

export function createIcon(name, className = 'vefari_icon') {
    const svg = lineSvg('0 0 24 24', className, '1.5');
    for (const d of ICONS[name] || ICONS.full) appendPath(svg, d);
    return svg;
}

export function createRunes(className = 'vefari_runes') {
    const svg = lineSvg('0 0 63 14', className, '1.2');
    RUNES.forEach((d, index) => appendPath(svg, d, { transform: `translate(${index * 11} 0)` }));
    return svg;
}

// Forged penannular brooch. The ring is a filled variable-width shape around a centre line:
// spirals at both ends roll outward, the hammered sides are wide and the top is thinner.
const FIBULA = {
    large: { step: 0.8, halfTurns: 4, sx: 26.4, sy: 40, widths: [0.45, 1.25, 1.35, 2.7], arcSteps: 14, pin: [2.1, 3.0], eyeWidth: 1.1 },
    small: { step: 1.5, halfTurns: 2, sx: 26.2, sy: 39.6, widths: [1.6, 2.6, 2.8, 4.4], arcSteps: 10, pin: [3.4, 4.2], eyeWidth: 1.8 },
};
const RING = { x: 32, y: 27, r: 15 };

function arc(cx, cy, r, from, to, steps) {
    return Array.from({ length: steps + 1 }, (_, index) => {
        const angle = from + (to - from) * index / steps;
        return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    });
}

function cubic(p0, p1, p2, p3, steps) {
    return Array.from({ length: steps + 1 }, (_, index) => {
        const t = index / steps, u = 1 - t;
        return [0, 1].map(axis => u ** 3 * p0[axis] + 3 * u * u * t * p1[axis] + 3 * u * t * t * p2[axis] + t ** 3 * p3[axis]);
    });
}

const join = (...parts) => parts.reduce((all, part) => all.length ? all.concat(part.slice(1)) : part.slice(), []);
const mirror = points => points.map(([x, y]) => [64 - x, y]).reverse();

function lengths(points) {
    const result = [0];
    for (let index = 1; index < points.length; index++) {
        const [x0, y0] = points[index - 1], [x1, y1] = points[index];
        result.push(result[index - 1] + Math.hypot(x1 - x0, y1 - y0));
    }
    return result;
}

// Left spiral from its centre outward, counter-clockwise, leaving at the top heading left.
function spiral({ step, halfTurns, sx, sy, arcSteps }) {
    let points = [];
    for (let turn = 1; turn <= halfTurns; turn++) {
        const segment = turn % 2
            ? arc(sx, sy + step, turn * step, -Math.PI / 2, -Math.PI * 1.5, arcSteps)
            : arc(sx, sy, turn * step, Math.PI / 2, -Math.PI / 2, arcSteps);
        points = join(points, segment);
    }
    return points;
}

export function fibulaOutline(variant) {
    const options = FIBULA[variant] || FIBULA.small;
    const [wMin, wSpiral, wTop, wSide] = options.widths;
    const left = spiral(options);
    const exit = left.at(-1);
    const arm = cubic(exit, [exit[0] - 4.5, exit[1]], [RING.x - RING.r, RING.y + 9], [RING.x - RING.r, RING.y], 24);
    const top = arc(RING.x, RING.y, RING.r, Math.PI, Math.PI * 2, 60);
    const ring = join(arm, top, mirror(arm));
    const centre = join(left, ring, mirror(left));

    const spiralLength = lengths(left);
    const spiralWidths = spiralLength.map(s => wMin + (wSpiral - wMin) * (s / spiralLength.at(-1)) ** 0.8);
    const ringLength = lengths(ring);
    const bump = (u, mean, sigma) => Math.exp(-((u - mean) ** 2) / (2 * sigma * sigma));
    const ringWidths = ringLength.map(s => {
        const u = s / ringLength.at(-1);
        return wTop + (wSpiral - wTop) * (bump(u, 0, 0.07) + bump(u, 1, 0.07))
            + (wSide - wTop) * (bump(u, 0.2, 0.085) + bump(u, 0.8, 0.085));
    });
    const widths = join(spiralWidths, ringWidths, spiralWidths.slice().reverse());

    const sideA = [], sideB = [];
    centre.forEach(([x, y], index) => {
        const [ax, ay] = centre[Math.max(0, index - 1)], [bx, by] = centre[Math.min(centre.length - 1, index + 1)];
        const length = Math.hypot(bx - ax, by - ay) || 1;
        const nx = -(by - ay) / length * widths[index] / 2, ny = (bx - ax) / length * widths[index] / 2;
        sideA.push([x + nx, y + ny]);
        sideB.push([x - nx, y - ny]);
    });

    const [pinWidth, collarWidth] = options.pin;
    const h = pinWidth / 2, c = collarWidth / 2;
    const half = [[h, 14.2], [c, 16.2], [0.95 * h, 18.4], [0.9 * c, 20.2], [0.85 * h, 22], [0.72 * h, 46]];
    const pin = [...half.map(([dx, y]) => [32 - dx, y]), [32, 59], ...half.reverse().map(([dx, y]) => [32 + dx, y])];

    return {
        ring: polyline([...sideA, ...sideB.reverse()]),
        pin: polyline(pin),
        eye: 'M34.3 11.2A2.3 3.4 0 1 1 29.7 11.2A2.3 3.4 0 1 1 34.3 11.2',
        eyeWidth: options.eyeWidth,
    };
}

export const FIBULA_PIN_COLOR = '#9fc3d6';

export function createEmblem(variant = 'small', className = 'vefari_emblem') {
    const { ring, pin, eye, eyeWidth } = fibulaOutline(variant);
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '10.7 9.4 45.3 45.3');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', className);
    const group = document.createElementNS(SVG, 'g');
    group.setAttribute('transform', 'rotate(40 32 32)');
    appendPath(group, ring, { fill: 'currentColor' });
    appendPath(group, pin, { fill: FIBULA_PIN_COLOR });
    appendPath(group, eye, { fill: 'none', stroke: 'currentColor', 'stroke-width': String(eyeWidth) });
    svg.append(group);
    return svg;
}
