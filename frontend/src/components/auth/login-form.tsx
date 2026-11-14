"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { Field, fieldDescribedBy, PasswordInput } from "@/components/common/form-field";
import { InlineError } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api/client";
import { hardNavigate } from "@/lib/navigation";
import { useLogin } from "@/lib/query/hooks";
import { loginSchema, safeNextPath, type LoginValues } from "@/lib/validation";

interface LoginFormProps {
  /** Where to go after signing in (the `next` query parameter). */
  nextPath?: string | null;
  /** The previous session expired, so explain why the person is here. */
  expired?: boolean;
}

export function LoginForm({ nextPath, expired = false }: LoginFormProps) {
  const login = useLogin();
  const destination = safeNextPath(nextPath);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit((values) => {
    login.mutate(values, { onSuccess: () => hardNavigate(destination) });
  });

  const registerHref =
    destination === "/app" ? "/register" : `/register?next=${encodeURIComponent(destination)}`;
  // Stay in the loading state until the browser has left the page.
  const pending = login.isPending || login.isSuccess;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Sign in">
      {expired && !login.isError ? (
        <p
          role="status"
          className="rounded-md bg-muted px-3 py-2 text-sm leading-5 text-muted-foreground"
        >
          Your session has expired. Sign in again to continue.
        </p>
      ) : null}
      {login.isError ? (
        <InlineError>
          {errorMessage(login.error, "You could not be signed in. Please try again.")}
        </InlineError>
      ) : null}

      <Field id="login-email" label="Email" error={errors.email?.message}>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoFocus
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={fieldDescribedBy("login-email", errors.email?.message)}
          {...form.register("email")}
        />
      </Field>

      <Field id="login-password" label="Password" error={errors.password?.message}>
        <PasswordInput
          id="login-password"
          autoComplete="current-password"
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={fieldDescribedBy("login-password", errors.password?.message)}
          {...form.register("password")}
        />
      </Field>

      <Button type="submit" loading={pending} className="mt-1 w-full">
        Sign in
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link
          href={registerHref}
          className="font-medium text-accent-text underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
