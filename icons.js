// Original VEFARI line icons, drawn as SVG. No external fonts or icon assets.
// SPDX-License-Identifier: AGPL-3.0-or-later
const drawings = {
    tunic: [
        // Northern tunic: wide sleeves, split hem, laced collar and woven belt.
        'M10 5 5 8 2 16 7 18 10 13 9 28 15 28 16 25 17 28 23 28 22 13 25 18 30 16 27 8 22 5',
        'M10 5 13 4 16 8 19 4 22 5 M13 4 13 9 16 12 19 9 19 4',
        'M14 7 18 9 M18 7 14 9 M10 19 22 19 M10 22 22 22',
        'M12 20.5 14 19 16 20.5 18 19 20 20.5 18 22 16 20.5 14 22Z',
    ],
    settings: [
        'M13 3h6l1 4 3 2 4-1 3 5-3 3v3l3 3-3 5-4-1-3 2-1 3h-6l-1-3-3-2-4 1-3-5 3-3v-3l-3-3 3-5 4 1 3-2Z',
        'M21 17a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
    ],
    close: ['M8 8 24 24 M24 8 8 24'],
    back: ['M19 7 10 16 19 25 M10 16h16'],
    plus: ['M16 6v20 M6 16h20'],
    edit: ['M7 23 6 28 11 27 26 12 22 8 7 23Z M19 11l4 4 M6 28h20'],
    delete: ['M7 10h18 M12 10V6h8v4 M9 10l1 18h12l1-18 M14 15v8 M18 15v8'],
    import: ['M18 4H9L5 8v20h14V4Z M9 4v4H5 M20 12l-5 5-5-5 M15 17V9'],
    export: ['M18 4H9L5 8v20h14V4Z M9 4v4H5 M10 14l5-5 5 5 M15 9v8'],
};

export function createIcon(name, className = 'vefari_icon') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 32 34');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', className);
    for (const d of drawings[name] || drawings.tunic) {
        const path = document.createElementNS(svg.namespaceURI, 'path');
        path.setAttribute('d', d);
        svg.append(path);
    }
    return svg;
}