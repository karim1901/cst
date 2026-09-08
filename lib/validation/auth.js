import { z } from "zod";

/**
 * Server-side request validation for the auth and employee-management
 * endpoints.
 *
 * Note what is NOT here: `role` and `merchantId`. The client can never submit
 * those — each endpoint sets them explicitly on the server.
 */

const email = z
  .email({ message: "Enter a valid email address." })
  .trim()
  .toLowerCase()
  .max(254);

const name = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters.")
  .max(120, "Name must be at most 120 characters.");

const newPassword = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be at most 128 characters.");

// Employees log in with a username instead of an email.
const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Username must be at least 3 characters.")
  .max(32, "Username must be at most 32 characters.")
  .regex(
    /^[a-z0-9](?:[a-z0-9_.]{1,30}[a-z0-9])?$/,
    "Username may only contain lowercase letters, digits, dot and underscore."
  );

const phone = z
  .string()
  .trim()
  .min(6, "Enter a valid phone number.")
  .max(20, "Enter a valid phone number.")
  .regex(/^[0-9+()\-\s]+$/, "Enter a valid phone number.");

// Whole-number amounts only — money and thresholds never carry decimals here,
// which avoids floating-point drift entirely instead of rounding around it.
const nonNegativeInt = z.coerce
  .number({ message: "Must be a number." })
  .int("Must be a whole number.")
  .min(0, "Cannot be negative.");

const commissionSchema = z.object({
  threshold: nonNegativeInt,
  commissionBelowThreshold: nonNegativeInt,
  commissionAtOrAboveThreshold: nonNegativeInt,
});

// Optional — an empty string from the form means "not set".
const quickLivraisonApiKey = z
  .string()
  .trim()
  .max(256, "API key is too long.")
  .optional()
  .transform((value) => (value ? value : undefined));

export const loginSchema = z.object({
  // Merchants/super admins sign in with their email; employees with their
  // username. One field, resolved server-side against both.
  identifier: z.string().trim().toLowerCase().min(1, "Email or username is required."),
  password: z.string().min(1, "Password is required."),
});

export const merchantRegisterSchema = z.object({
  name,
  email,
  password: newPassword,
});

export const employeeCreateSchema = z.object({
  name,
  username,
  phone,
  password: newPassword,
  commission: commissionSchema,
  quickLivraisonApiKey,
});

// The floor lib/ozon/reserve-tracking-number.js's INITIAL_VALUE already
// establishes for a never-used counter — an administrative override must
// stay at or above it, same as the value the field would naturally start
// at, so it can never produce a shorter/malformed tracking number.
const OZON_COUNTER_FLOOR = 1000;

const ozonTrackingCounter = z.coerce
  .number({ message: "Must be a number." })
  .int("Must be a whole number.")
  .min(OZON_COUNTER_FLOOR, `Must be ${OZON_COUNTER_FLOOR} or greater.`)
  .optional();

// Every field optional — a merchant edits only what they mean to change.
// `role`/`merchantId` are still never here; the route sets neither from the
// client, same rule as employeeCreateSchema.
export const employeeUpdateSchema = z.object({
  name: name.optional(),
  username: username.optional(),
  phone: phone.optional(),
  password: newPassword.optional(),
  commission: commissionSchema.optional(),
  quickLivraisonApiKey,
  ozonTrackingCounter,
});

// Profile self-edit — every role uses this one schema; which of these
// fields actually apply is decided server-side from the caller's own role
// (see app/api/settings/profile/route.js), never from client input.
export const profileUpdateSchema = z.object({
  name: name.optional(),
  phone: phone.optional(),
  username: username.optional(),
  email: email.optional(),
});

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required."),
    newPassword,
    confirmNewPassword: z.string().min(1, "Please confirm the new password."),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match.",
    path: ["confirmNewPassword"],
  });

/**
 * `{ field: [messages] }` for a failed `safeParse`, safe to send to the
 * client. Nested fields (e.g. `commission.threshold`) keep their dotted path
 * as the key instead of being bucketed under the parent — `z.flattenError`
 * only flattens one level, which would merge every commission field's
 * errors into a single `commission` entry.
 */
export function fieldErrorsOf(zodError) {
  const errors = {};
  for (const issue of zodError.issues) {
    const key = issue.path.join(".");
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}
