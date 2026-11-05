import { Link } from "@/lib/router";

export default function NotFound() {
  return (
    <section className="mx-4 mb-24 mt-10 lg:mt-16 sm:mx-6 lg:mx-[54px]">
      <p className="text-sm font-semibold uppercase tracking-widest text-plum-500">404</p>
      <h1 className="mt-2 font-display text-4xl font-bold text-plum-950">We couldn't find that page</h1>
      <Link to="/" className="btn-primary mt-8 h-12 px-6">Back to home</Link>
    </section>
  );
}
