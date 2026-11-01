import { Link } from "react-router-dom";
import type { ReactNode } from "react";

export function AuthNotice({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section role="status" aria-live="polite" className="mx-auto mt-16 max-w-lg rounded-3xl bg-white p-8 text-center shadow-card">
      <h1 className="font-display text-3xl font-bold text-plum-950">{title}</h1>
      <div className="mt-3 text-ink-muted">{children}</div>
      <div className="mt-6 flex justify-center gap-3">
        {action}
        <Link to="/" className="btn-outline h-12 px-6">Back to home</Link>
      </div>
    </section>
  );
}
