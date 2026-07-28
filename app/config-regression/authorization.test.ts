import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { collectPermissionInventory } from '../scripts/permission-inventory.js';
import { collectRuntimeRoutes } from '../scripts/generate-route-table.mjs';

const appRoot = join(import.meta.dirname, '..');
const useCasesRoot = join(appRoot, 'core', 'server', 'usecases');
const internalAppPath = join(appRoot, 'apps', 'server', 'src', 'internal-app.ts');
const exportedCtxUseCase = /export const (\w+)\s*=\s*(?:async\s*)?\(\s*ctx:\s*Ctx\b/g;
const repositoryAccess = /\bdeps(?:\.\w+)+\s*\(/;
const AUTH_ONLY: Record<string, string> = {
  'community-access.ts#memberScope': 'identity narrowing utility with no repository access',
  'community-access.ts#requireActor': 'caller-supplied capability authorization utility',
  'community-access.ts#requireMemberOrStaff': 'caller-supplied capability authorization utility',
  'community-access.ts#requireTenant': 'caller-supplied capability authorization utility',
};

interface UseCaseSource {
  subject: string;
  body: string;
}

const collectUseCaseSources = (): UseCaseSource[] => {
  const found: UseCaseSource[] = [];
  for (const file of readdirSync(useCasesRoot).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  )) {
    const source = readFileSync(join(useCasesRoot, file), 'utf8');
    const matches = [...source.matchAll(exportedCtxUseCase)];
    matches.forEach((match, index) => {
      found.push({
        subject: `${file}#${match[1] ?? ''}`,
        body: source.slice(match.index, matches[index + 1]?.index ?? source.length),
      });
    });
  }
  return found;
};

const routeHandlersAfterIdentity = (): Array<{ subject: string; body: string }> => {
  const source = readFileSync(internalAppPath, 'utf8');
  const identityMiddleware = source.indexOf("app.use('/api/*'");
  const sourceFile = ts.createSourceFile(
    internalAppPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: Array<{ subject: string; body: string }> = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(sourceFile) === 'app'
      && ['get', 'post', 'put', 'patch', 'delete'].includes(node.expression.name.text)
      && node.getStart(sourceFile) > identityMiddleware
    ) {
      const handler = node.arguments.at(-1);
      if (handler !== undefined) {
        found.push({
          subject: `${node.expression.name.text.toUpperCase()} ${node.arguments[0]?.getText(sourceFile) ?? ''}`,
          body: handler.getText(sourceFile),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
};

describe('authorization fail-closed probes', () => {
  it('declares a closed capability for every real route and exported Ctx use-case', () => {
    const inventory = collectPermissionInventory();
    const runtimeRoutes = collectRuntimeRoutes().map(
      (route) => `${route.method} ${route.path}`,
    );
    expect(inventory.routes.map((row) => row.subject)).toEqual(runtimeRoutes);
    expect(inventory.routes.every((row) => row.capability !== null)).toBe(true);

    const useCases = collectUseCaseSources();
    expect(inventory.useCases.map((row) => row.subject).sort()).toEqual(
      useCases
        .filter((useCase) => !(useCase.subject in AUTH_ONLY))
        .map((useCase) => useCase.subject)
        .sort(),
    );
    expect(inventory.useCases.every((row) => row.capability !== null)).toBe(true);
  });

  it('requires one declared authorization capability for every exported Ctx use-case', () => {
    const inventory = new Map(
      collectPermissionInventory().useCases.map((row) => [row.subject, row.capability]),
    );
    const offenders = collectUseCaseSources()
      .filter((useCase) => !(useCase.subject in AUTH_ONLY) && !inventory.has(useCase.subject))
      .map((useCase) => useCase.subject);
    expect(offenders).toEqual([]);
  });

  it('keeps authentication-only and authorization-utility exceptions current', () => {
    const names = new Set(collectUseCaseSources().map((useCase) => useCase.subject));
    expect(Object.keys(AUTH_ONLY).filter((subject) => !names.has(subject))).toEqual([]);
  });

  it('requires authorization before an identity-middleware route reaches a repository directly', () => {
    const repositoryBacked = routeHandlersAfterIdentity()
      .filter((route) => repositoryAccess.test(route.body));
    expect(repositoryBacked.length).toBeGreaterThanOrEqual(2);
    const offenders = repositoryBacked
      .filter((route) => {
        const gate = route.body.search(/\bauthorize(?:RequiredTenant|Tenant)?\s*\(/);
        const repository = route.body.search(repositoryAccess);
        return gate === -1 || gate > repository;
      })
      .map((route) => route.subject);
    expect(offenders).toEqual([]);
  });
});
