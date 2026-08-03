const semverCore = String.raw`(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)`;
const semverPrerelease = String.raw`(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?`;
const semverBuild = String.raw`(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const strictSemverPattern = new RegExp(`^${semverCore}${semverPrerelease}${semverBuild}$`);
const semverClaimPattern = new RegExp(
  `(?<![0-9A-Za-z.-])v?(${semverCore}${semverPrerelease}${semverBuild})(?![0-9A-Za-z.-])`,
  'g',
);
const releaseVersionRegionPattern =
  /<!--release-version-->([\s\S]*?)<!--\/release-version-->/g;

interface ReleaseVersionLintResult {
  problems: string[];
  claimsSeen: number;
}

export const collectReleaseVersionProblems = (
  files: ReadonlyMap<string, string>,
  appVersion: string,
  requiredRegions: readonly string[],
): ReleaseVersionLintResult => {
  const problems: string[] = [];
  if (!strictSemverPattern.test(appVersion)) {
    problems.push(`[version] package.json version "${appVersion}" is not strict SemVer`);
  }

  const regionsByFile = new Map<string, number>();
  let claimsSeen = 0;
  for (const [rel, text] of files) {
    let regionsSeen = 0;
    for (const region of text.matchAll(releaseVersionRegionPattern)) {
      regionsSeen += 1;
      const claims = [...(region[1] ?? '').matchAll(semverClaimPattern)];
      if (claims.length === 0) {
        problems.push(`[version] ${rel}: release-version region contains no strict SemVer claim`);
      }
      claimsSeen += claims.length;
      for (const claim of claims) {
        const claimVersion = claim[1] ?? '';
        if (claimVersion !== appVersion) {
          problems.push(
            `[version] ${rel}: release-version region claims ${claim[0]} but package.json is ${appVersion}`,
          );
        }
      }
    }
    regionsByFile.set(rel, regionsSeen);
  }

  for (const rel of requiredRegions) {
    const text = files.get(rel);
    if (text === undefined) {
      problems.push(`[version] required release-version surface ${rel} is not tracked markdown`);
      continue;
    }
    if (regionsByFile.get(rel) === 0) {
      problems.push(`[version] ${rel} must carry a release-version region`);
    }
    const outsideRegions = text.replace(releaseVersionRegionPattern, '\n');
    for (const claim of outsideRegions.matchAll(semverClaimPattern)) {
      problems.push(
        `[version] ${rel}: claim ${claim[0]} must be inside a release-version region`,
      );
    }
  }

  return { problems, claimsSeen };
};
