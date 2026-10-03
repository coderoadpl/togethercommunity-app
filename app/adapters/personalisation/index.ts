import { copyIdentifierSchema, err, ok, validation } from '#core/domain/index.js';
import type { DownloadPersonaliser } from '#core/server/index.js';

import { personaliseEpub } from './epub.js';
import { personalisePdf } from './pdf.js';

export const createDownloadPersonaliser = (): DownloadPersonaliser => ({
  personalise: async ({ contentType, bytes, copyIdentifier, context }) => {
    try {
      copyIdentifierSchema.parse(copyIdentifier);
      if (bytes.byteLength > context.maxBytes) throw new Error('Input exceeds the byte ceiling');
      const output = contentType === 'application/pdf'
        ? await personalisePdf(bytes, copyIdentifier, context.maxBytes)
        : contentType === 'application/epub+zip' ? personaliseEpub(bytes, copyIdentifier, context.maxBytes) : null;
      if (output === null || output.byteLength > context.maxBytes) return err(validation('File cannot be personalised within the byte ceiling'));
      return ok({ bytes: output, contentType });
    } catch {
      return err(validation('File metadata could not be personalised'));
    }
  },
});
