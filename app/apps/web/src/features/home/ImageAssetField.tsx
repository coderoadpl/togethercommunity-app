import { useMutation } from '@tanstack/react-query';

import {
  IMAGE_ASSET_CONTENT_TYPES,
  IMAGE_ASSET_FAVICON_CONTENT_TYPES,
  IMAGE_ASSET_MAX_BYTES,
  imageAssetUploadInputSchema,
  type ImageAssetKind,
} from '#core/domain/index.js';

import { actions } from '../../api.js';
import {
  ImageAssetField as ImageAssetFieldView,
} from '../../components/ui/ImageAssetField.js';
import { errorCodeOf, localizePanelError, useTranslations } from '../../i18n/index.js';

interface ImageAssetFieldProps {
  id: string;
  label: string;
  hint?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  kind: ImageAssetKind;
  disabled?: boolean;
  testId: string;
}

const uploadActionByKind = {
  'course-cover': 'uploadCourseCover',
  'product-cover': 'uploadProductCover',
  logo: 'uploadBrandingAsset',
  favicon: 'uploadBrandingAsset',
} as const;

export const ImageAssetField = ({ onChange, kind, ...props }: ImageAssetFieldProps) => {
  const t = useTranslations();
  const upload = useMutation({
    ...actions[uploadActionByKind[kind]],
    onSuccess: ({ url }) => onChange(url),
  });
  const storageMissing = upload.isError && errorCodeOf(upload.error) === 'integration_not_configured';
  const allowedContentTypes = kind === 'favicon'
    ? IMAGE_ASSET_FAVICON_CONTENT_TYPES
    : IMAGE_ASSET_CONTENT_TYPES;
  const accept = kind === 'favicon'
    ? `${IMAGE_ASSET_FAVICON_CONTENT_TYPES.join(',')},.ico`
    : IMAGE_ASSET_CONTENT_TYPES.join(',');

  return (
    <ImageAssetFieldView
      {...props}
      accept={accept}
      allowedContentTypes={allowedContentTypes}
      maxBytes={IMAGE_ASSET_MAX_BYTES}
      onChange={onChange}
      uploading={upload.isPending}
      storageMissing={storageMissing}
      uploadError={upload.isError && !storageMissing ? localizePanelError(upload.error, t) : null}
      onUpload={(file) => {
        upload.reset();
        const input = imageAssetUploadInputSchema.safeParse({
          kind,
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        });
        if (!input.success) return;
        upload.mutate({
          ...input.data,
          body: file,
        });
      }}
    />
  );
};
