import {
  downloadFailureReferenceSchema,
  memberDownloadFailureCodeSchema,
  MY_PRODUCTS_PATH,
  type MemberDownloadFailureCode,
} from '#core/domain/index.js';

export const MEMBER_DOWNLOAD_FAILURE_PARAMS = { code: 'downloadError', productId: 'product', assetId: 'asset' } as const;

interface MemberDownloadFailure {
  code: MemberDownloadFailureCode;
  productId: string | null;
  assetId: string | null;
}

const referenceOrNull = (value: string | null): string | null => {
  const parsed = downloadFailureReferenceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const parseMemberDownloadFailure = (search: URLSearchParams): MemberDownloadFailure | null => {
  const code = memberDownloadFailureCodeSchema.safeParse(search.get(MEMBER_DOWNLOAD_FAILURE_PARAMS.code));
  if (!code.success) return null;
  const productId = referenceOrNull(search.get(MEMBER_DOWNLOAD_FAILURE_PARAMS.productId));
  return {
    code: code.data,
    productId,
    assetId: productId === null ? null : referenceOrNull(search.get(MEMBER_DOWNLOAD_FAILURE_PARAMS.assetId)),
  };
};

export const memberDownloadFailurePath = (failure: {
  code: MemberDownloadFailureCode;
  productId: string;
  assetId: string;
}): string => {
  const search = new URLSearchParams({ [MEMBER_DOWNLOAD_FAILURE_PARAMS.code]: failure.code });
  const productId = referenceOrNull(failure.productId);
  const assetId = referenceOrNull(failure.assetId);
  if (productId !== null) {
    search.set(MEMBER_DOWNLOAD_FAILURE_PARAMS.productId, productId);
    if (assetId !== null) search.set(MEMBER_DOWNLOAD_FAILURE_PARAMS.assetId, assetId);
  }
  return `${MY_PRODUCTS_PATH}?${search.toString()}`;
};

export const MEMBER_DOWNLOAD_SIGN_IN_PATH = `/login?${new URLSearchParams({ returnTo: MY_PRODUCTS_PATH }).toString()}`;
