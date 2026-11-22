import { cliAccessToken } from './cli-credential.js';
import { writeJson } from './admin.js';

const projectId = process.env.FIREBASE_PROJECT_ID;
const projectNumber = process.env.GCP_PROJECT_NUMBER;
const repositoryId = process.env.GITHUB_AUTOMATION_REPOSITORY_ID;
const ownerId = process.env.GITHUB_OWNER_ID;
const repository = process.env.GITHUB_AUTOMATION_REPOSITORY;
if (![projectId, projectNumber, repositoryId, ownerId, repository].every(Boolean)) throw new Error('Set the project and verified GitHub repository identity variables first.');
const accountId = 'hymn-stats-automation', poolId = 'github-actions', providerId = 'hymn-stats';
const iam = 'https://iam.googleapis.com/v1/', resource = 'https://cloudresourcemanager.googleapis.com/v1/';
async function api(url, method = 'GET', body, missingOk = false) {
  const token = await cliAccessToken();
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (missingOk && response.status === 404) return null;
  const raw = await response.text();
  let result;
  try { result = JSON.parse(raw); } catch { throw new Error(`Google Cloud returned a non-JSON response (${response.status}) for ${method} ${new URL(url).pathname}`); }
  if (!response.ok) throw new Error(`Google Cloud ${response.status}: ${result.error?.message || 'request failed'}`);
  return result;
}
async function operation(result, base) {
  for (let attempt = 0; result.name && !result.done && attempt < 60; attempt++) { await new Promise(r => setTimeout(r, 2000)); result = await api(`${base}${result.name}`); }
  if (result.error) throw new Error(result.error.message);
  if (result.name && result.done === false) throw new Error('Provisioning is still in progress. Retry after the operation completes.');
  return result.response || result;
}
function binding(policy, role, member) {
  policy.bindings ||= [];
  let b = policy.bindings.find(x => x.role === role && !x.condition);
  if (!b) { b = { role, members: [] }; policy.bindings.push(b); }
  if (!b.members.includes(member)) b.members.push(member);
}
const serviceUsage = 'https://serviceusage.googleapis.com/v1/';
await operation(await api(`${serviceUsage}projects/${projectNumber}/services:batchEnable`, 'POST', { serviceIds: ['iam.googleapis.com', 'iamcredentials.googleapis.com', 'sts.googleapis.com', 'cloudresourcemanager.googleapis.com', 'sheets.googleapis.com'] }), serviceUsage);
console.log('Enabled the identity and spreadsheet APIs. No billing service was enabled.');
const email = `${accountId}@${projectId}.iam.gserviceaccount.com`;
let account = await api(`${iam}projects/${projectId}/serviceAccounts/${encodeURIComponent(email)}`, 'GET', undefined, true);
if (!account) account = await api(`${iam}projects/${projectId}/serviceAccounts`, 'POST', { accountId, serviceAccount: { displayName: 'Hymn Stats automation', description: 'Private backup and repeatable spreadsheet import for Hymn Stats.' } });
const poolName = `projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}`;
let pool = await api(`${iam}${poolName}`, 'GET', undefined, true);
if (!pool) { await operation(await api(`${iam}projects/${projectNumber}/locations/global/workloadIdentityPools?workloadIdentityPoolId=${poolId}`, 'POST', { displayName: 'Hymn Stats GitHub Actions', description: 'Restricted to the private Hymn Stats automation repository.' }), iam); pool = await api(`${iam}${poolName}`); }
const providerName = `${poolName}/providers/${providerId}`;
const condition = `assertion.repository_id == '${repositoryId}' && assertion.repository_owner_id == '${ownerId}' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '${repository}/.github/workflows/publish.yml@refs/heads/main'`;
let provider = await api(`${iam}${providerName}`, 'GET', undefined, true);
if (!provider) {
  await operation(await api(`${iam}${poolName}/providers?workloadIdentityPoolProviderId=${providerId}`, 'POST', { displayName: 'Hymn Stats publisher', attributeMapping: { 'google.subject': 'assertion.sub', 'attribute.repository_id': 'assertion.repository_id', 'attribute.repository_owner_id': 'assertion.repository_owner_id', 'attribute.ref': 'assertion.ref' }, attributeCondition: condition, oidc: { issuerUri: 'https://token.actions.githubusercontent.com' } }), iam);
  provider = await api(`${iam}${providerName}`);
}
if (provider.attributeCondition !== condition) throw new Error('Existing provider trust differs from the expected restricted repository/workflow. Review it instead of widening it automatically.');
const projectPolicy = await api(`${resource}projects/${projectId}:getIamPolicy`, 'POST', { options: { requestedPolicyVersion: 3 } });
for (const role of ['roles/datastore.user', 'roles/firebaseauth.viewer', 'roles/serviceusage.serviceUsageConsumer']) binding(projectPolicy, role, `serviceAccount:${account.email}`);
await api(`${resource}projects/${projectId}:setIamPolicy`, 'POST', { policy: projectPolicy });
const accountPolicyUrl = `${iam}${account.name}`;
const accountPolicy = await api(`${accountPolicyUrl}:getIamPolicy`, 'POST');
binding(accountPolicy, 'roles/iam.workloadIdentityUser', `principalSet://iam.googleapis.com/${poolName}/attribute.repository_id/${repositoryId}`);
await api(`${accountPolicyUrl}:setIamPolicy`, 'POST', { policy: accountPolicy });
await writeJson('var/automation-identity.json', { projectId, projectNumber, serviceAccount: account.email, workloadIdentityProvider: provider.name, repository, repositoryId, condition });
console.log(JSON.stringify({ serviceAccount: account.email, workloadIdentityProvider: provider.name, repository, restrictedToMainWorkflow: true, serviceAccountKeysCreated: 0 }));
