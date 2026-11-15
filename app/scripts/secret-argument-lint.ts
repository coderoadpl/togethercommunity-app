const shellFencePattern = /^```(?:bash|sh|shell|console)\s*$/;
const secretVariablePattern = /\$\{?[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*\}?/;
const keyHeaderPattern = /x-api-key:[^\n]*\$/i;
const bearerPattern = /authorization:\s*bearer\s+[^\n]*\$/i;
const dataArgumentPattern = /(?:^|\s)(?:-d|--data(?:-raw|-binary|-urlencode)?)(?:\s+|=)("(?:[^"\\]|\\.)*"|'[^']*'|\S+)/g;
const shellBuiltinPattern = /^\s*(?:printf|echo|read)\s/;
const secretOptionPattern = /--(?![a-z-]*-(?:env|id|file|stdin)[\s=])[a-z-]*(?:key|token|secret|password)[a-z-]*[\s=]+["']?\$/;

const lineProblem = (line: string): string | null => {
  if (shellBuiltinPattern.test(line)) return null;
  if (keyHeaderPattern.test(line)) return 'expands the shop key into a header argument; read the header from a 0600 file with -H @file';
  if (bearerPattern.test(line)) return 'expands a bearer token into a header argument; read the header from a 0600 file with -H @file';
  for (const match of line.matchAll(dataArgumentPattern)) {
    const value = match[1] ?? '';
    if (!value.startsWith("'") && secretVariablePattern.test(value)) {
      return 'expands a secret into a request body argument; pipe the body on stdin with --data-binary @-';
    }
  }
  if (secretOptionPattern.test(line)) return 'passes a secret as a command-line option; use the option that names an environment variable, or stdin';
  return null;
};

export const collectSecretArgumentProblems = (
  files: ReadonlyMap<string, string>,
  surfaces: readonly string[],
): string[] => {
  const problems: string[] = [];
  for (const rel of surfaces) {
    const text = files.get(rel);
    if (text === undefined) {
      problems.push(`[secret-argument] ${rel} is not tracked markdown`);
      continue;
    }
    let fence: 'none' | 'shell' | 'other' = 'none';
    text.split('\n').forEach((line, index) => {
      if (line.startsWith('```')) {
        fence = fence !== 'none' ? 'none' : shellFencePattern.test(line) ? 'shell' : 'other';
        return;
      }
      if (fence !== 'shell') return;
      const problem = lineProblem(line);
      if (problem !== null) problems.push(`[secret-argument] ${rel}:${String(index + 1)} ${problem}`);
    });
  }
  return problems;
};
