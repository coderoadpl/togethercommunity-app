import { z } from 'zod';
import type { ApiClient } from '#core/client/index.js';
import { err, ok, validation, type AppError, type Result } from '#core/domain/index.js';
import { manifestOperationError } from './plan.js';

type WorkspaceOrigins = (workspace: string) => string;
type InstanceProbe = Pick<ApiClient, 'me' | 'getTenantRouting'>;

const LOOPBACK_HOST = 'localhost';
const PLATFORM_HOST_LABEL = 'start';

export const baseDomainSchema = z.string().trim().toLowerCase()
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);

const unusableOrigin = () => err(validation(
  'Cannot use this API origin for workspace requests. Use localhost, or a host of the instance that serves it: its base domain, its platform host (start.<domain>) or one of its workspace hosts',
));
const hostnameOf = (url: URL): string => url.hostname.replace(/\.+$/, '');
const isDirectHostOf = (host: string, baseDomain: string): boolean =>
  host === baseDomain || (host.endsWith(`.${baseDomain}`) && !host.slice(0, -(baseDomain.length + 1)).includes('.'));

type Discovery = { kind: 'discovered'; baseDomain: string } | { kind: 'unavailable' };

const discoverBaseDomain = async (
  profile: URL, probeFor: (workspace: string) => InstanceProbe, workspaces: readonly string[],
): Promise<Result<Discovery, AppError>> => {
  for (const workspace of workspaces) {
    const probe = probeFor(workspace);
    const identity = await probe.me();
    if (!identity.ok) {
      if (identity.error.code === 'tenant_not_found') continue;
      return err(manifestOperationError(identity.error, workspace, 'instance:identity'));
    }
    const tenant = identity.value.tenant;
    if (tenant === null) return ok({ kind: 'unavailable' });
    const routing = await probe.getTenantRouting();
    if (!routing.ok) return err(manifestOperationError(routing.error, workspace, 'instance:routing'));
    const tenantOrigin = `${profile.protocol}//${routing.value.routing.tenantHost}`;
    if (!URL.canParse(tenantOrigin)) return unusableOrigin();
    const tenantUrl = new URL(tenantOrigin);
    const tenantHost = hostnameOf(tenantUrl);
    const baseDomain = tenantHost.slice(tenant.slug.length + 1);
    if (tenantHost !== `${tenant.slug}.${baseDomain}` || tenantUrl.port !== profile.port || !isDirectHostOf(hostnameOf(profile), baseDomain)) {
      return unusableOrigin();
    }
    return ok({ kind: 'discovered', baseDomain });
  }
  return ok({ kind: 'unavailable' });
};

const workspaceOriginsOn = (profile: URL, baseDomain: string): WorkspaceOrigins => (workspace) => {
  const target = new URL(profile.origin);
  target.hostname = `${workspace}.${baseDomain}`;
  return target.origin;
};

export const manifestWorkspaceOrigins = async (
  apiUrl: string,
  probeFor: (workspace: string) => InstanceProbe,
  workspaces: readonly string[],
  explicitBaseDomain?: string,
): Promise<Result<WorkspaceOrigins, AppError>> => {
  if (!URL.canParse(apiUrl)) return unusableOrigin();
  const profile = new URL(apiUrl);
  const host = hostnameOf(profile);
  if (host === LOOPBACK_HOST) return ok(() => profile.origin);
  const discovery = await discoverBaseDomain(profile, probeFor, workspaces);
  if (!discovery.ok) return discovery;
  if (discovery.value.kind === 'discovered') {
    if (explicitBaseDomain !== undefined && explicitBaseDomain !== discovery.value.baseDomain) {
      return err(validation('The --base-domain option does not match the base domain reported by the API origin'));
    }
    return ok(workspaceOriginsOn(profile, discovery.value.baseDomain));
  }
  if (explicitBaseDomain === undefined) {
    return err(validation(
      'The API origin did not report its base domain: it is the platform host, or no selected workspace exists yet. Pass --base-domain <domain> for an API origin that is start.<domain> or <domain>',
    ));
  }
  if (host !== explicitBaseDomain && host !== `${PLATFORM_HOST_LABEL}.${explicitBaseDomain}`) {
    return err(validation('With --base-domain the API origin must be the platform host (start.<domain>) or the base domain itself'));
  }
  return ok(workspaceOriginsOn(profile, explicitBaseDomain));
};
