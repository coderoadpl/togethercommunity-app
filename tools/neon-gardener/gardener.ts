declare const Bun: {
  env: Record<string, string | undefined>;
};

declare const process: {
  exitCode?: number;
};

export {};

const API_BASE = "https://console.neon.tech/api/v2";
const DEFAULT_TTL_HOURS = 72;
const DEFAULT_PROTECTED = "main,preview/staging";

type Branch = {
  id: string;
  name: string;
  default: boolean;
  protected: boolean;
  expiresAt: string | null;
};

type BranchPage = {
  branches: Branch[];
  next: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredEnv(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseTtlHours(value: string | undefined): number {
  const raw = value ?? String(DEFAULT_TTL_HOURS);
  if (!raw.trim()) {
    throw new Error("TTL_HOURS must be a positive number");
  }
  const ttlHours = Number(raw);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
    throw new Error("TTL_HOURS must be a positive number");
  }
  return ttlHours;
}

function parseDryRun(value: string | undefined): boolean {
  const normalized = (value ?? "false").trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error("DRY_RUN must be true or false");
}

function parseProtected(value: string | undefined): Set<string> {
  return new Set(
    (value ?? DEFAULT_PROTECTED)
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );
}

function parseBranch(value: unknown): Branch {
  if (!isRecord(value)) {
    throw new Error("Neon API returned an invalid branch");
  }

  const id = value.id;
  const name = value.name;
  const defaultBranch = value.default;
  const protectedBranch = value.protected;
  const expiresAt = value.expires_at;

  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof defaultBranch !== "boolean" ||
    typeof protectedBranch !== "boolean" ||
    (expiresAt !== undefined && expiresAt !== null && typeof expiresAt !== "string")
  ) {
    throw new Error("Neon API returned an invalid branch");
  }

  return {
    id,
    name,
    default: defaultBranch,
    protected: protectedBranch,
    expiresAt: expiresAt ?? null,
  };
}

function parseBranchPage(value: unknown): BranchPage {
  if (!isRecord(value) || !Array.isArray(value.branches)) {
    throw new Error("Neon API returned an invalid branch list");
  }

  let next: string | null = null;
  if (value.pagination !== undefined) {
    if (!isRecord(value.pagination)) {
      throw new Error("Neon API returned invalid pagination data");
    }
    const nextValue = value.pagination.next;
    if (nextValue !== undefined && typeof nextValue !== "string") {
      throw new Error("Neon API returned invalid pagination data");
    }
    next = nextValue && nextValue.length > 0 ? nextValue : null;
  }

  return {
    branches: value.branches.map(parseBranch),
    next,
  };
}

function expirationFromNow(ttlHours: number): string {
  const date = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("TTL_HOURS produces an invalid expiration date");
  }
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function run(): Promise<void> {
  const apiKey = requiredEnv("NEON_API_KEY");
  const projectId = requiredEnv("NEON_PROJECT_ID");
  const ttlHours = parseTtlHours(Bun.env.TTL_HOURS);
  const protectedNames = parseProtected(Bun.env.PROTECTED);
  const dryRun = parseDryRun(Bun.env.DRY_RUN);

  async function neonRequest(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${apiKey}`);

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, { ...init, headers });
    } catch (error: unknown) {
      throw new Error(`Neon API request failed: ${formatError(error)}`);
    }

    if (!response.ok) {
      const details = (await response.text()).trim().replace(/\s+/g, " ").slice(0, 500);
      const suffix = details ? `: ${details}` : "";
      throw new Error(`Neon API ${response.status} ${response.statusText}${suffix}`);
    }

    return response;
  }

  const branches: Branch[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  do {
    const query = new URLSearchParams({
      limit: "1000",
      sort_by: "name",
      sort_order: "asc",
    });
    if (cursor) {
      query.set("cursor", cursor);
    }

    const response = await neonRequest(
      `/projects/${encodeURIComponent(projectId)}/branches?${query.toString()}`,
    );
    const payload: unknown = await response.json();
    const page = parseBranchPage(payload);
    branches.push(...page.branches);

    if (page.next && seenCursors.has(page.next)) {
      throw new Error("Neon API returned a repeated pagination cursor");
    }
    if (page.next) {
      seenCursors.add(page.next);
    }
    cursor = page.next;
  } while (cursor);

  const expiration = expirationFromNow(ttlHours);
  let eligible = 0;
  let stamped = 0;

  for (const branch of branches) {
    if (
      !branch.name.startsWith("preview/") ||
      branch.default ||
      branch.protected ||
      protectedNames.has(branch.name) ||
      branch.expiresAt !== null
    ) {
      continue;
    }

    eligible += 1;
    if (dryRun) {
      console.log(
        `DRY_RUN branch=${JSON.stringify(branch.name)} id=${branch.id} expires_at=${expiration}`,
      );
      continue;
    }

    await neonRequest(
      `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branch.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: { expires_at: expiration } }),
      },
    );
    stamped += 1;
    console.log(
      `STAMPED branch=${JSON.stringify(branch.name)} id=${branch.id} expires_at=${expiration}`,
    );
  }

  console.log(
    `SUMMARY scanned=${branches.length} eligible=${eligible} stamped=${stamped} dry_run=${dryRun}`,
  );
}

try {
  await run();
} catch (error: unknown) {
  console.error(`ERROR ${formatError(error).replace(/\s+/g, " ")}`);
  process.exitCode = 1;
}
