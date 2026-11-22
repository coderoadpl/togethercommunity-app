import type { Context } from 'hono';
import type { z } from 'zod';

import { SHOP_DOWNLOAD_ROUTES, shopDownloadContracts } from '#core/contract/index.js';
import { err, ok, validation, type AppError, type Result } from '#core/domain/index.js';
import {
  attachStagedProductDownload,
  beginKeyDownloadUpload,
  completeKeyDownloadUpload,
  copyKeyDownloadFile,
  discardKeyDownloadFile,
  listKeyDownloadFiles,
  listProductDownloadAssets,
  removeProductDownloadFile,
} from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import type { AppDeps } from './composition.js';
import { productDownloadMetadata } from './product-download-metadata.js';
import { readJson } from './read-json.js';
import { respond, retryAfterHeaders } from './respond.js';
import { NOT_IN_RELEASE, type ShopMachineRoute } from './shop-machine-auth.js';

const bodyOf = async <S extends z.ZodTypeAny>(c: Context<AppVars>, schema: S, message: string): Promise<Result<z.output<S>, AppError>> => {
  const parsed = schema.safeParse(await readJson(c.req.raw));
  return parsed.success ? ok(parsed.data) : err(validation(message, parsed.error.flatten()));
};

const respondWithRetry = <T>(result: Result<T, AppError>): Response =>
  respond(result, result.ok ? {} : { headers: retryAfterHeaders(result.error) });

export const shopDownloadRoutes = (deps: AppDeps): readonly ShopMachineRoute[] => {
  const routes = SHOP_DOWNLOAD_ROUTES;
  const contracts = shopDownloadContracts;
  const assetAnswer = (result: Result<Parameters<typeof productDownloadMetadata>[0], AppError>) =>
    respond(result.ok ? ok({ asset: productDownloadMetadata(result.value, deps.personalisationMaxBytes) }) : result);
  return [
    {
      ...routes.uploadStagedDownload,
      proposeMode: NOT_IN_RELEASE,
      handler: async (c, { ctx }) => {
        const input = await bodyOf(c, contracts.uploadStagedDownload.input, 'Invalid download file upload');
        return input.ok ? respondWithRetry(await beginKeyDownloadUpload(ctx, input.value, deps)) : respond(input);
      },
    },
    {
      ...routes.completeStagedDownload,
      proposeMode: NOT_IN_RELEASE,
      handler: async (c, { ctx }) => {
        const input = await bodyOf(c, contracts.completeStagedDownload.input, 'Invalid download file completion');
        return input.ok ? respondWithRetry(await completeKeyDownloadUpload(ctx, input.value, deps)) : respond(input);
      },
    },
    {
      ...routes.copyStagedDownload,
      proposeMode: NOT_IN_RELEASE,
      handler: async (c, { ctx }) => {
        const input = await bodyOf(c, contracts.copyStagedDownload.input, 'Invalid download file copy');
        return input.ok ? respondWithRetry(await copyKeyDownloadFile(ctx, input.value, deps)) : respond(input);
      },
    },
    {
      ...routes.listStagedDownloads,
      proposeMode: NOT_IN_RELEASE,
      handler: async (_c, { ctx }) => respond(await listKeyDownloadFiles(ctx, deps)),
    },
    {
      ...routes.discardStagedDownload,
      proposeMode: NOT_IN_RELEASE,
      handler: async (c, { ctx }) => respond(await discardKeyDownloadFile(ctx, { id: c.req.param('id') ?? '' }, deps)),
    },
    {
      ...routes.listProductDownloads,
      handler: async (c, { ctx }) => {
        const result = await listProductDownloadAssets(ctx, c.req.param('productId') ?? '', deps);
        return respond(result.ok
          ? ok({
              assets: result.value.map((asset) => productDownloadMetadata(asset, deps.personalisationMaxBytes)),
              personalisationMaxBytes: deps.personalisationMaxBytes,
            })
          : result);
      },
    },
    {
      ...routes.addProductDownload,
      proposeMode: NOT_IN_RELEASE,
      handler: async (c, { ctx }) => {
        const input = await bodyOf(c, contracts.addProductDownload.input, 'Invalid product file attachment');
        return input.ok ? assetAnswer(await attachStagedProductDownload(ctx, input.value, deps)) : respond(input);
      },
    },
    {
      ...routes.replaceProductDownload,
      proposeMode: NOT_IN_RELEASE,
      handler: async (c, { ctx }) => {
        const input = await bodyOf(c, contracts.replaceProductDownload.input, 'Invalid product file replacement');
        return input.ok ? assetAnswer(await attachStagedProductDownload(ctx, input.value, deps)) : respond(input);
      },
    },
    {
      ...routes.removeProductDownload,
      proposeMode: NOT_IN_RELEASE,
      handler: async (c, { ctx }) => {
        const input = await bodyOf(c, contracts.removeProductDownload.input, 'Invalid product file removal');
        return input.ok ? respond(await removeProductDownloadFile(ctx, input.value, deps)) : respond(input);
      },
    },
  ];
};
