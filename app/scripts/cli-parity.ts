import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { API_ROUTES } from '#core/contract/index.js';

interface ParityRow {
  action: string;
  area: string;
  cli: boolean;
}

const visit = (node: ts.Node, inspect: (node: ts.Node) => void): void => {
  inspect(node);
  ts.forEachChild(node, (child) => visit(child, inspect));
};

const analyzeCliParity = (
  program: ts.Program,
  clientPath: string,
  cliPaths: string[],
  routeAreas: ReadonlyMap<string, string>,
): ParityRow[] => {
  const source = program.getSourceFile(clientPath);
  if (source === undefined) throw new Error(`Client source not found: ${clientPath}`);
  const methods = new Map<ts.Node, ParityRow>();
  visit(source, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== 'createApiClient') return;
    const initializer = node.initializer;
    if (initializer === undefined || !ts.isArrowFunction(initializer)) throw new Error('Unsupported client factory');
    const body = ts.isParenthesizedExpression(initializer.body) ? initializer.body.expression : initializer.body;
    if (!ts.isObjectLiteralExpression(body)) throw new Error('Client factory must return its method table');
    for (const property of body.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) || !ts.isArrowFunction(property.initializer)) {
        throw new Error(`Unsupported client method: ${property.getText(source)}`);
      }
      let area = 'other';
      visit(property.initializer, (child) => {
        if (area === 'other' && ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression)
          && child.expression.text === 'API_ROUTES') area = routeAreas.get(child.name.text) ?? 'other';
      });
      methods.set(property.initializer, { action: property.name.text, area, cli: false });
    }
  });
  if (methods.size === 0) throw new Error('Client method table is empty');
  const checker = program.getTypeChecker();
  for (const path of cliPaths) {
    const cli = program.getSourceFile(path);
    if (cli === undefined) throw new Error(`CLI source not found: ${path}`);
    visit(cli, (node) => {
      if (!ts.isCallExpression(node)) return;
      const declaration = checker.getResolvedSignature(node)?.declaration;
      const row = declaration === undefined ? undefined : methods.get(declaration);
      if (row !== undefined) row.cli = true;
    });
  }
  return [...methods.values()].sort((a, b) => a.area.localeCompare(b.area) || a.action.localeCompare(b.action));
};

export const collectCliParity = (root = fileURLToPath(new URL('..', import.meta.url))): ParityRow[] => {
  const clientPath = join(root, 'core/client/http.ts');
  const cliRoot = join(root, 'apps/cli/src');
  const cliPaths = readdirSync(cliRoot, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'))
    .map((path) => join(cliRoot, path));
  const configPath = join(root, 'tsconfig.json');
  const config = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, 'utf8'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram([clientPath, ...cliPaths], parsed.options);
  const routeAreas = new Map(Object.entries(API_ROUTES).map(([key, route]) => [key, route.path.split('/')[2] ?? 'other']));
  return analyzeCliParity(program, clientPath, cliPaths, routeAreas);
};

export const formatCliParity = (rows: ParityRow[]): string => {
  const missing = rows.filter((row) => !row.cli);
  const areas = [...new Set(missing.map((row) => row.area))].sort();
  return [
    `CLI parity: ${rows.length - missing.length}/${rows.length} client actions called; ${missing.length} missing (report only)`,
    '',
    'Area\tClient action\tCLI call',
    ...rows.map((row) => `${row.area}\t${row.action}\t${row.cli ? 'yes' : 'missing'}`),
    '',
    'Missing by area:',
    ...areas.map((area) => `${area} (${missing.filter((row) => row.area === area).length}):\n${missing
      .filter((row) => row.area === area).map((row) => `  ${row.action}`).join('\n')}`),
  ].join('\n');
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(formatCliParity(collectCliParity()));
}
