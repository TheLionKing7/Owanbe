import { Link, useLocation } from "@/lib/router";
import { ArrowRight } from "lucide-react";

const TITLES: Record<string, { title: string; body: string }> = {
  "/discover": { title: "Discover vendors", body: "Search and browse trusted celebration vendors. Public discovery arrives with the discovery feature." },
  "/culture": { title: "Ówàńbè culture", body: "Guides to Yoruba celebrations, aso-ebi and ceremony etiquette." },
  "/about": { title: "About Ówàńbè", body: "Rooted in culture. Connected by community. Made easier with technology." },
  "/help": { title: "Help Centre", body: "Answers, support and trust & safety information." },
  "/get-started": { title: "Get started", body: "Choose how you'll use Ówàńbè: plan a celebration or grow your business." },
};

export default function PlaceholderPage() {
  const { pathname } = useLocation();
  const base = `/${pathname.split("/")[1] ?? ""}`;
  const page = TITLES[base] ?? { title: "Coming soon", body: "This page is part of the Ówàńbè roadmap." };
  return (
    <section className="mx-4 mb-24 mt-10 xl:mt-[170px] max-w-3xl sm:mx-6 lg:mx-[54px]">
      <h1 className="font-display text-4xl font-bold text-plum-950 sm:text-5xl">{page.title}</h1>
      <p className="mt-4 text-lg text-ink-muted">{page.body}</p>
      {base === "/get-started" ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link to="/sign-up?next=/host" className="surface flex min-h-[48px] items-center justify-between p-6 font-semibold text-plum-800">
            I'm planning a celebration <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/sign-up?next=/vendor" className="surface flex min-h-[48px] items-center justify-between p-6 font-semibold text-plum-800">
            I'm a vendor <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <Link to="/" className="btn-primary mt-8 h-12 px-6">Back to home</Link>
      )}
    </section>
  );
}
