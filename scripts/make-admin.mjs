/**
 * Make a user an admin by email.
 * Usage: node scripts/make-admin.mjs your@email.com
 *
 * Requires MONGODB_URI to be set in .env.local (loaded automatically).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local manually
try {
  const envPath = resolve(process.cwd(), '.env.local');
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
} catch {
  console.warn('Could not read .env.local — make sure MONGODB_URI is set.');
}

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/make-admin.mjs your@email.com');
  process.exit(1);
}

const { default: mongoose } = await import('mongoose');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set.');
  process.exit(1);
}

await mongoose.connect(uri);

const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));

const result = await User.findOneAndUpdate(
  { email: email.toLowerCase() },
  { $set: { role: 'admin' } },
  { new: true }
);

if (!result) {
  console.error(`No user found with email: ${email}`);
  process.exit(1);
}

console.log(`✅ ${result.email} is now an admin.`);
await mongoose.disconnect();
