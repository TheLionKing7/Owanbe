/**
 * Small adapter exposing the link/navigation API the Owanbe pages were written against,
 * backed by TanStack Router. Keeps page components unchanged after the migration.
 */
import { useEffect, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { Outlet, useParams as useTsParams, useRouter, useRouterState } from "@tanstack/react-router";

export { Outlet };

export function useLocation() {
  const loc = useRouterState({ select: (s) => s.location });
  const search = loc.searchStr && loc.searchStr !== "?" ? loc.searchStr : "";
  return { pathname: loc.pathname, search, hash: loc.hash };
}

export function useNavigate() {
  const router = useRouter();
  return (to: string, opts?: { replace?: boolean }) => {
    void router.navigate({ href: to, replace: opts?.replace ?? false });
  };
}

export function useParams(): Record<string, string | undefined> {
  return useTsParams({ strict: false }) as Record<string, string | undefined>;
}

export function useSearchParams(): [URLSearchParams] {
  const { search } = useLocation();
  return [new URLSearchParams(search)];
}

export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace: replace ?? false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, replace]);
  return null;
}

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className" | "children">;

function useClick(to: string, onClick?: (e: MouseEvent<HTMLAnchorElement>) => void) {
  const navigate = useNavigate();
  return (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!to.startsWith("/")) return;
    e.preventDefault();
    navigate(to);
  };
}

export function Link({ to, className, children, onClick, ...rest }: AnchorProps & { to: string; className?: string; children?: ReactNode }) {
  const handle = useClick(to, onClick);
  return (
    <a href={to} className={className} onClick={handle} {...rest}>
      {children}
    </a>
  );
}

export function NavLink({
  to,
  end,
  className,
  children,
  onClick,
  ...rest
}: AnchorProps & {
  to: string;
  end?: boolean;
  className?: string | ((s: { isActive: boolean }) => string);
  children?: ReactNode;
}) {
  const { pathname } = useLocation();
  const base = to.split("?")[0] ?? to;
  const isActive = end ? pathname === base : pathname === base || pathname.startsWith(base.endsWith("/") ? base : `${base}/`);
  const handle = useClick(to, onClick);
  return (
    <a
      href={to}
      aria-current={isActive ? "page" : undefined}
      className={typeof className === "function" ? className({ isActive }) : className}
      onClick={handle}
      {...rest}
    >
      {children}
    </a>
  );
}
