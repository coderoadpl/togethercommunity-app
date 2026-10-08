import QRCode from 'qrcode';

export const renderQrPng = async (url: string): Promise<Uint8Array> =>
  QRCode.toBuffer(url, { type: 'png', errorCorrectionLevel: 'M', width: 256, margin: 4 });
