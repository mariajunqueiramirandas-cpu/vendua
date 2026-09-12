# ADR 0008: Three-axis versioning; majors require codemods

- Status: Proposed
- Date: 2026-09-11

## Context

The fleet runs a matrix of Core API versions × Kernel versions × Contract
declarations. We need a versioning policy that lets the platform move fast
weekly while making "a storefront untouched for a year still works" an
engineered invariant rather than a hope.

## Decision

Three independent version axes:

- **Core API**: integer majors per surface (`/storefront/v1`); additive-only
  within a major; N and N−1 supported ≥12 months; sunset by fleet census, not
  date.
- **Kernel**: semver; within a Contract major all changes are
  additive/compatible — zero storefront code changes on rebuild.
- **Contract**: single integer in `vendua.config.ts`; majors ≤1/year and **only
  ship with a codemod + conformance coverage + dual-support window**.

The compat matrix (Contract × Kernel range × API majors) lives in the Control
Plane and gates builds/deploys. The guarantee is tested by a permanent
stale-storefront CI job ([11](../architecture/11-backward-compatibility.md#the-staleness-guarantee--tested-not-asserted)).

## Consequences

### Positive

- Weekly platform velocity (additive API, Kernel minors) with rare, mechanical
  breaking changes (Contract majors).
- "No breaking change without a codemod" converts migration cost into
  engineering cost paid once, centrally — instead of N agent tasks.
- Fleet census sunsetting means we never strand a store on an API that died —
  and we know exactly what old versions still cost us.

### Negative / costs

- Real ongoing discipline: additive-only API design is sometimes awkward
  (weird field names accrete); majors periodically needed to clean up.
- Kernel must carry alias/compat shims for one major — bounded cruft,
  deliberately.
- Maintaining the stale-storefront CI job is nonzero work — it is also the
  only thing that makes the compatibility claim true.

## Alternatives considered

- **Single version number for everything**: forces frozen APIs or constant
  breakage; rejected.
- **"Agents migrate stores on breaking changes"**: converts every breaking
  change into an unbounded agent bill with nondeterministic outcomes; agents
  are for the failure tail, not the mechanism.

## Links

- [architecture/11-backward-compatibility](../architecture/11-backward-compatibility.md)
- [architecture/09-migrations-and-fleet-trains](../architecture/09-migrations-and-fleet-trains.md)
