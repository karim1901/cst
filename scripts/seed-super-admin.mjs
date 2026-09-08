/**
 * Seeds the initial Super Admin account.
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-super-admin.mjs
 *   # or
 *   npm run seed:super-admin
 *
 * Reads SUPER_ADMIN_NAME / SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD from the
 * environment. The password is hashed by the User model's pre-save hook — it
 * is never written in plain text. Safe to run repeatedly: if a Super Admin
 * with the given email already exists, nothing changes.
 */
import mongoose from "mongoose";

import { connectToDatabase } from "../lib/mongodb.js";
import User, { USER_ROLES } from "../models/User.js";

async function main() {
  const name = process.env.SUPER_ADMIN_NAME?.trim();
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!name || !email || !password) {
    throw new Error(
      "Missing SUPER_ADMIN_NAME, SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD."
    );
  }
  if (password.length < 8) {
    throw new Error("SUPER_ADMIN_PASSWORD must be at least 8 characters long.");
  }

  await connectToDatabase();

  const existing = await User.findOne({ email }).lean();
  if (existing) {
    if (existing.role === USER_ROLES.SUPER_ADMIN) {
      console.log(`✓ Super Admin "${email}" already exists — no changes made.`);
      return;
    }
    throw new Error(
      `Email "${email}" is already used by a "${existing.role}" account. Choose another SUPER_ADMIN_EMAIL.`
    );
  }

  const user = await User.create({
    name,
    email,
    password,
    role: USER_ROLES.SUPER_ADMIN,
  });

  console.log(`✓ Created Super Admin: ${user.email} (id ${user._id})`);
}

main()
  .catch((err) => {
    console.error(`✗ Seed failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
