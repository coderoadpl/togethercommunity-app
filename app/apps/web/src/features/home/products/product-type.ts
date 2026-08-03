import type { ProductType } from '#core/domain/index.js';

import type { Messages } from '../../../i18n/index.js';

export const productTypeLabel = (type: ProductType, t: Messages): string => {
  switch (type) {
    case 'course':
      return t.products.typeCourse;
    case 'digital_download':
      return t.products.typeDigitalDownload;
    case 'membership':
      return t.products.typeMembership;
  }
};
