"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Field, fieldDescribedBy, PasswordInput } from "@/components/common/form-field";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { ErrorState, InlineError } from "@/components/common/states";
import { UsageMeters } from "@/components/dashboard/usage-meters";
import { THEME_OPTIONS } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/client";
import type { User } from "@/lib/api/types";
import { formatDate, formatInteger } from "@/lib/format";
import { hardNavigate } from "@/lib/navigation";
import {
  useChangePassword,
  useDeleteAccount,
  useMe,
  useUpdateProfile,
  useUsage,
} from "@/lib/query/hooks";
import { cn } from "@/lib/utils";
import {
  changePasswordSchema,
  deleteAccountSchema,
  MIN_PASSWORD_LENGTH,
  profileSchema,
  type ChangePasswordValues,
  type DeleteAccountValues,
  type ProfileValues,
} from "@/lib/validation";

function SettingsSection({
  title,
  description,
  children,
  danger = false,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <Card className={cn(danger && "border-destructive-text/40")}>
      <CardHeader>
        <CardTitle className={cn("text-base", danger && "text-destructive-text")}>
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ProfileForm({ user }: { user: User }) {
  const update = useUpdateProfile();
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    values: { name: user.name },
  });
  const error = form.formState.errors.name?.message;

  const submit = form.handleSubmit((values) => {
    update.mutate(values, { onSuccess: () => toast.success("Profile updated") });
  });

  return (
    <form onSubmit={submit} noValidate className="flex max-w-md flex-col gap-4">
      <Field id="profile-name" label="Name" error={error}>
        <Input
          id="profile-name"
          autoComplete="name"
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescribedBy("profile-name", error)}
          {...form.register("name")}
        />
      </Field>
      <Field
        id="profile-email"
        label="Email"
        hint="Your email address is your sign-in and cannot be changed here."
      >
        <Input
          id="profile-email"
          value={user.email}
          readOnly
          aria-describedby="profile-email-hint"
        />
      </Field>
      {update.isError ? (
        <InlineError>
          {errorMessage(update.error, "Your profile could not be updated.")}
        </InlineError>
      ) : null}
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          size="sm"
          loading={update.isPending}
          disabled={!form.formState.isDirty}
        >
          Save changes
        </Button>
        <p className="text-xs text-muted-foreground">Member since {formatDate(user.created_at)}</p>
      </div>
    </form>
  );
}

function PasswordForm() {
  const change = useChangePassword();
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });
  const { errors } = form.formState;
  const hint = `At least ${MIN_PASSWORD_LENGTH} characters. Mix letters, numbers or symbols.`;

  const submit = form.handleSubmit((values) => {
    change.mutate(
      { current_password: values.current_password, new_password: values.new_password },
      {
        onSuccess: () => {
          toast.success("Password changed");
          form.reset();
        },
      },
    );
  });

  return (
    <form onSubmit={submit} noValidate className="flex max-w-md flex-col gap-4">
      <Field
        id="current-password"
        label="Current password"
        error={errors.current_password?.message}
      >
        <PasswordInput
          id="current-password"
          autoComplete="current-password"
          aria-invalid={errors.current_password ? true : undefined}
          aria-describedby={fieldDescribedBy("current-password", errors.current_password?.message)}
          {...form.register("current_password")}
        />
      </Field>
      <Field
        id="new-password"
        label="New password"
        error={errors.new_password?.message}
        hint={hint}
      >
        <PasswordInput
          id="new-password"
          autoComplete="new-password"
          aria-invalid={errors.new_password ? true : undefined}
          aria-describedby={fieldDescribedBy("new-password", errors.new_password?.message, hint)}
          {...form.register("new_password")}
        />
      </Field>
      <Field
        id="confirm-password"
        label="Repeat new password"
        error={errors.confirm_password?.message}
      >
        <PasswordInput
          id="confirm-password"
          autoComplete="new-password"
          aria-invalid={errors.confirm_password ? true : undefined}
          aria-describedby={fieldDescribedBy("confirm-password", errors.confirm_password?.message)}
          {...form.register("confirm_password")}
        />
      </Field>
      {change.isError ? (
        <InlineError>
          {errorMessage(change.error, "Your password could not be changed.")}
        </InlineError>
      ) : null}
      <div>
        <Button type="submit" size="sm" loading={change.isPending}>
          Change password
        </Button>
      </div>
    </form>
  );
}

const subscribeNoop = () => () => undefined;

function ThemePicker() {
  const { theme, setTheme } = useTheme();
  // The stored preference is only known in the browser; avoid a server/client mismatch.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const current = mounted ? (theme ?? "system") : null;
  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid max-w-md grid-cols-3 gap-2">
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-border px-3 py-3 text-sm transition-colors hover:bg-muted has-checked:border-ring has-checked:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={current === value}
              onChange={() => setTheme(value)}
              className="sr-only"
            />
            <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function UsageTotals() {
  const usage = useUsage();
  if (!usage.data) return null;
  const facts = [
    { label: "Analyses run in total", value: formatInteger(usage.data.analyses_total) },
    { label: "Reports stored", value: formatInteger(usage.data.reports) },
    { label: "Datasets stored", value: formatInteger(usage.data.datasets) },
  ];
  return (
    <dl className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt className="text-xs text-muted-foreground">{fact.label}</dt>
          <dd className="tabular text-lg font-semibold">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const remove = useDeleteAccount();
  const form = useForm<DeleteAccountValues>({
    resolver: zodResolver(deleteAccountSchema),
    defaultValues: { password: "" },
  });
  const error = form.formState.errors.password?.message;

  const submit = form.handleSubmit((values) => {
    remove.mutate(values, { onSuccess: () => hardNavigate("/") });
  });
  const pending = remove.isPending || remove.isSuccess;

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Delete account
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return;
          if (!next) {
            form.reset();
            remove.reset();
          }
          setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your account together with all of your datasets, analyses and
              reports. It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <Field id="delete-password" label="Confirm with your password" error={error}>
              <PasswordInput
                id="delete-password"
                autoComplete="current-password"
                aria-invalid={error ? true : undefined}
                aria-describedby={fieldDescribedBy("delete-password", error)}
                {...form.register("password")}
              />
            </Field>
            {remove.isError ? (
              <InlineError>
                {errorMessage(remove.error, "Your account could not be deleted.")}
              </InlineError>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" loading={pending}>
                Delete account permanently
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SettingsView() {
  const me = useMe();

  let profile: ReactNode;
  if (me.isPending) {
    profile = (
      <LoadingRegion label="Loading your profile" className="max-w-md space-y-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-8 w-32" />
      </LoadingRegion>
    );
  } else if (me.isError) {
    profile = (
      <ErrorState
        error={me.error}
        title="Your profile could not be loaded"
        onRetry={() => void me.refetch()}
        retrying={me.isFetching}
        className="py-6"
      />
    );
  } else {
    profile = <ProfileForm user={me.data} />;
  }

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title="Settings" description="Your profile, sign-in, appearance and data." />

      <SettingsSection title="Profile" description="How you appear in the app.">
        {profile}
      </SettingsSection>

      <SettingsSection
        title="Password"
        description="Changing your password signs out your other sessions. This one stays signed in."
      >
        <PasswordForm />
      </SettingsSection>

      <SettingsSection
        title="Appearance"
        description="Choose a theme, or follow your system setting."
      >
        <ThemePicker />
      </SettingsSection>

      <SettingsSection
        title="Usage"
        description="Your account limits. Analyses are counted over the last 24 hours."
      >
        <UsageMeters />
        <UsageTotals />
      </SettingsSection>

      <SettingsSection
        title="Your data"
        description="Datasets, analyses and reports are private to your account. You can delete any of them at any time."
      >
        <ul className="space-y-2 text-sm leading-6 text-muted-foreground">
          <li>
            <Link
              href="/app/datasets"
              className="font-medium text-accent-text underline-offset-4 hover:underline"
            >
              Datasets
            </Link>{" "}
            — delete an uploaded file and its profile. Reports already produced from it are kept.
          </li>
          <li>
            <Link
              href="/app/analyses"
              className="font-medium text-accent-text underline-offset-4 hover:underline"
            >
              Analyses
            </Link>{" "}
            — export a report as Markdown, PDF or Excel, or delete a conversation together with the
            reports it produced.
          </li>
        </ul>
      </SettingsSection>

      <SettingsSection
        danger
        title="Delete account"
        description="Permanently delete your account and everything stored in it. There is no way to recover it."
      >
        <DeleteAccount />
      </SettingsSection>
    </PageContainer>
  );
}
