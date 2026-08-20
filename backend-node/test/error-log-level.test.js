'use strict';

/**
 * Which failures are worth a warning.
 *
 * A 15-minute access token means a long-lived session produces a 401 roughly
 * four times an hour, times however many requests were in flight - and the
 * client refreshes and retries without the user seeing anything. Logged as
 * problems, those drown the 401s that matter and inflate the dashboard's error
 * rate while nothing is wrong.
 *
 * Three places classify a response and they must agree, or quietening one
 * leaves the same request shouting from the other two:
 *
 *   - core/http/error-handler.js   the stdout line carrying the stack
 *   - middleware/index.js          the pino-http request line
 *   - modules/observability/…      the row the log viewer and dashboard read
 *
 * All three ask `isRoutineFailure`, so this covers the shared decision.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { isRoutineFailure, ROUTINE_AUTH_CODES } = require('../server/core/http/error-handler');

/** The shape the loggers see: `res.locals` is where the handler publishes. */
function responseWith(errorCode) {
  return { locals: errorCode === undefined ? {} : { errorCode } };
}

test('an expired access token is routine, not a warning', () => {
  assert.equal(isRoutineFailure(responseWith('TOKEN_EXPIRED')), true);
});

test('permissions changing under a live session is routine', () => {
  // The token was invalidated deliberately; the client re-bootstraps. This is
  // the revocation mechanism succeeding, not failing.
  assert.equal(isRoutineFailure(responseWith('PERMISSIONS_CHANGED')), true);
});

test('the 401s that mean something are still warnings', () => {
  for (const code of ['TOKEN_INVALID', 'TOKEN_MISSING', 'SESSION_REVOKED', 'SESSION_EXPIRED', 'ACCOUNT_MISSING']) {
    assert.equal(isRoutineFailure(responseWith(code)), false, `${code} must stay a warning`);
  }
});

test('a forbidden response is never routine', () => {
  // Someone attempting what they may not do is the signal this level exists
  // for, whatever else is quietened.
  assert.equal(isRoutineFailure(responseWith('FORBIDDEN')), false);
});

test('a response with no error code is not routine', () => {
  assert.equal(isRoutineFailure(responseWith(undefined)), false);
  assert.equal(isRoutineFailure({ locals: {} }), false);
});

test('survives a response without locals', () => {
  // `finish` can fire on a response that never reached the error handler.
  // Throwing inside a logger would turn a quiet 401 into a crashed request.
  assert.equal(isRoutineFailure({}), false);
});

test('the routine set stays deliberately small', () => {
  // A guard against this becoming the place inconvenient warnings are hidden.
  // Adding a code here removes it from every problem view at once, so it
  // should be a decision, not a reflex.
  assert.deepEqual([...ROUTINE_AUTH_CODES].sort(), ['PERMISSIONS_CHANGED', 'TOKEN_EXPIRED']);
});
