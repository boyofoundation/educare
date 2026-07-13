/**
 * 圖片附件前置處理:驗證、縮圖壓縮、轉 base64。
 * 上傳的圖片會隨 ChatMessage 存入 IndexedDB 並送往 provider API,
 * 因此在前端先把長邊縮到 MAX_IMAGE_DIMENSION_PX 並以 JPEG re-encode
 * (原檔為 PNG/WebP 且未縮圖時保留原格式),控制儲存與 token 成本。
 */
import type { MessageAttachment } from '../types';

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_DIMENSION_PX = 1568;
const REENCODE_QUALITY = 0.85;
/** 小於此大小且尺寸符合的圖片直接保留原檔,不經 canvas re-encode。 */
const PASSTHROUGH_MAX_BYTES = 1.5 * 1024 * 1024;

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export const isSupportedImageFile = (file: File): boolean =>
  SUPPORTED_IMAGE_MIME_TYPES.has(file.type);

export class ImageAttachmentError extends Error {}

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new ImageAttachmentError('讀取圖片檔案失敗。'));
    reader.readAsDataURL(file);
  });

const loadImage = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new ImageAttachmentError('無法解析圖片內容。'));
    image.src = dataUrl;
  });

const splitDataUrl = (dataUrl: string): { mimeType: string; data: string } => {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new ImageAttachmentError('圖片編碼失敗。');
  }
  return { mimeType: match[1], data: match[2] };
};

/**
 * 將圖片檔轉為 MessageAttachment。過大的圖片會等比縮到長邊
 * MAX_IMAGE_DIMENSION_PX;動態 GIF 縮圖會失去動畫,因此 GIF 一律
 * 不 re-encode(超過大小上限時直接拒絕)。
 */
export const fileToImageAttachment = async (file: File): Promise<MessageAttachment> => {
  if (!isSupportedImageFile(file)) {
    throw new ImageAttachmentError(`不支援的圖片格式:${file.type || file.name}`);
  }
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new ImageAttachmentError('圖片超過 20MB 上限。');
  }

  const dataUrl = await readFileAsDataUrl(file);
  const passthrough = (): MessageAttachment => {
    const { mimeType, data } = splitDataUrl(dataUrl);
    return { kind: 'image', mimeType, data, name: file.name };
  };

  if (file.type === 'image/gif') {
    return passthrough();
  }

  const image = await loadImage(dataUrl);
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const needsResize = longestSide > MAX_IMAGE_DIMENSION_PX;

  if (!needsResize && file.size <= PASSTHROUGH_MAX_BYTES) {
    return passthrough();
  }

  const scale = needsResize ? MAX_IMAGE_DIMENSION_PX / longestSide : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    return passthrough();
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  // PNG 可能含透明度,re-encode 成 JPEG 會變黑底,保留 PNG;其餘轉 JPEG 壓縮。
  const targetMimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const encoded = canvas.toDataURL(
    targetMimeType,
    targetMimeType === 'image/jpeg' ? REENCODE_QUALITY : undefined,
  );
  const { mimeType, data } = splitDataUrl(encoded);
  return { kind: 'image', mimeType, data, name: file.name };
};

/** 附件轉 data URL(縮圖預覽 / 訊息泡泡顯示用)。 */
export const attachmentToDataUrl = (attachment: MessageAttachment): string =>
  `data:${attachment.mimeType};base64,${attachment.data}`;
