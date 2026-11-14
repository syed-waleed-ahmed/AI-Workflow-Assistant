import { z } from "zod";

/*
 * These rules mirror the API (backend/app/schemas/auth.py and analysis.py) so people see the
 * problem before submitting. The API remains the authority and re-validates everything.
 */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_NAME_LENGTH = 120;
export const MAX_QUESTION_LENGTH = 2000;
export const MAX_DATASET_NAME_LENGTH = 200;

const EMAIL_PATTERN = /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s.]{2,}$/;

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .max(320, "Enter a valid email address.")
  .regex(EMAIL_PATTERN, "Enter a valid email address.");

export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`)
  .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters long.`)
  .refine((value) => !/^\d+$/.test(value) && new Set(value).size >= 4, {
    message: "Password is too simple. Mix letters, numbers or symbols.",
  });

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name.")
  .max(MAX_NAME_LENGTH, `Name must be at most ${MAX_NAME_LENGTH} characters long.`);

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, "Enter your password.")
    .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters long.`),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: newPasswordSchema,
});
export type RegisterValues = z.infer<typeof registerSchema>;

export const profileSchema = z.object({ name: nameSchema });
export type ProfileValues = z.infer<typeof profileSchema>;

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password."),
    new_password: newPasswordSchema,
    confirm_password: z.string().min(1, "Repeat the new password."),
  })
  .refine((values) => values.new_password === values.confirm_password, {
    path: ["confirm_password"],
    message: "The passwords do not match.",
  });
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Enter your password to confirm."),
});
export type DeleteAccountValues = z.infer<typeof deleteAccountSchema>;

export const questionSchema = z
  .string()
  .transform((value) => value.split(/\s+/).filter(Boolean).join(" "))
  .pipe(
    z
      .string()
      .min(3, "Ask a question of at least 3 characters.")
      .max(MAX_QUESTION_LENGTH, `Questions are limited to ${MAX_QUESTION_LENGTH} characters.`),
  );

export const datasetNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name.")
    .max(MAX_DATASET_NAME_LENGTH, `Names are limited to ${MAX_DATASET_NAME_LENGTH} characters.`),
});
export type DatasetNameValues = z.infer<typeof datasetNameSchema>;

/** Only same-site relative paths are accepted as a post-login destination. */
export function safeNextPath(value: string | null | undefined, fallback = "/app"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (!value.startsWith("/app")) return fallback;
  return value;
}
