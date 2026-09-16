// VEFARI media adapter for SillyTavern's image upload/delete HTTP contracts.
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createId } from './ids.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DIRECTORY = 'vefari_refs';
const PREFIX = `/user/images/${DIRECTORY}/`;
const FORMATS = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function imageUrl(path) {
    if (typeof path !== 'string') return '';
    const absolute = path.startsWith('/') ? path : `/${path}`;
    if (!absolute.startsWith(PREFIX)) return '';
    const filename = absolute.slice(PREFIX.length);
    return /^[\w-]+\.(?:png|jpg|webp)$/.test(filename) ? absolute : '';
}

async function blobBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) {
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    }
    return btoa(chunks.join(''));
}

export async function prepareImage(file) {
    if (!FORMATS.has(file.type)) throw new Error('Поддерживаются PNG, JPEG и WebP.');
    if (file.size > MAX_IMAGE_BYTES) throw new Error('Изображение должно быть не больше 10 МБ.');
    if (!file.size) throw new Error('Изображение пустое.');
    const url = URL.createObjectURL(file);
    try {
        const image = new Image();
        image.src = url;
        try { await image.decode(); }
        catch { throw new Error('Не удалось открыть изображение.'); }
        const { naturalWidth: width, naturalHeight: height } = image;
        const ratio = Math.min(1, 1024 / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        const drawing = canvas.getContext('2d');
        if (!drawing) throw new Error('Обработка картинки недоступна в этом браузере.');
        drawing.drawImage(image, 0, 0, canvas.width, canvas.height);
        const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!png) throw new Error('Не удалось подготовить PNG.');
        return await blobBase64(png);
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function imageRequest(operation, payload, context) {
    const response = await fetch(`/api/images/${operation}`, {
        method: 'POST', headers: context.getRequestHeaders(), body: JSON.stringify(payload),
    });
    if (!response.ok && !(operation === 'delete' && response.status === 404)) {
        throw new Error(`Операция с картинкой не выполнена (HTTP ${response.status}).`);
    }
    return response;
}

export async function uploadImage(base64, context) {
    const response = await imageRequest('upload', {
        ch_name: DIRECTORY, filename: `vefari_${createId()}`, format: 'png', image: base64,
    }, context);
    const { path } = await response.json();
    const safePath = imageUrl(path);
    if (!safePath) throw new Error('Сервер вернул недопустимый путь картинки.');
    return safePath;
}

export async function deleteUnusedImage(path, retainedItems, context) {
    const safePath = imageUrl(path);
    if (!safePath || retainedItems.some(item => imageUrl(item?.imagePath) === safePath)) return false;
    await imageRequest('delete', { path: safePath.slice(1) }, context);
    return true;
}

export async function loadReference(path) {
    const safePath = imageUrl(path);
    if (!safePath) throw new Error('Недопустимый путь референса.');
    const response = await fetch(safePath);
    if (!response.ok) throw new Error(`Референс недоступен (HTTP ${response.status}).`);
    const blob = await response.blob();
    if (!FORMATS.has(blob.type)) throw new Error('Сервер вернул не изображение.');
    return { mimeType: blob.type, base64: await blobBase64(blob) };
}