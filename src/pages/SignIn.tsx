import { Navigate, useSearchParams } from "@/lib/router";
import { RequireAuth } from "@/components/auth/RequireAuth";

/** /sign-in and /sign-up: run the Auth0 flow, then continue to ?next= (default: Host house). */
export default function SignIn({ signup = false }: { signup?: boolean }) {
  const [params] = useSearchParams();
  const next = params.get("next");
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/host";
  return (
    <RequireAuth signup={signup}>
      <Navigate to={target} replace />
    </RequireAuth>
  );
}
