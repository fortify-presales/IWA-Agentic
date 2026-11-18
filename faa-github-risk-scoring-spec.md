# FAA GitHub Pull Request Risk-Scoring Specification

## 1. Purpose

This specification defines a repository implementation for selectively invoking Fortify Agentic Analyzer (FAA) from GitHub pull requests while retaining Fortify SAST and SCA as the continuous deterministic security baseline.

The design is intended for an environment in which GitHub Copilot usage is increasing significantly and a large proportion of application code may be AI-assisted or AI-generated. The objective is to apply FAA where deeper reasoning provides the greatest security value without incurring the cost and latency of agentic analysis on every commit.

## 2. Design principles

1. Fortify SAST and SCA remain continuous controls.
2. FAA is risk-triggered, not invoked solely because AI was used.
3. Authentication, authorization, secrets, trust boundaries, externally exposed APIs, and critical applications receive greater weight.
4. Repository/application metadata should be centrally governed where possible, with explicit mappings for GitHub metadata and FoD/SSC attributes.
5. Pull-request declarations supplement automated evidence but are not authoritative for application criticality.
6. Every FAA decision must be explainable and retained as audit evidence.
7. Mandatory triggers override the numerical score.
8. Initial deployment should use audit mode before release blocking is enabled.

## 3. Target repository structure

### Repository pilot scope (2026-11-17)

The approved first milestone uses one dependency-free Node.js ES module for both normalization
and scoring, with a JSON policy. This replaces the original PowerShell adapter/custom fcli
scoring-action proposal. fcli remains the planned FoD integration tool, not a scoring runtime.
See [the pilot specification](specs/020-faa-risk-pilot/spec.md) and
[implementation plan](specs/020-faa-risk-pilot/plan.md).

The initial workflow is read-only and audit-only: Actions summaries and artifacts, no PR comments
or production gates. Application classification is explicitly a pilot assumption.
A separate manually dispatched FAA 26.4.0 differential smoke workflow permits `main` and the
approved `feature/020-faa-risk-pilot` branch on the confirmed self-hosted runner labels.
Register a harmless dispatcher stub on `main`, then prove feature-branch execution before
merging the complete pilot. It has no full/incremental fallback or FoD integration.
`FAA_LICENSE_PLATFORM` selects FoD (default) or SSC for licensing only, explicitly mapping
existing Actions URL variables and credential secrets to the selected `FCLI_DEFAULT_*` names.
Actual remote execution must still be verified; FoD import and conditional PR scans remain deferred.
A risk decision must not be presented as a completed FAA scan. The remaining enterprise requirements describe
later milestones unless included in the scoped pilot specification.

```text
.github/
  PULL_REQUEST_TEMPLATE.md
  faa-policy.json
  workflows/
    faa-risk-assessment.yml
    faa-smoke-test.yml
  scripts/
    faa-risk-adapter.mjs
    faa-smoke-test.mjs
  tests/
    faa-risk-adapter.test.mjs
    faa-smoke-test.test.mjs
CODEOWNERS
security/
  faa-baseline.json        # optional local cache/reference
```

For an enterprise rollout, prefer a reusable workflow and centrally managed, trusted versions of the policy and Node adapter/scorer rather than copying the complete implementation into every repository. The structure above describes a possible source layout, not permission to execute PR-modified copies. CODEOWNERS and baseline state are later milestones.

## 4. Processing flow

```text
Developer + GitHub Copilot
        |
        v
Pull request
        |
        +--> Collect and normalize configured GitHub and FoD/SSC metadata
        +--> Parse PR security declarations
        +--> Calculate changed executable lines
        +--> Identify sensitive changed paths
        +--> Detect dependency-manifest changes
        +--> Inspect previous FAA baseline age
        +--> Consume SAST/SCA status when available
        |
        v
Risk score + mandatory-trigger evaluation
        |
        +--> Low risk: SAST/SCA only
        +--> Medium risk: FAA recommended
        +--> High risk or mandatory trigger: FAA required
        |
        v
Security checks / release policy
```

## 5. Risk decisions

Default thresholds:

| Score | Decision | Behaviour |
|---:|---|---|
| 0-4 | `sast-sca-only` | Normal deterministic controls |
| 5-8 | `faa-recommended` | Run FAA asynchronously; require completion before production unless policy-approved exception exists |
| 9+ | `faa-mandatory` | FAA required before production |
| Any mandatory trigger | `faa-mandatory` | Numerical score does not override mandatory policy |

These thresholds are starting values. Tune them after collecting 4-12 weeks of execution-cost, duration, false-positive, and net-new-finding data.

## 6. Risk scoring model

| Signal | Score |
|---|---:|
| Tier 1 / business-critical application | +5 |
| Internet-facing application | +4 |
| Restricted-data handling | +4 |
| Confidential-data handling | +2 |
| Authentication/authorization change | +5 |
| Secrets/token/credential/vault change | +5 |
| New or materially changed API | +4 |
| New integration/trust boundary | +4 |
| Security-sensitive business logic | +4 |
| Predominantly AI-generated change | +2 |
| Significantly AI-generated change | +1 |
| AI-generated code not manually reviewed | +3 |
| Large executable change | +2 |
| New/changed dependency manifest | +2 |
| High SAST finding explicitly suppressed | +4 |
| Previous security-incident area changed | +3 |
| FAA baseline older than permitted maximum | +3 |
| Recent successful FAA baseline, <= 30 days | -3 when no mandatory trigger exists |

Scores must never produce a final result below zero.

## 7. Mandatory FAA triggers

FAA must run regardless of score when any of the following is true:

1. Authentication or authorization implementation changes.
2. Secrets, credentials, tokens, or vault-access implementation changes.
3. A new internet-facing API is introduced or materially changed.
4. A critical/high security finding is being suppressed where central policy designates suppression as FAA-triggering.
5. Code associated with a previous security incident is changed.
6. A Tier 1 application reaches a material production release, if central release policy requires deep review.
7. A PR has the `faa-required` label. Any actor who can apply it may increase the risk; removing it must not override other mandatory triggers or prevent an independently required FAA run.

Mandatory triggers should be intentionally narrower than risk-scoring signals.

## 8. AI-specific policy

Do not trigger FAA merely because GitHub Copilot is present. If AI adoption reaches approximately 80%, such a rule would cause FAA to execute on nearly every change.

Instead, AI use raises risk when combined with:

- security-sensitive code;
- large changes;
- authentication/authorization;
- secrets or credential handling;
- APIs and connectors;
- new integrations/trust boundaries;
- missing human review;
- critical application classification.

Recommended PR declaration values:

- `none`
- `low`
- `significant`
- `predominant`

AI-use declarations are contextual evidence, not authoritative security controls.

## 9. Pull request template

Create `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
## Change summary

Describe the purpose and security impact of this change.

## AI assistance

- AI assistance used: <!-- none | low | significant | predominant -->
- AI tool: <!-- GitHub Copilot | other | none -->
- AI-generated code manually reviewed: <!-- yes | no | not-applicable -->

## Security impact

- Security-sensitive code generated or modified: <!-- yes | no -->
- Authentication or authorization changed: <!-- yes | no -->
- Secrets, tokens, credentials, or vault access changed: <!-- yes | no -->
- New or materially changed API: <!-- yes | no -->
- New integration or trust boundary: <!-- yes | no -->
- New dependency introduced: <!-- yes | no -->
- Internet-facing behaviour changed: <!-- yes | no -->
- Sensitive data processing changed: <!-- yes | no -->

## Application context

- Previous security incident area changed: <!-- yes | no -->
```

Application tier, exposure, and data classification should come from managed metadata instead of developer declarations. GitHub labels may add risk but must not lower it.

## 10. Repository policy file

The following YAML is the conceptual enterprise policy. The repository pilot uses
`.github/faa-policy.json` with the narrower schema documented in its runbook; its path patterns
are case-insensitive regular expressions, not the globs shown below.

```yaml
version: 1

application:
  # Example trusted static metadata; deployments may instead select the sources
  # and mappings described in section 30.
  tier: tier-2
  internet_facing: false
  data_classification: internal
  faa_baseline_max_age_days: 90

thresholds:
  recommended: 5
  mandatory: 9

change_size:
  high_risk_component_lines: 500
  general_component_lines: 1500

scores:
  tier-1: 5
  internet-facing: 4
  restricted-data: 4
  confidential-data: 2
  authentication-authorization: 5
  secrets-vault: 5
  new-api: 4
  external-integration: 4
  sensitive-business-logic: 4
  predominant-ai: 2
  significant-ai: 1
  unreviewed-ai: 3
  large-change: 2
  new-dependency: 2
  sast-high-suppressed: 4
  previous-incident-area: 3
  stale-faa-baseline: 3
  recent-faa-baseline: -3

high_risk_paths:
  authentication_authorization:
    - "**/auth/**"
    - "**/authentication/**"
    - "**/authorization/**"
    - "**/identity/**"
    - "**/permissions/**"
    - "**/roles/**"
    - "**/claims/**"
    - "**/*oauth*"
    - "**/*oidc*"
    - "**/*jwt*"

  secrets_vault:
    - "**/secrets/**"
    - "**/vault/**"
    - "**/*credential*"
    - "**/*token*"
    - "**/*keyvault*"
    - "**/*key-vault*"
    - "**/*secret*"

  api:
    - "**/api/**"
    - "**/controllers/**"
    - "**/routes/**"
    - "**/endpoints/**"
    - "**/openapi*.yml"
    - "**/openapi*.yaml"
    - "**/swagger*.json"
    - "**/custom-connectors/**"

  infrastructure:
    - "**/*.tf"
    - "**/*.bicep"
    - "**/Dockerfile"
    - "**/kubernetes/**"
    - "**/helm/**"
    - "**/.github/workflows/**"

dependency_files:
  - "**/package.json"
  - "**/package-lock.json"
  - "**/pom.xml"
  - "**/build.gradle"
  - "**/build.gradle.kts"
  - "**/*.csproj"
  - "**/packages.lock.json"
  - "**/requirements.txt"
  - "**/poetry.lock"
  - "**/Pipfile.lock"
  - "**/go.mod"
  - "**/go.sum"
```

## 11. Risk-scoring implementation requirements

Create a single cross-platform Node.js ES module, `.github/scripts/faa-risk-adapter.mjs`.
Use built-in Node APIs without adding package dependencies. The module owns normalization,
scoring, mandatory triggers, audit output, and output validation; do not duplicate scoring in
workflow expressions or shell scripts.

The adapter must:

1. Read the GitHub pull-request event from `GITHUB_EVENT_PATH` as data.
2. Obtain the trusted policy and identify the PR base and head SHA.
3. Use Git to collect changed paths and changed-line counts from `git diff --numstat`, including appropriate handling of renames, deletions, binary files, and unusual path characters.
4. Parse the relevant PR-template fields and normalize the change evidence and required metadata for the action.
5. Collect configured GitHub labels, repository topics, and applicable release-tag evidence; pass them as data.
6. Invoke the trusted scoring function and validate its result.
7. Publish the result's score, mandatory flag, and decision as GitHub Actions outputs; fail if the action or output validation fails.

The scoring implementation must:

1. Resolve configured metadata sources and evaluate the trusted policy and normalized input, including sensitive paths and dependency manifests. Later milestones may retrieve FoD application or SSC application-version attributes through fcli and the date of the most recent successful FAA execution. The initial pilot uses protected static metadata and records unavailable integrations as not evaluated.
2. Apply score components and mandatory-trigger rules and produce the decision.
3. Write structured JSON audit evidence containing the policy version, SHAs, reasons, supporting paths, and metadata provenance and conflicts as described in section 30.
4. Fail deterministically for invalid policy or unavailable required metadata rather than producing a success-shaped default.

Keep scoring and mandatory-trigger logic in this single Node module. Use Node.js 20+ and Git
on Windows, Linux, and macOS. fcli is required only for subsequent Fortify integration.
The fcli 3.30.0 capability probe did not establish a documented JSON-file input helper;
array options split on commas. The approved Node implementation avoids an encoded-path
interface and retains arbitrary filenames as data.

Required outputs:

```text
score
mandatory
decision
```

Permitted decisions:

```text
sast-sca-only
faa-recommended
faa-mandatory
```

## 12. Audit JSON structure

The implementation should write `faa-risk-result.json`:

```json
{
  "policyVersion": "1",
  "repository": "example/application",
  "pullRequest": 1234,
  "baseSha": "...",
  "headSha": "...",
  "score": 11,
  "mandatory": true,
  "decision": "faa-mandatory",
  "changedLines": 827,
  "reasons": [
    {
      "reason": "Authentication or authorization changed",
      "points": 5,
      "mandatory": true,
      "evidence": ["src/auth/TokenValidator.cs"]
    }
  ]
}
```

The evidence field is important. Reviewers should be able to see why a signal fired rather than trusting an opaque score.

The audit result must also record the normalized metadata values and, for each one, its source, source object identifier, source field or label, and retrieval time. Record observed conflicts, missing or rejected values, and any trusted fallback used. Keep this evidence to the minimum needed for audit and apply the organization's retention and access controls.

## 13. Change-size calculation

Exclude non-executable assets from the executable-line count where reasonable, for example:

- Markdown;
- images;
- PDFs;
- generated binary artifacts;
- documentation-only text.

Do not blindly exclude lock files from risk analysis. They may be excluded from executable line count but still used as dependency-change signals.

Suggested thresholds:

- 500 changed executable lines for security-sensitive/high-risk components.
- 1,500 changed executable lines elsewhere.

Tune based on actual repository size and PR behaviour.

## 14. Detection precedence

Automated evidence should take precedence over developer declarations when there is a conflict.

Example:

- Developer declares `Authentication or authorization changed: no`.
- PR modifies `src/auth/AuthorizationHandler.cs`.
- The automated rule must still raise the authentication/authorization signal.

The conflicting declaration may optionally create a separate governance signal for later review.

## 15. Dependency logic

The first implementation can trigger `new-dependency` when supported dependency manifests or lock files change.

The production implementation should subsequently distinguish:

- new dependency;
- version upgrade;
- version downgrade;
- dependency removal;
- lock-file churn without semantic dependency change.

Prefer ecosystem-aware parsers for npm, Maven/Gradle, NuGet, Python, and Go where these ecosystems are materially used.

## 16. GitHub Actions workflow

Create `.github/workflows/application-security.yml`.

Logical jobs:

```text
faa-risk-assessment --> fortify-agentic-analyzer (conditional)
        |                           |
        +----------+----------------+
                   |
fortify-sast-sca --+--> release-security-gate
   (independent)
```

### Job: `faa-risk-assessment`

Responsibilities:

- use the trusted workflow, adapter, action, and policy, not executable copies supplied by the PR;
- checkout PR source as data with sufficient base/head history for the diff;
- provision and verify Node.js 20+ and Git;
- execute the trusted Node adapter/scorer;
- post/update the PR risk summary through an appropriately permissioned trusted reporting step;
- upload risk JSON and expose score/decision outputs.

### Job: `fortify-sast-sca`

Responsibilities:

- run standard deterministic Fortify controls;
- operate for all relevant PRs regardless of FAA score;
- make results available to later policy stages.

### Job: `fortify-agentic-analyzer`

Condition:

```text
faa-recommended OR faa-mandatory
```

Responsibilities:

- execute the approved FAA runner;
- preserve analyzer output;
- correlate the result with commit SHA and risk decision;
- return blocking status for mandatory executions according to policy.

## 17. Recommended workflow skeleton

The following is a logical skeleton, not a deployable workflow; replace each step with the approved integration rather than allowing placeholder commands to report successful scans.

```text
pull request event (including labeled and unlabeled events)
  |
  +--> faa-risk-assessment, for non-draft PRs
  |      load trusted workflow, Node adapter/scorer, and JSON policy
  |      fetch base/head Git history; treat PR contents as data
  |      run adapter using node
  |      upload faa-risk-result.json and expose score/mandatory/decision
  |      report the decision through a trusted, permissioned step
  |
  +--> fortify-sast-sca, independent of risk-assessment success
  |      invoke approved deterministic controls
  |
  +--> fortify-agentic-analyzer
  |      run approved FAA integration when decision is recommended or mandatory
  |
  +--> release-security-gate
         evaluate all outcomes, including failures, skipped jobs, and exceptions
```

The risk step runs the trusted Node adapter, which contains the scoring implementation.
For later FAA execution and FoD import, provision approved FAA/fcli versions using the
organization's installation process and configure non-interactive authentication.
Pin workflow dependencies to immutable commit SHAs where required by enterprise supply-chain policy.

Do not interpolate PR-controlled values into shell source. Handle PR body, paths, and other metadata strictly as data. Separate read-only assessment from write-permission reporting where necessary, especially for forks; never execute PR-supplied code with privileged credentials. If a risk assessment fails, SAST/SCA must still run, and the release gate must not interpret the missing decision as low risk.

If Git tags are used as release evidence, add an appropriate protected release or tag event separately; a pull-request event does not reliably establish the eventual production tag. Bind release decisions to the tagged commit and apply the same trusted-control and release-gate requirements.

## 18. Runtime requirements

- Node.js 20+ and Git on every assessment runner.
- The trusted Node module must work on Windows, Linux, and macOS without PowerShell, Python, or fcli for scoring.
- No separate Bash or PowerShell scoring adapter is required.
- A later live-analysis runner additionally requires approved FAA/fcli installation, service/license configuration, network access, and FoD authentication.
- Pin and periodically update runtime versions and workflow dependencies through the approved dependency-management process.

## 19. CODEOWNERS integration

Example:

```text
# Security-sensitive components
/src/auth/                 @shell-appsec
/src/identity/             @shell-appsec
/src/secrets/              @shell-appsec
/src/vault/                @shell-appsec
/custom-connectors/        @shell-appsec
/openapi/                  @shell-appsec
/.github/workflows/        @platform-security
/.github/faa-policy.json                    @platform-security @shell-appsec
/.github/scripts/faa-risk-adapter.mjs        @platform-security @shell-appsec
/.github/tests/faa-risk-adapter.test.mjs     @platform-security @shell-appsec
```

Replace teams with actual GitHub organization teams.

Protect the policy, workflow, adapter, and action so normal contributors cannot weaken the control without designated approval.

## 20. Branch protection

For protected production branches such as `main`, require:

- standard build/test checks;
- Fortify SAST/SCA check;
- FAA risk assessment;
- FAA execution check when mandatory;
- appropriate CODEOWNERS review;
- no unresolved blocking security findings.

Avoid requiring the FAA execution check unconditionally if the job is skipped for low-risk changes. Use a release/security gate that understands `sast-sca-only` as a valid outcome.

## 21. FAA baseline state

Avoid relying indefinitely on a manually maintained GitHub variable.

Preferred approaches, in order:

1. query the centralized Fortify/FAA system of record for the most recent successful analysis of the application/version;
2. use an enterprise security metadata service;
3. maintain a signed repository/environment state value updated after successful FAA execution;
4. use `LAST_SUCCESSFUL_FAA_DATE` as an initial implementation only.

The baseline must be associated with the correct repository/application and ideally a commit SHA.

## 22. FAA invocation strategy

Where supported, prefer change-focused analysis for pull requests and deeper/full analysis at major release boundaries.

Recommended model:

| Event | SAST/SCA | FAA |
|---|---|---|
| Commit | Yes | No |
| Pull request | Yes | Risk-triggered |
| Main merge | Yes | Risk-triggered |
| Tier 1 release | Yes | Mandatory/material-release policy |
| Auth/authz change | Yes | Mandatory |
| Secrets/vault change | Yes | Mandatory |
| Major internet-facing API change | Yes | Mandatory |
| Periodic Tier 1 review | Yes | Full FAA review |

## 23. Finding policy

Suggested initial release behaviour:

| Finding | Recommended action |
|---|---|
| Validated critical FAA finding | Block production |
| High-confidence high finding involving auth/secrets/material data exposure | Block or require AppSec-approved exception |
| Other high finding | AppSec triage required before production |
| Medium | Track with named owner and remediation SLA |
| Low/uncertain | Record and triage without automatic blocking |

Because agentic analysis is probabilistic, do not gate purely on an unreviewed numerical severity. The policy should consider evidence, exploitability, affected trust boundary, and confidence.

## 24. Exceptions

Provide a formal exception process rather than allowing workflow bypass.

Minimum exception record:

- repository;
- PR and commit SHA;
- risk score;
- mandatory triggers;
- reason for exception;
- accepting security owner;
- expiry date;
- compensating controls;
- remediation issue/reference.

Exceptions must be time-limited.

## 25. Fail-open / fail-closed behaviour

Recommended:

### Tier 1 / mandatory FAA

If FAA cannot run because of service, LLM, connectivity, or analyzer failure:

- fail closed by default;
- require documented AppSec exception to proceed.

### Tier 2/3 recommended FAA

If FAA is recommended but unavailable:

- allow policy to fail open only if deterministic controls are successful;
- create an auditable follow-up assessment requirement.

Do not silently skip FAA after a mandatory trigger.

## 26. PR comment/report

Post one updateable bot comment per PR containing:

```text
Fortify Agentic Analyzer risk assessment

Score: 11
Decision: faa-mandatory
Executable lines changed: 827

Risk signal                                      Points  Mandatory
Authentication or authorization changed          +5      Yes
Predominantly AI-generated change                +2      No
Large executable change                          +2      No
New dependency                                   +2      No

FAA analysis is required before production release.
```

Include evidence paths where feasible.

Update the existing comment after each synchronization rather than generating a new comment for every commit.

## 27. Security of the scoring mechanism

Treat the risk scorer itself as a security control.

Required protections:

- CODEOWNERS approval for policy, workflow, and Node adapter/scorer changes;
- protected branches;
- immutable workflow dependencies where organizational policy requires them;
- approved, pinned fcli and other workflow dependencies;
- no arbitrary execution of text supplied in PR bodies;
- least-privilege GitHub Actions permissions;
- no long-lived credentials in repository secrets when OIDC/federated identity is available;
- retain policy version with each decision;
- prevent fork PRs from gaining privileged credentials.

## 28. Threat model for the pipeline

The implementation must account for:

1. Developer marks AI usage as `none` even though Copilot was heavily used.
   - Mitigation: AI declaration adds context but mandatory decisions depend on code/path/application evidence.

2. Developer sets security-impact fields to `no`.
   - Mitigation: path matching and application metadata override declarations.

3. Sensitive code is renamed to avoid expected directories.
   - Mitigation: periodically tune patterns; combine declarations, CODEOWNERS, SAST metadata, and architectural catalogue information.

4. Large generated files distort line counts.
   - Mitigation: exclude known generated code or score it separately while retaining security scanning.

5. Every dependency lock update produces FAA runs.
   - Mitigation: evolve from file-change detection to semantic dependency diffs.

6. Policy is weakened in the PR being assessed.
   - Mitigation: fetch the policy, workflow, adapter, and action from a trusted central or protected base-branch revision rather than trusting PR-modified copies.

7. A label, topic, tag, or Fortify attribute is manipulated to lower risk.
   - Mitigation: restrict authoritative sources and mappings, allow untrusted signals only to increase risk, protect release tags, and record provenance and conflicts.

For enforcement, the scoring workflow must execute trusted control code and evaluate a trusted policy from a protected revision or central repository.

## 29. Centralized enterprise model

For many repositories, implement:

### Central repository

Example conceptual structure:

```text
security-engineering/appsec-workflows
  workflows/
    appsec-pr.yml
  policies/
    faa-default.yml
    tier1.yml
  scripts/
    faa-risk-adapter.mjs
```

### Application repository

```text
.github/workflows/application-security.yml
security-metadata.yml
```

The local workflow calls the reusable central workflow. This gives AppSec one place to update scoring rules, Fortify integration, and FAA invocation.

## 30. Application metadata

Recommended centrally governed schema:

```yaml
application_id: APPI-EXAMPLE-001
name: Example Integration Service
tier: tier-1
internet_facing: true
data_classification: restricted
business_owner: integration-platform
security_owner: appsec
technology:
  - dotnet
  - typescript
capabilities:
  authentication: true
  secrets: true
  external_api: true
  key_vault: true
faa:
  max_baseline_age_days: 30
```

Avoid depending on repository naming conventions for criticality.

### Supported metadata sources

The trusted central policy selects sources, repository-to-Fortify mappings, accepted fields and values, and per-field authority. A deployment may use any supported source independently; FoD and SSC are alternatives or complementary sources, not both mandatory. The schema above is the normalized result, not a requirement to create a repository file.

| Source | Scope and examples | Retrieval and interpretation |
|---|---|---|
| FoD | Application-level `businessCriticalityType` and tenant-defined application attributes, such as exposure or classification | A future trusted metadata adapter can use `fcli fod app get <appNameOrId> -o json`; attributes and allowed values are tenant-specific. Map FoD criticality explicitly to tiers rather than assuming `High` always means `tier-1`. |
| SSC | Application-version attributes, such as `BusinessRisk`, `InfoClassification`, and tenant-defined fields | A future trusted metadata adapter can use `fcli ssc attr list --av=<appVersionNameOrId> -o json`. Resolve the correct version explicitly; attribute definitions, value formats, and allowed values depend on SSC configuration. SSC issue custom tags are not application-version attributes. |
| GitHub PR labels | PR-scoped signals such as `faa-required` | Collect the current labels from the PR event or GitHub API. A policy allowlist maps recognized labels to signals; labels can increase risk or trigger FAA, but cannot lower risk or bypass a trigger. |
| GitHub repository topics | Repository-scoped tags/topics such as `internet-facing` | Collect topics via GitHub metadata and map only recognized values. Treat topics as authoritative only when the organization controls their modification and the trusted policy explicitly designates them as a source; otherwise they can only add risk. |
| Git tags | Release-scoped tags such as `v1.2.3` | Optional, disabled unless configured. Use only a verified tag for the actual release commit and a policy-approved protected or signed-tag process. A name pattern alone does not establish a material production release or application criticality. |
| Protected central policy or service catalogue | Static metadata, source mappings, and approved defaults | Use a protected revision or authenticated, authorized service. Never use a PR-modified file as the authority for its own assessment. |

For GitHub and Fortify, use read-only, least-privilege access. The workflow must not expose Fortify credentials to PR-controlled code, including on fork PRs. If the required metadata cannot be obtained safely in an unprivileged PR run, use a separate trusted metadata/assessment job or service; otherwise fail the assessment explicitly rather than weakening the control. Do not equate the date of a normal FoD or SSC scan with a successful FAA baseline.

### Mapping, trust, and conflicts

1. A protected configuration must identify each repository using its stable GitHub repository identity. If FoD or SSC is configured, map it to the correct FoD application ID and/or SSC application-version ID. Missing, ambiguous, or mismatched required mappings fail assessment; do not infer identity solely from names. Configure how branch or release context selects an SSC version.
2. For each normalized field, configure its authoritative source, exact attribute/topic mapping, recognized values, freshness requirements where applicable, and any explicitly approved trusted fallback. Reject malformed, unknown, ambiguous, or stale required values. An unavailable source is not equivalent to a low-risk value.
3. When multiple trusted sources supply a field, use the per-field precedence configured in protected policy and record disagreements. If no precedence or safe conflict rule is configured, fail assessment rather than silently selecting the least risky value. Lower-trust labels or topics can only add risk or mandatory triggers; they cannot replace authoritative metadata with a lower-risk value.
4. Normalize case and whitespace according to the configured mapping, validate types and value domains, and count each logical scoring signal only once even when several sources support it. Record every supporting source and any conflict in the audit result.
5. Reassess on PR label addition and removal, as well as the normal PR updates. An unrecognized label is ignored as a scoring signal but may be recorded for audit. Removing a label does not override other evidence; restrict label and release-tag management according to organizational policy.

For example, one deployment might explicitly map FoD `businessCriticalityType: High` to `tier-1`, an SSC `InfoClassification` value to `restricted`, and the PR label `faa-required` to the mandatory trigger. These are configuration examples, not universal FoD/SSC mappings. A repository topic such as `internet-facing` can add the exposure signal, while a Git release tag is considered only in the configured release workflow.

## 31. Observability and metrics

This is CI/CD and governance telemetry, not runtime application monitoring. Do not add these metrics or dashboards to the application being assessed. The initial implementation does not require a separate web application or service: the trusted reusable workflow should emit a structured assessment record and a concise GitHub Actions summary, and retain the record as an artifact under the organization's access and retention policy.

Use the existing `faa-risk-result.json` as the assessment record. Correlate it with FAA execution and outcome data using a stable assessment identifier, such as the repository identity, pull-request number, head SHA, and workflow run ID. Record FAA execution and finding-validation outcomes in the same record or in linked records; do not treat a risk decision as proof that FAA ran or succeeded.

During the pilot, workflow artifacts and summaries are sufficient. When cross-repository reporting is needed, publish records from the trusted workflow to an approved, access-controlled central analytics or telemetry platform and build dashboards there. Prefer an existing enterprise platform; create a dedicated central service only if existing platforms cannot meet reporting, retention, or access-control requirements. Never send credentials to PR-controlled code or expose audit records publicly.

Capture at least:

- number of PRs evaluated;
- risk-score distribution;
- FAA recommended count;
- FAA mandatory count;
- actual FAA executions;
- average FAA duration;
- LLM/token or attributable execution cost where measurable;
- FAA failure rate;
- net-new FAA findings;
- validated FAA findings;
- findings already detected by SAST;
- false-positive/non-actionable rate;
- finding categories;
- time to remediation;
- exceptions;
- escaped issues later found by DAST, penetration testing, or production incident detection.

The most useful KPI is not "number of FAA runs." It is the rate and severity of validated, net-new vulnerabilities found by FAA relative to cost and latency.

## 32. Rollout plan

### Phase 1: engineering implementation, week 1-2

- Create central policy.
- Implement risk scorer.
- Add PR template.
- Add sensitive path mappings.
- Integrate existing SAST/SCA workflow.
- Emit report only.

### Phase 2: audit mode, week 3-6

Run on 5-10 representative applications including:

- heavily Copilot-assisted application;
- internet-facing API;
- custom connector/backend;
- Key Vault integration;
- application containing substantial OSS dependencies;
- a previously vulnerable component if available and permitted.

Do not block merges yet.

### Phase 3: mandatory high-risk triggers, week 7-10

Enable release blocking for:

- auth/authz changes;
- secrets/vault changes;
- new internet-facing APIs;
- selected Tier 1 production releases;
- previous-incident areas.

### Phase 4: optimization, week 11-12

Review:

- cost per valid net-new finding;
- execution time;
- number of triggered analyses;
- false-positive/non-actionable rate;
- developer delay;
- overlap with conventional SAST.

Adjust thresholds and mandatory triggers accordingly.

## 33. Test plan

Create automated tests for the scorer.

Run shared input/output fixtures against the Node scorer/adapter on Windows, Linux, and macOS.
Cover invalid policy or missing metadata, Git failures, binary and renamed files, unusual path
characters, and GitHub output validation. Verify that PR-supplied changes to the module or policy
cannot influence the trusted assessment. Test fcli failures when live Fortify integration is added.

Minimum scenarios:

| Test | Expected outcome |
|---|---|
| Documentation-only PR | SAST/SCA only |
| Small normal code change | SAST/SCA only |
| Predominant Copilot, small normal code change | Typically below mandatory threshold |
| Predominant Copilot + 2,000 changed executable lines | FAA recommended/mandatory depending on app metadata |
| Auth path changed | FAA mandatory |
| Key Vault code changed | FAA mandatory |
| New API in internet-facing repository | FAA mandatory |
| Dependency-only update | Score increase but not necessarily mandatory |
| Tier 1 + material large change | FAA mandatory/release policy |
| Recent FAA baseline + low-risk change | Score reduced where allowed |
| Recent baseline + auth change | Still FAA mandatory |
| Developer declares no auth change but auth path changes | FAA mandatory |
| Policy or scorer modified by PR | Trusted policy, action, and adapter still evaluate change |
| Mapped FoD application attributes | Normalized values and FoD provenance appear in audit evidence |
| Mapped SSC version attributes | Correct version supplies normalized values and SSC provenance |
| Conflicting trusted attributes | Configured precedence is applied and conflict recorded; absent a rule, assessment fails |
| Missing, stale, unrecognized, or inaccessible required metadata | Assessment fails explicitly, without silently selecting low risk |
| `faa-required` label added or removed | Reassess; label forces FAA while present, and removal cannot override other triggers |
| Lower-trust label or topic claims low risk | It cannot reduce authoritative risk or bypass a mandatory trigger |
| Mapped GitHub topic or protected release tag | Only configured, applicable evidence affects scoring or release policy and is recorded |
| Fork PR without safe Fortify access | Trusted assessment path is used or assessment fails explicitly; no credentials reach PR-controlled code |

## 34. Acceptance criteria

Implementation is complete when:

- every non-draft PR receives a deterministic risk decision;
- the decision contains explainable evidence;
- configured GitHub and FoD/SSC metadata is mapped with provenance and deterministic conflict handling;
- normal SAST/SCA runs independent of FAA selection;
- mandatory triggers reliably invoke FAA;
- low-risk PRs do not invoke FAA;
- the PR receives a single updated risk report;
- audit JSON is retained;
- each assessment and any FAA execution/outcome record can be correlated across workflow runs using stable identifiers;
- pilot telemetry can be collected without a separate application, and organization-wide metrics can be exported to an approved central platform when required;
- policy/scorer changes require security ownership approval;
- failed mandatory FAA executions cannot silently permit production promotion;
- metrics are available for cost and effectiveness tuning.

## 35. Definition of done for initial pilot

The pilot should demonstrate all of the following:

1. GitHub Copilot-heavy development does not automatically create excessive FAA executions.
2. Changes to authentication, authorization, secrets, external APIs, and critical integrations consistently trigger deep analysis.
3. The security team can explain exactly why each FAA run happened.
4. FAA results can be compared with normal SAST/SCA results to identify genuine net-new value.
5. Cost and latency can be measured per triggered analysis.
6. Thresholds can be centrally adjusted without modifying application source code.
7. Application teams receive immediate PR feedback rather than discovering policy requirements only at production release.

## 36. Recommended initial policy

For an organization rapidly increasing GitHub Copilot-generated code, begin with:

```text
SAST/SCA:                       every relevant PR/build
FAA on AI-generated code:      risk-based, not automatic
FAA for auth/authz:             mandatory
FAA for secrets/vault:          mandatory
FAA for new internet API:       mandatory
FAA for new trust boundary:     strongly weighted
FAA for Tier 1 release:         mandatory for material releases
FAA periodic Tier 1 baseline:   every 30-90 days depending on criticality
General FAA threshold:          >= 9 mandatory
Advisory FAA threshold:         >= 5 recommended
High-risk change threshold:     500 executable lines
General large-change threshold: 1,500 executable lines
```

After the first 90 days, tune those values using actual FAA finding yield, runtime, and LLM cost rather than theoretical risk alone.

## 37. Future enhancements

Potential second-phase improvements:

- semantic dependency-diff analysis;
- GitHub repository custom properties for application tier and classification;
- integration with an application/service catalogue;
- direct ingestion of Fortify SAST results into risk scoring;
- automatic detection of finding suppressions;
- central FAA baseline lookup;
- change ownership by service/component;
- OpenAPI semantic diffing;
- authorization-policy diffing;
- Infrastructure-as-Code-specific risk signals;
- historical incident mapping;
- risk-calibrated FAA model selection;
- cost budgets by application tier;
- organization-level dashboards for FAA effectiveness.

## 38. Final implementation principle

The repository control should answer three questions for every pull request:

1. **What changed?**
2. **Why is that change security-sensitive?**
3. **Does this change require deterministic scanning only, or does it justify deeper agentic reasoning?**

The purpose is not to run FAA as often as possible. The purpose is to consistently invoke FAA where the combination of application criticality, AI-generated implementation, security-sensitive logic, trust boundaries, and change magnitude makes deeper reasoning valuable.
