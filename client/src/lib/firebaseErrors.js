// Firebase Auth error codes → plain messages. Login errors are deliberately non-enumerating.
const MESSAGES = {
  'auth/email-already-in-use': 'An account with this email already exists. Log in instead.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/weak-password': 'Use at least 8 characters for your password.',
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/wrong-password': 'Email or password is incorrect.',
  'auth/user-not-found': 'Email or password is incorrect.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection.',
  'auth/user-disabled': 'This account has been disabled.',
}

export function firebaseMessage(error) {
  return MESSAGES[error?.code] || error?.message || 'Something went wrong. Please try again.'
}
