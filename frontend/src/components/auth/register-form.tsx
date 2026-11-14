"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { Field, fieldDescribedBy, PasswordInput } from "@/components/common/form-field";
import { InlineError } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, errorMessage } from "@/lib/api/client";
import { hardNavigate } from "@/lib/navigation";
import { useRegister } from "@/lib/query/hooks";
import {
  MIN_PASSWORD_LENGTH,
  registerSchema,
  safeNextPath,
  type RegisterValues,
} from "@/lib/validation";

const FIELDS = ["name", "email", "password"] as const;

/** Field-level messages from a 422 `validation_error`, when the API names the field. */
function serverFieldErrors(error: unknown): { field: (typeof FIELDS)[number]; message: string }[] {
  if (
    !(error instanceof ApiError) ||
    error.code !== "validation_error" ||
    !Array.isArray(error.details)
  ) {
    return [];
  }
  const result: { field: (typeof FIELDS)[number]; message: string }[] = [];
  for (const item of error.details as unknown[]) {
    if (!item || typeof item !== "object") continue;
    const { field, message } = item as { field?: unknown; message?: unknown };
    const known = FIELDS.find((name) => name === field);
    if (known && typeof message === "string") result.push({ field: known, message });
  }
  return result;
}

export function RegisterForm({ nextPath }: { nextPath?: string | null }) {
  const register = useRegister();
  const destination = safeNextPath(nextPath);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "" },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit((values) => {
    register.mutate(values, {
      onSuccess: () => hardNavigate(destination),
      onError: (error) => {
        for (const { field, message } of serverFieldErrors(error)) {
          form.setError(field, { type: "server", message });
        }
      },
    });
  });

  const loginHref =
    destination === "/app" ? "/login" : `/login?next=${encodeURIComponent(destination)}`;
  const pending = register.isPending || register.isSuccess;
  const passwordHint = `At least ${MIN_PASSWORD_LENGTH} characters. Mix letters, numbers or symbols.`;

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-4"
      aria-label="Create an account"
    >
      {register.isError ? (
        <InlineError>
          {errorMessage(register.error, "Your account could not be created. Please try again.")}
        </InlineError>
      ) : null}

      <Field id="register-name" label="Name" error={errors.name?.message}>
        <Input
          id="register-name"
          autoComplete="name"
          autoFocus
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={fieldDescribedBy("register-name", errors.name?.message)}
          {...form.register("name")}
        />
      </Field>

      <Field id="register-email" label="Email" error={errors.email?.message}>
        <Input
          id="register-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={fieldDescribedBy("register-email", errors.email?.message)}
          {...form.register("email")}
        />
      </Field>

      <Field
        id="register-password"
        label="Password"
        error={errors.password?.message}
        hint={passwordHint}
      >
        <PasswordInput
          id="register-password"
          autoComplete="new-password"
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={fieldDescribedBy(
            "register-password",
            errors.password?.message,
            passwordHint,
          )}
          {...form.register("password")}
        />
      </Field>

      <Button type="submit" loading={pending} className="mt-1 w-full">
        Create account
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={loginHref}
          className="font-medium text-accent-text underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
