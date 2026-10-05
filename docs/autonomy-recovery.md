# Infrastructure incident and recovery

## Observations — 2026-10-04, America/Sao_Paulo

- Historical chat reports repeated write/PR safety refusals, but exposes no raw denial reason or request IDs. Do not attribute them to GitHub branch protection without evidence.
- Current GitHub repository metadata reports admin/maintain/push/pull. Those are repository/user capabilities, not proof of installation-token scopes or approval by the tool safety layer.
- Installation 165352772 selects all repositories. This audit does not expand its access.
- GET branches/main/protection through the integration returns HTTP 403, Resource not accessible by integration. This is an administrative-read limitation, not a demonstrated commit/PR refusal.
- GET rulesets returns []. Classic branch protection is still unverified.
- GET actions/permissions and actions/permissions/workflow are rejected by the connector endpoint allowlist (HTTP 400 INVALID_ARGUMENT), before an Actions setting can be read. Do not interpret that as disabled Actions or missing write permission.
- The cloud scheduler UI shows Auto Dev v2 (6ac2be3b9c6481918409e072acb5b523) paused; legacy paused; Fallback and Continuity Sync active. No matching local automation.toml was found.
- The v2 prompt already prohibits automation modification. The historical runner response says it stopped the runner after repeated refusals. This supports a workflow-level self-stop report; scheduler audit logs are unavailable, so infrastructure auto-disable is not proven.

## Safe runner contract

Development workers must have no scheduler-management responsibility. Never invoke automation update/pause/delete/create, emit scheduler mutation directives, or request a supervisor to do so. End a bounded execution with a status; never change the schedule. A blocked issue does not stop the runner.

Runner and fallback share the existing issue branch and PR as the work record. Fallback checks for recent primary activity before work; without reliable activity/lease evidence, it observes only. Never race two writers or create a second PR for the same issue. A stale lock is reported, never forcibly removed while ownership is uncertain.

On refusal, preserve the exact action, endpoint, error code/reason and head SHA without secrets. Do not retry the refused mutation through another tool, identity or credential. Continue independent offline work. Retry only after an observable authorization/policy change or explicit operator recovery. Suppress repeated unchanged notifications. Never wake one another in a loop.

Watchdog observes schedule state and stale progress; it notifies once on a meaningful transition and never enables/disables workers. Separating duties in prompts reduces accidental mutation, but is not a technical permission boundary. Permanent enforcement requires a scheduler-management capability denylist for worker runs, or a separately authorized supervisor with worker tools restricted. Such a denylist is not exposed by this session; do not claim enforcement is installed.

## Recovery procedure

1. Read CONTINUITY.md, this report, current issue acceptance and remote refs. Resume existing branch/PR; never force-push or reset prior work.
2. Distinguish platform approval denial, GitHub token 403, ruleset/check rejection, and transient network errors. A repository push=true flag does not settle this.
3. For a platform refusal, provide the exact denial to the platform administrator; request only the bounded repository write/PR operation. For an integration 403, review existing app installation permissions without creating a token or broadening repositories.
4. A repository administrator can inspect classic branch protection and Actions settings in the GitHub settings UI. Preserve all protections; minimum normal development access is Contents write and Pull requests write. Workflow-file changes additionally depend on the existing integration's workflow permission. Administrative read is for audit only, not a development prerequisite.
5. Run all offline checks; create/update PR; require successful CI for the current head and inspect mergeability/reviews. Merge with expected-head SHA only. A missing or pending check is not PASS.
6. Reactivation is a one-time operator repair after inspecting the stored prompt and resolving the actionable blocker. It is not a runner action and does not prove future schedules cannot be disabled.
7. #19 remains executable offline with injected verifier/session interfaces. #21 remains executable using injected persistence/readback and failure fixtures; any live integration must use the existing authorized path. Neither needs remote production promotion. #16 remains the business/security gate for that promotion. Infrastructure visibility/permission limitations are tracked separately rather than relabeling these safe tasks as production gates.

Rollback: revert this PR through the protected review/CI process. Normalizers are not wired into the live collector. Keep existing data, production runtime, thresholds, market scope and secrets unchanged.
