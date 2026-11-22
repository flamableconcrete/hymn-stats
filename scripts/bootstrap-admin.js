import { services, arg } from './admin.js';
const { auth, db } = services(), email = arg('email');
if (!email) throw new Error('Pass --email for a Google account that has signed into the app once.');
const user = await auth.getUserByEmail(email);
await db.doc(`members/${user.uid}`).set({ email: email.toLowerCase(), role: 'admin' });
console.log(`Admin account configured. Owner UID for history imports: ${user.uid}`);
