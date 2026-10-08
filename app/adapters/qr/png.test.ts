import QRCode from 'qrcode';
import { expect, it, vi } from 'vitest';

import { renderQrPng } from './png.js';

it('renders the exact verification URL as a scan-ready PNG with a quiet zone', async () => {
  const encode = vi.spyOn(QRCode, 'toBuffer');
  const url = `https://shop.example.org/panel/orders/verify/${'a'.repeat(64)}`;
  const image = await renderQrPng(url);
  expect(encode).toHaveBeenCalledWith(url, expect.objectContaining({ type: 'png', errorCorrectionLevel: 'M', width: 256, margin: 4 }));
  expect([...image.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  encode.mockRestore();
});
