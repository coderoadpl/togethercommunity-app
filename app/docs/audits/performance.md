# Performance audit

## Purpose

Establish honest application-performance evidence and its limits, reviewing
instrument readiness before making any route-level measurement or budget claim.

## Run contract

- **Cadence:** review instrument selection quarterly and before go-live. After
  an instrument is adopted, measure before each release and after material
  route, asset, query, or rendering changes.
- **Owner:** the web owner owns browser-route evidence; the server owner owns API
  and worker evidence; the product owner approves budgets and exceptions.
- **Output format:** a Markdown audit record using the fields required by the
  [roster doctrine](README.md), with route, account state, locale, viewport,
  environment, instrument/version, sample count, percentile, LCP, INP, CLS,
  backend timing where applicable, finding, owner, and due date. Until tooling
  exists, the result must say `unmeasured`.
- **Standard anchor:** [Core Web Vitals](https://web.dev/articles/vitals) supplies
  the user-experience thresholds: LCP at or below 2.5 seconds, INP at or below
  200 milliseconds, and CLS at or below 0.1, assessed at the 75th percentile.
  These thresholds are vocabulary and budgets, not a current pass claim.

## Current measurement status

**Unmeasured.** Together has not selected an app-route performance instrument.
No current command or workflow measures Core Web Vitals for the real public,
authentication, member, creator, or account routes. No documentation website
exists, and a static documentation-site measurement would not be a substitute.

## Tool-performed checks

| Check | Evidence and limit |
| --- | --- |
| App-route Core Web Vitals collection | Not wired. Choose and version an instrument before reporting LCP, INP, CLS, or a pass/fail result. The instrument must cover Together application routes and authenticated states. |
| `pnpm run smoke`, unit tests, and visual workflows | Provide correctness and rendering evidence only. They collect no Core Web Vitals and must not be cited as performance measurements. |

## Manual checks

1. Keep the audit `unmeasured` until the owner selects a reproducible app-route
   instrument, environments, route/state matrix, device/network profiles, run
   count, aggregation rule, and artifact retention policy.
2. The initial matrix must include public offer and authentication, member
   learning and `/account`, creator panel and security settings, Polish and
   English, mobile and desktop, plus representative API and worker paths.
3. When measurements exist, distinguish lab results from field data and report
   each Core Web Vital separately. Do not infer INP from load-only tooling.
4. Investigate regressions with bundle, network, server, database, cache, and
   third-party-provider evidence. A threshold miss needs interpretation, not an
   automatically chosen fix.
5. Record cold-start behavior, seeded-data scale, authenticated setup, browsers,
   geographic coverage, external embeds, and missing field telemetry as blind
   spots.

## Finding criteria

- Once an owner-selected instrument and protocol exist, a reproducible metric
  misses the applicable existing budget or regresses under comparable
  conditions. Cite route/state, environment, instrument/version, samples,
  aggregation, and lab/field classification; investigate before proposing a fix.
- A performance claim is unsupported by the measured route/state or instrument,
  such as claiming field INP from a load-only lab run or substituting static-site
  or correctness evidence for application measurements.
- Missing measurement evidence is an instrumentation/readiness gap, not proof
  that a route is fast or slow. Keep the result `unmeasured` until the owner
  selects the required protocol; this spec creates no instrument or new gate.

## Known blind spots

- Even passing lab measurements do not establish field Core Web Vitals or user
  experience across devices, networks, regions, sessions, and data scales.
  Load-only tooling cannot establish INP.
- A route/state sample cannot prove unmeasured API/worker latency, cold starts,
  external-provider behavior, or every authenticated journey. Record those
  exclusions and missing field telemetry.
- Until instrumentation is selected, correctness and visual evidence cannot
  support any performance pass claim. This audit does not select new latency
  SLOs, budgets, release thresholds, or automated fixes.

