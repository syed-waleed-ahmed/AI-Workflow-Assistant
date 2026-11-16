"use client";

import { toast } from "sonner";
import { hardNavigate } from "@/lib/navigation";
import { useLogout } from "@/lib/query/hooks";

/** Signs out and reloads on the sign-in page, so no cached data outlives the session. */
export function useSignOut() {
  const logout = useLogout();
  const signOut = () =>
    logout.mutate(undefined, {
      onSuccess: () => hardNavigate("/login"),
      onError: () => toast.error("You could not be signed out. Please try again."),
    });
  return { signOut, pending: logout.isPending };
}
