import { describe, expect, it } from 'vitest';

import { describePasswordProblem, suggestPassword } from './password-policy';

/**
 * These rules are a copy of `assertPasswordPolicy` on the server. A copy is
 * justified - it turns a round trip into instant feedback - but a copy that
 * drifts is worse than none, because the form would reject a password the API
 * accepts, or promise one it will refuse.
 *
 * The server rules, for whoever changes them next:
 *   length >= security.password.minLength, and at least one lowercase,
 *   uppercase, digit and symbol.
 */
describe('describePasswordProblem', () => {
  const MIN = 12;

  it('accepts a password meeting every rule', () => {
    expect(describePasswordProblem('Str0ngEnough!', MIN)).toBe('');
  });

  it('says nothing about an empty field', () => {
    // Blank means "not chosen yet", not "invalid" - the field is optional when
    // creating a user, and an error on an untouched control is noise.
    expect(describePasswordProblem('', MIN)).toBe('');
  });

  it('reports each missing requirement', () => {
    expect(describePasswordProblem('Sh0rt!', MIN)).toMatch(/at least 12/);
    expect(describePasswordProblem('ALLUPPERCASE1!', MIN)).toMatch(/lowercase/);
    expect(describePasswordProblem('alllowercase1!', MIN)).toMatch(/uppercase/);
    expect(describePasswordProblem('NoDigitsHere!!', MIN)).toMatch(/digit/);
    expect(describePasswordProblem('NoSymbolsHere1', MIN)).toMatch(/symbol/);
  });

  it('follows the minimum length it is given rather than a hardcoded one', () => {
    // The length comes from a live setting, so a project that raises it must
    // get the stricter check without touching this file.
    expect(describePasswordProblem('Str0ngEnough!', 32)).toMatch(/at least 32/);
  });
});

describe('suggestPassword', () => {
  it('always produces a password its own validator accepts', () => {
    for (const min of [12, 16, 24, 40]) {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const password = suggestPassword(min);
        expect(describePasswordProblem(password, min)).toBe('');
      }
    }
  });

  it('never returns the same password twice', () => {
    const seen = new Set(Array.from({ length: 100 }, () => suggestPassword(12)));
    expect(seen.size).toBe(100);
  });

  it('omits characters that are misread when read aloud', () => {
    // The value exists to be passed to somebody, so 0/O and 1/l/I are out.
    const generated = Array.from({ length: 50 }, () => suggestPassword(16)).join('');
    // The guaranteed "Aa3!" suffix is excluded from the check.
    const body = generated.replace(/Aa3!/g, '');
    expect(body).not.toMatch(/[0O1lI]/);
  });
});
