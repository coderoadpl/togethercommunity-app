import type {
  DefaultError,
  FetchQueryOptions,
  MutationFunction,
  MutationKey,
  MutationOptions,
  QueryFunction,
  QueryFunctionContext,
  QueryKey,
} from '@tanstack/query-core';

import type {
  ProductsPublishInput,
  SimulatePurchaseInput,
  TenantCreateInput,
} from '@core/contract/index.js';
import type { MemberExportFormat, NewProductInput } from '@core/domain/index.js';

import type { AuthClientPort, AuthSessionResult } from './auth-port.js';
import { unwrap, type ApiClient, type ReadResult, type WriteResult } from './http.js';

/**
 * Identity helpers that type descriptors against `@tanstack/query-core` option
 * types (never `@tanstack/react-query`, which `core/client` may not import).
 * They bind the `queryFn` result type to the key so `useQuery`/`useMutation`
 * infer `data`/`variables` at the call site without explicit generics.
 *
 * CQRS partition is enforced here: `defineQuery` accepts only a read-tagged
 * `call` (a GET contract route), `defineMutation` only a write-tagged one.
 * Each helper owns the `unwrap` so the tag never leaks into `data`/`variables`.
 */
export type QueryDescriptor<TQueryFnData, TQueryKey extends QueryKey> = FetchQueryOptions<
  TQueryFnData,
  DefaultError,
  TQueryFnData,
  TQueryKey
> & { queryFn: QueryFunction<TQueryFnData, TQueryKey> };

type ReadCall<TQueryFnData, TQueryKey extends QueryKey> = (
  context: QueryFunctionContext<TQueryKey>,
) => Promise<ReadResult<TQueryFnData>>;

type DefineQueryInput<TQueryFnData, TQueryKey extends QueryKey> = Omit<
  QueryDescriptor<TQueryFnData, TQueryKey>,
  'queryFn'
> & { call: ReadCall<TQueryFnData, TQueryKey> };

export const defineQuery = <TQueryFnData, TQueryKey extends QueryKey>(
  input: DefineQueryInput<TQueryFnData, TQueryKey>,
): QueryDescriptor<TQueryFnData, TQueryKey> => {
  const { call, ...rest } = input;
  return { ...rest, queryFn: async (context) => unwrap(await call(context)) };
};

export type MutationDescriptor<TData, TVariables> = MutationOptions<
  TData,
  DefaultError,
  TVariables
> & { mutationKey: MutationKey; mutationFn: MutationFunction<TData, TVariables> };

type WriteCall<TData, TVariables> = (variables: TVariables) => Promise<WriteResult<TData>>;

type DefineMutationInput<TData, TVariables> = Omit<
  MutationDescriptor<TData, TVariables>,
  'mutationFn'
> & { call: WriteCall<TData, TVariables> };

export const defineMutation = <TData, TVariables>(
  input: DefineMutationInput<TData, TVariables>,
): MutationDescriptor<TData, TVariables> => {
  const { call, ...rest } = input;
  return { ...rest, mutationFn: async (variables) => unwrap(await call(variables)) };
};

/**
 * Query keys are the public API of each resource: general → specific, matched
 * by prefix for invalidation and per-prefix defaults. Never hand-copy a key.
 */
export const meScopes = {
  all: () => ['me'] as const,
};

export const tenantsScopes = {
  all: () => ['tenants'] as const,
};

export const publicOfferScopes = {
  all: () => ['public-offer'] as const,
};

export const authConfigScopes = {
  all: () => ['auth-config'] as const,
};

export const productsScopes = {
  all: () => ['products'] as const,
  lists: () => ['products', 'list'] as const,
};

export const myProductsScopes = {
  all: () => ['my-products'] as const,
};

export const membersScopes = {
  all: () => ['members'] as const,
  export: (format: MemberExportFormat) => ['members', 'export', format] as const,
};

export const authScopes = {
  all: () => ['auth'] as const,
  magicLink: (email: string) => ['auth', 'dev-magic-link', email] as const,
};

export const meQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: meScopes.all(),
    call: ({ signal }) => api.me(signal),
  });

export const tenantsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: tenantsScopes.all(),
    call: ({ signal }) => api.listTenants(signal),
  });

export const publicOfferQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: publicOfferScopes.all(),
    call: ({ signal }) => api.publicOffer(signal),
  });

export const authConfigQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: authConfigScopes.all(),
    call: ({ signal }) => api.authConfig(signal),
  });

export const createTenantMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantsScopes.all(), 'create'],
    call: (input: TenantCreateInput) => api.createTenant(input),
  });

export const productsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: productsScopes.lists(),
    call: ({ signal }) => api.listProducts(signal),
  });

export const createProductMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...productsScopes.all(), 'create'],
    call: (input: NewProductInput) => api.createProduct(input),
  });

export const publishProductMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...productsScopes.all(), 'publish'],
    call: (input: ProductsPublishInput) => api.publishProduct(input),
  });

export const myProductsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: myProductsScopes.all(),
    call: ({ signal }) => api.myProducts(signal),
  });

export const membersQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: membersScopes.all(),
    call: ({ signal }) => api.listMembers(signal),
  });

export const membersExportQuery = (api: ApiClient, format: MemberExportFormat) =>
  defineQuery({
    queryKey: membersScopes.export(format),
    staleTime: 0,
    gcTime: 0,
    call: ({ signal }) => api.exportMembers(format, signal),
  });

export const simulatePurchaseMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...myProductsScopes.all(), 'simulate-purchase'],
    call: (input: SimulatePurchaseInput) => api.simulatePurchase(input),
  });

export const devMagicLinkQuery = (api: ApiClient, email: string) =>
  defineQuery({
    queryKey: authScopes.magicLink(email),
    call: ({ signal }) => api.devMagicLink(email, signal),
  });

/** The invalidation filter product mutations apply after they settle. */
export const productsInvalidates = () => ({ queryKey: productsScopes.lists() });

/** The invalidation filter a simulated purchase applies after it settles. */
export const myProductsInvalidates = () => ({ queryKey: myProductsScopes.all() });

/**
 * Auth side effects are mutation descriptors over `AuthClientPort` like any
 * other action — never hand-rolled pending/error state around a port call.
 */
export const signUpMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-up'],
    call: (input: { name: string; email: string; password: string }) => auth.signUp(input),
  });

export const signInMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-in'],
    call: (input: { email: string; password: string }) => auth.signIn(input),
  });

export const requestMagicLinkMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'magic-link'],
    call: (input: { email: string; callbackURL: string }) => auth.requestMagicLink(input),
  });

export const signOutMutation = (auth: AuthClientPort): MutationDescriptor<void, void> =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-out'],
    call: () => auth.signOut(),
  });

export const registerPasskeyMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'register-passkey'],
    call: (input: { name: string }) => auth.registerPasskey(input.name),
  });

export const signInWithPasskeyMutation = (auth: AuthClientPort): MutationDescriptor<AuthSessionResult, void> =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-in-passkey'],
    call: () => auth.signInWithPasskey(),
  });

export const enableTwoFactorMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'enable-two-factor'],
    call: (input: { password: string }) => auth.enableTwoFactor(input.password),
  });

export const verifyTotpMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'verify-totp'],
    call: (input: { code: string }) => auth.verifyTotp(input.code),
  });

export const signInWithGoogleMutation = (auth: AuthClientPort): MutationDescriptor<void, void> =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-in-google'],
    call: () => auth.signInWithGoogle(),
  });
