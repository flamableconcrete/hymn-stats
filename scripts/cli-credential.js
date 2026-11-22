import { createRequire } from 'node:module';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
const require = createRequire(import.meta.url);
// Local setup only. Refresh credentials remain in Firebase CLI's credential store;
// neither tokens nor client credentials are copied into application files or Actions.
export async function cliAccessToken() {
  const auth = require('firebase-tools/lib/auth');
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account?.tokens?.refresh_token) throw new Error('Sign in with npx -y firebase-tools@latest login before using the local CLI credential.');
  const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  if (!token.access_token) throw new Error('Firebase CLI did not return an access token.');
  return { access_token: token.access_token, expires_in: Math.max(60, Math.floor((token.expires_at - Date.now()) / 1000)) };
}
export function cliGoogleAuth(projectId) {
  const client = new OAuth2Client();
  client.refreshHandler = async () => { const token = await cliAccessToken(); return { access_token: token.access_token, expiry_date: Date.now() + token.expires_in * 1000 }; };
  return new GoogleAuth({ projectId, authClient: client });
}
