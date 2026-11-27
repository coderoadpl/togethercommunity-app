import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { z } from 'zod';

const hash = (data: string | Buffer) => createHash('sha256').update(data).digest();
const cborBytes = (value: Buffer) => Buffer.concat([
  value.length < 24 ? Buffer.from([0x40 + value.length]) : Buffer.from([0x58, value.length]),
  value,
]);
const cborText = (value: string) => Buffer.concat([
  Buffer.from([0x60 + Buffer.byteLength(value)]), Buffer.from(value),
]);
const jwkCoordinates = z.object({ x: z.string(), y: z.string() });

type Ceremony = { challenge: string; origin: string };

export const createTestPasskey = (rpId: string) => {
  const credentialId = randomBytes(32);
  const id = credentialId.toString('base64url');
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const { x, y } = jwkCoordinates.parse(publicKey.export({ format: 'jwk' }));
  const rpHash = hash(rpId);
  const credential = { id, rawId: id, type: 'public-key' as const, clientExtensionResults: {} };
  let counter = 0;

  const clientData = (type: string, input: Ceremony) => Buffer.from(JSON.stringify({
    type, ...input, crossOrigin: false,
  }));

  return {
    register(input: Ceremony) {
      const coseKey = Buffer.concat([
        Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21]),
        cborBytes(Buffer.from(x, 'base64url')), Buffer.from([0x22]),
        cborBytes(Buffer.from(y, 'base64url')),
      ]);
      const authData = Buffer.concat([
        rpHash, Buffer.from([0x41]), Buffer.alloc(4), Buffer.alloc(16),
        Buffer.from([0, credentialId.length]), credentialId, coseKey,
      ]);
      const attestation = Buffer.concat([
        Buffer.from([0xa3]), cborText('fmt'), cborText('none'), cborText('attStmt'),
        Buffer.from([0xa0]), cborText('authData'), cborBytes(authData),
      ]);
      return {
        ...credential,
        response: {
          clientDataJSON: clientData('webauthn.create', input).toString('base64url'),
          attestationObject: attestation.toString('base64url'),
        },
      };
    },
    authenticate(input: Ceremony) {
      const data = clientData('webauthn.get', input);
      const signCount = Buffer.alloc(4);
      signCount.writeUInt32BE(++counter);
      const authData = Buffer.concat([rpHash, Buffer.from([0x01]), signCount]);
      const signature = sign('sha256', Buffer.concat([authData, hash(data)]), privateKey);
      return {
        ...credential,
        response: {
          clientDataJSON: data.toString('base64url'),
          authenticatorData: authData.toString('base64url'),
          signature: signature.toString('base64url'),
        },
      };
    },
  };
};
