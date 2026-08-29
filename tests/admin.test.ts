// tests/admin.test.ts — Who is allowed into /admin.
//
// This is a security boundary, so the cases that MUST fail are tested as
// carefully as the one that must pass.

import test from 'node:test';
import assert from 'node:assert/strict';

import { isAdmin, isAdminEmail, adminEmails } from '../lib/admin.ts';

const OWNER = 'vivek9to5@gmail.com';

function withEnv(value: string | undefined, fn: () => void) {
  const previous = process.env['ADMIN_EMAILS'];
  if (value === undefined) delete process.env['ADMIN_EMAILS'];
  else process.env['ADMIN_EMAILS'] = value;
  try { fn(); } finally {
    if (previous === undefined) delete process.env['ADMIN_EMAILS'];
    else process.env['ADMIN_EMAILS'] = previous;
  }
}

test('the owner email is admin, with no env var set', () => {
  withEnv(undefined, () => {
    assert.equal(isAdminEmail(OWNER), true);
    assert.deepEqual(adminEmails(), [OWNER]);
  });
});

test('email matching ignores case and surrounding whitespace', () => {
  withEnv(undefined, () => {
    assert.equal(isAdminEmail('VIVEK9TO5@GMAIL.COM'), true);
    assert.equal(isAdminEmail('  Vivek9To5@Gmail.com  '), true);
  });
});

test('every other email is denied', () => {
  withEnv(undefined, () => {
    const outsiders = [
      'someone@example.com',
      'bhumika.pant0701@gmail.com',
      'vivek9to5@gmail.com.attacker.com',   // suffix
      'attacker.com/vivek9to5@gmail.com',   // prefix
      'vivek9to5@gmail.co',                 // near miss
      'vivek9to5+admin@gmail.com',          // plus-addressing is NOT the same account here
      '',
      '   ',
    ];
    for (const email of outsiders) {
      assert.equal(isAdminEmail(email), false, `expected "${email}" to be denied`);
    }
  });
});

test('non-string input is denied rather than throwing', () => {
  withEnv(undefined, () => {
    for (const value of [undefined, null, 0, 1, true, {}, [], { email: OWNER }]) {
      assert.equal(isAdminEmail(value), false);
    }
  });
});

test('a stored role of admin does NOT grant access', () => {
  withEnv(undefined, () => {
    // The whole point of the email allowlist: privilege can't be escalated by
    // writing role:'admin' onto a user document.
    assert.equal(isAdmin({ email: 'attacker@example.com', role: 'admin' }), false);
    assert.equal(isAdmin({ role: 'admin' }), false);
  });
});

test('the owner is admin even without a role field', () => {
  withEnv(undefined, () => {
    assert.equal(isAdmin({ email: OWNER }), true);
    assert.equal(isAdmin({ email: OWNER, role: 'user' }), true);
  });
});

test('isAdmin tolerates null and undefined', () => {
  withEnv(undefined, () => {
    assert.equal(isAdmin(null), false);
    assert.equal(isAdmin(undefined), false);
    assert.equal(isAdmin({}), false);
  });
});

test('ADMIN_EMAILS overrides the default', () => {
  withEnv('someone@else.com', () => {
    assert.equal(isAdminEmail('someone@else.com'), true);
    assert.equal(isAdminEmail(OWNER), false, 'default must not leak through an explicit override');
  });
});

test('ADMIN_EMAILS accepts a list, with messy spacing', () => {
  withEnv(' A@x.com , B@Y.com ,, c@z.com ', () => {
    assert.deepEqual(adminEmails(), ['a@x.com', 'b@y.com', 'c@z.com']);
    assert.equal(isAdminEmail('B@y.com'), true);
    assert.equal(isAdminEmail('d@z.com'), false);
  });
});

test('an empty ADMIN_EMAILS locks everyone out rather than opening up', () => {
  withEnv('', () => {
    // Empty string is a deliberate "nobody", not "fall back to the default".
    assert.deepEqual(adminEmails(), []);
    assert.equal(isAdminEmail(OWNER), false);
  });
});

test('the allowlist is read at call time, not cached at import', () => {
  withEnv('first@x.com', () => assert.equal(isAdminEmail('first@x.com'), true));
  withEnv('second@x.com', () => {
    assert.equal(isAdminEmail('second@x.com'), true);
    assert.equal(isAdminEmail('first@x.com'), false);
  });
});
