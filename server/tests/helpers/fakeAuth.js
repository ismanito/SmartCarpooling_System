// Stand-in for Firebase Admin's verifyIdToken. Tokens are "test-token:<base64url JSON identity>".
const PREFIX = 'test-token:';

function tokenFor({ uid, email, emailVerified = true }) {
  return PREFIX + Buffer.from(JSON.stringify({ uid, email, emailVerified })).toString('base64url');
}

async function fakeVerifyIdToken(token) {
  if (!token.startsWith(PREFIX)) throw new Error('invalid token');
  return JSON.parse(Buffer.from(token.slice(PREFIX.length), 'base64url').toString('utf8'));
}

module.exports = { tokenFor, fakeVerifyIdToken };
