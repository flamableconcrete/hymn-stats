# Hymn Stats

A mobile hymn log and public history explorer. Record all meeting types, revise observations later, sample tempo without switching apps, and browse what was sung across recorded meetings.

The site runs on GitHub Pages with Firebase Authentication and Firestore on Spark. Public viewers read an explicit static export, not the private database. Keep paid billing disabled.

The active project is `flamableconcrete-hymn-stats`, with Standard Firestore in `us-central1`, Google sign-in, and the owner account registered as admin. Billing is disabled. The initial live import contains 654 reports: 653 finished records and one incomplete draft. The private automation repository is `flamableconcrete/hymn-stats-automation`. Spreadsheet automation and public rebuilding remain disabled until the specific spreadsheet sharing and GitHub publishing credentials are configured.

## Run locally

Use Node 24 LTS (the CI target):

```sh
npm ci
node scripts/build-config.js
npm run dev -- --port 4178
```

Without Firebase configuration, the site clearly identifies itself as a local workspace. Meetings save in IndexedDB on the current browser/device. Sign-in, cloud synchronization, and publication require the setup below. The initial public history is a sanitized, read-only snapshot; it is not a live spreadsheet connection.

```sh
npm test
npm run build
npm run preview -- --port 4178
```

The production service worker caches the application shell, catalog, and public history. Offline reload requires an initial online visit and a completed service-worker installation. Browser storage should remain enabled; download a record if a device reports that local saving failed.

## Connect Firebase without paid billing

1. Create or select a Firebase project on **Spark**. Do not link a billing account. Create a default Firestore database in production mode.
2. Register a web app. Copy `public/config.example.json` to ignored `public/config.json` and fill its public Firebase web configuration. API keys in this web configuration identify the project; access is enforced by the Firestore rules.
3. Enable Google sign-in in Firebase Authentication. Add the deployed hostname (for example `flamableconcrete.github.io`) and `localhost` to authorized domains as appropriate. A localhost preview cannot test an unrelated deployment's OAuth domain configuration.
4. Deploy the rules: `npx firebase login`, then `npx firebase deploy --only firestore --project YOUR_PROJECT_ID`.
5. Sign into the website once. Until invited, the account cannot access cloud records. With trusted Application Default Credentials configured, set `FIREBASE_PROJECT_ID` and run `node scripts/bootstrap-admin.js --email YOUR_GOOGLE_EMAIL`. Refresh/sign in again. The command prints the owner UID needed for history imports.
6. Configure GitHub sign-in for the rebuild button: create a GitHub OAuth app, use Firebase's displayed `__/auth/handler` callback, and store its client ID/secret in Firebase's GitHub provider settings. The site links this provider to the existing Google user rather than replacing their account.
7. Put the complete **public** configuration JSON in the public repository's `PUBLIC_APP_CONFIG` Actions variable. Include the private automation repository's owner, name, workflow filename, and default branch. Never put service-account keys, OAuth client secrets, or personal access tokens in this variable or the public site.

The rebuild button asks GitHub for `repo` access, which is broader than a single workflow. Only site admins see the button, and GitHub independently enforces the account's repository access. The personal token stays in memory, is cleared on sign-out/page exit, and may require reauthorization. The workflow link is always available as a fallback. A dispatched run is shown as requested/running, not completed until the workflow succeeds.

Set `github.rebuildEnabled` to `false` in both repositories' public configuration while the publishing token or GitHub provider is missing. Set it to `true` only after a manual workflow has successfully deployed Pages and Firebase's GitHub provider is enabled. The button remains disabled during setup, while the workflow link remains available.

## Data and privacy

- `observations`: contributor-owned meeting reports and ordered musical items. Drafts remain private to their author/admins. Invited contributors can inspect published reports to join an existing event.
- `privateObservations`: musician names, private notes, and original source rows. Authors/admins only.
- `events`: one actual meeting, with a selected report supplying its public hymn list. Additional reports remain distinct; an admin can select the preferred report.
- `history/{report}/entries`: immutable, audited before/after records including private changes. Record mutations and audit entries commit atomically. Stale versions are rejected.
- `members` and `invitations`: verified-account allowlist and admin roles; revoked accounts lose backend access.
- `imports` and `importIssues`: private migration baselines and correction/deletion review.

Public export uses a field allowlist. It excludes identities, musician names, notes, raw source rows, revision history, and individual tap samples. Imported free-text titles require review before their original text is published, because performer credits sometimes appear inside song fields. Admins can supply a clean public title in the editor.

Standing is a single optional observation meaning **stood for the congregational hymn**. It is not a generic field on all musical items. Sacrament readiness is separate. Missing, no, and not applicable remain distinct.

A medley is one special musical number. Separate comma-listed selections in an old program are imported as separate musical items, with the original row preserved. Only performed/partially performed music enters statistics. The default is congregational singing. Frequency counts distinct meetings containing a song; separate performances are also counted. All language describes recorded observations, not a census of congregational activity.

Tempo segments receive equal weight within one observer's reading; observers receive equal weight for a performance. Compatible beat units are converted before combining readings. Ambiguous/unknown historical units remain explicitly unknown and are not silently compared. Imported hymn 13 and 52 reference multiple units and need review. The catalog identifies songs by collection and number; children's 37 is different from hymnbook 37.

## Repeatable spreadsheet migration

The default mapping supports `Sacrament Meeting` and `Other Meetings`. The new recording workflow supports Primary immediately, but the old Primary form's response history has not been located or its field layout verified. Inventory that source before claiming complete migration parity; configure a separate mapping only after its actual headers are known.

For trusted CLI/automation access, set `GOOGLE_APPLICATION_CREDENTIALS` to an ignored credential file or use Workload Identity Federation. The identity needs Firestore data access, and editor access to the specific source workbook to assign IDs. Never commit credentials. Set:

```text
FIREBASE_PROJECT_ID=your-project
SOURCE_SPREADSHEET_ID=your-source-workbook-id
IMPORT_OWNER_UID=your-admin-firebase-uid
```

Preview without writes:

```sh
npm run import:sheets -- --out var/import-report.json
```

Apply after inspecting the report:

```sh
npm run import:sheets -- --apply
```

For local setup, `FIREBASE_USE_CLI_LOGIN=1` lets cloud administration scripts use the existing Firebase CLI login, without copying its refresh credential. This opt-in path depends on the pinned `firebase-tools` package. Leave it unset in Actions, which uses Workload Identity Federation. A private source snapshot can be applied with `--input var/source.json --apply` only after every source row already contains its stable ID; it never writes IDs back from a snapshot. Set the same `SOURCE_SPREADSHEET_ID` used for live imports so baseline identities match.

The importer appends `Hymn Stats ID` **after the widest populated source row**, including unheaded groups. It validates source IDs before cloud writes. IDs survive sorting and corrections. Repeated unchanged imports produce no new reports or revisions. Source edits merge against the last imported baseline; conflicting website edits are retained for admin review. Disappearing rows raise an issue rather than deleting history. Admins resolve corrections in the website; a CLI alternative is `node scripts/resolve-import.js --id SOURCE_ID --choice website|spreadsheet`.

The current source inventory has 654 records: 486 Sacrament and 168 Other Meetings. One no-song historical row is preserved as an incomplete draft. The public initial history contains the 653 identifiable music records. Other Meetings has records with 14, 11, and 8 music entries despite headers for only three groups. The importer reads them all. Public catalog metadata includes 341 English hymns, 268 Children's Songbook entries, and 90 newer hymns as of November 22, 2026. Sources are recorded in `data/catalog-additions.json`; lyrics and scores are not included.

Keep using the current forms for a one- to two-month trial. Reimport repeatedly, compare counts and selected reports, and only then retire the old workflow. Website-only records do not automatically write back into the old sheets. Original source values and private source snapshots remain available for review.

## Public deployment and automatic private backups

The public repository's `Deploy website` workflow builds and deploys to GitHub Pages. It supports a prepared output on `gh-pages` for automated publication. Configure Pages to use **GitHub Actions** (not branch publishing). Run the workflow after setting `PUBLIC_APP_CONFIG`; without cloud configuration the deployed app remains a clearly labeled local workspace.

Create a **private** automation repository and install `automation/publish.yml` there as `.github/workflows/publish.yml`. It refuses to execute in a public repository. Configure these Actions variables:

| Variable | Purpose |
| --- | --- |
| `SOURCE_REPOSITORY` | Public source repository, such as `flamableconcrete/hymn-stats` |
| `SOURCE_REF` | Reviewed source branch (`master` by default) |
| `FIREBASE_PROJECT_ID` | Spark project |
| `PUBLIC_APP_CONFIG` | Public Firebase/GitHub application configuration |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | GitHub OIDC provider, restricted to the private automation repository |
| `GCP_SERVICE_ACCOUNT` | Restricted service account used to export/import data |
| `IMPORT_ENABLED` | `true` only during the spreadsheet transition |
| `SOURCE_SPREADSHEET_ID`, `IMPORT_OWNER_UID` | Source and historical owner |
| `IMPORT_MAPPINGS_JSON` | Optional mapping override; defaults to the two verified tabs |

Use `google-github-actions/auth` with Workload Identity Federation so no long-lived Google key is needed in the repository. The identity needs Firestore data access, Firebase Authentication read access for account backups, and access to the specific spreadsheet when import is enabled. Do not give it project owner access. Configure the destination-scoped `SOURCE_PUBLISH_TOKEN` Actions secret with source contents and Actions access for publishing the prepared branch and dispatching/watching the public deployment workflow. The automatic `GITHUB_TOKEN` cannot push to another repository.

`scripts/setup-automation-identity.js` provisions the service account and GitHub federation using a local Firebase CLI login. Supply `FIREBASE_PROJECT_ID`, `GCP_PROJECT_NUMBER`, `GITHUB_AUTOMATION_REPOSITORY`, and the verified numeric `GITHUB_AUTOMATION_REPOSITORY_ID`/`GITHUB_OWNER_ID`. Trust is restricted to that repository's `main` branch and `.github/workflows/publish.yml`. It creates no service-account keys. The service account receives only Datastore User, Firebase Authentication Viewer, and Service Usage Consumer roles. Sharing the specific source workbook with this identity is a separate step before enabling imports.

Daily/manual automation imports enabled sources, exports all private data/accounts, commits backups **only to the private repository**, generates an allowlisted public snapshot, builds the site, publishes prepared output, and waits for the public Pages deployment. Scheduled runs are best effort; the website displays the last successful snapshot time. Admins can run the private workflow manually or use the in-app rebuild button.

Without `SOURCE_PUBLISH_TOKEN`, the workflow completes the private backup and explicitly reports that public publishing is awaiting setup. This allows recovery backups to run independently of publishing credentials. Keep `IMPORT_ENABLED=false` until spreadsheet access has been granted and verified.

Keep GitHub paid overages disabled. If a payment method already exists, configure a zero-overage spending limit with usage stopping enabled. Monitor included Actions usage and private backup repository growth. Exceeding free service limits must interrupt work rather than enable paid billing.

## Backup and restore

`npm run backup -- --out var/backup.json` exports every Firestore document/subcollection plus Firebase Authentication users/provider identities. The admin download also exports application records and histories; it is not a substitute for the automated recovery backup's authentication inventory. Backups contain private data and must stay private.

Restore is intentionally restricted to an **empty** Firestore/Auth target:

```sh
npm run restore -- --file var/backup.json --confirm-project YOUR_TARGET_PROJECT
```

Set `FIREBASE_PROJECT_ID` and credentials for that target first. Restore preserves authentication UIDs, role mappings, observations, private data, import baselines, and revision timestamps. Recreate provider configuration/authorized domains and update the public web configuration separately; cloud project settings and OAuth secrets are not database data. Never retire the old workflow until a restore has succeeded and real-device offline/sync behavior has been exercised.

## Validation

`npm test` covers import idempotency, extra music columns, medleys, missing values, date preservation, offline conflict merging, beat conversion, observer weighting, public privacy projection, and frequency semantics.

The lockfile includes scoped security overrides for transitive gRPC, glob, UUID, and OpenTelemetry dependencies. Retest the emulator and recovery suite when updating or removing these overrides. CI also checks production dependencies for high-severity advisories.

With Java 21 installed, `npm run test:rules` launches Firestore/Auth emulators and verifies actual access rules, immutable audit writes, role enforcement, and a complete backup/restore round trip. CI installs Java and Node 24 automatically. Browser verification should include narrow-screen layouts, reload/closure with drafts, offline startup after initial caching, and multiple-device conflicts before production use.

The original Python files are retained as historical prototypes and are not used by the new application.
