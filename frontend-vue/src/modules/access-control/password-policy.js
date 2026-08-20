/**
 * Client-side mirror of the server's password policy.
 *
 * `assertPasswordPolicy` in `backend-node/server/modules/access-control/
 * services/user.service.js` is the authority - this never gates a request, it
 * only reports the same problem sooner. Without it, an administrator fills in
 * a whole user form and submits it to be told the password lacks a symbol.
 *
 * The two must be changed together. The length comes from the live
 * `security.password.minLength` setting rather than a constant here, so at
 * least that half cannot drift.
 */

/**
 * @param {string} password
 * @param {number} minLength  From the `security.password.minLength` setting.
 * @returns {string} The first problem, or '' when the password is acceptable.
 */
export function describePasswordProblem(password, minLength) {
  if (!password) return '';

  if (password.length < minLength) return `Must be at least ${minLength} characters.`;
  if (!/[a-z]/.test(password)) return 'Must contain a lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Must contain an uppercase letter.';
  if (!/\d/.test(password)) return 'Must contain a digit.';
  if (!/[^\w\s]/.test(password)) return 'Must contain a symbol.';

  return '';
}

/**
 * A password that satisfies every rule above, for the administrative reset
 * flow where one has to be invented on the spot.
 *
 * The alphabet omits characters that are misread when a password is spoken or
 * copied by hand - 0/O, 1/l/I - because this value's whole purpose is to be
 * passed to somebody else.
 */
export function suggestPassword(minLength) {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const length = Math.max(minLength, 16);

  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);

  // The four-character suffix guarantees the class requirements rather than
  // trusting a random draw to happen to include each one.
  const body = Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('');
  return `${body.slice(0, length - 4)}Aa3!`;
}
