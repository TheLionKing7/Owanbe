import { useState, type FormEvent } from "react";
import { useNavigate } from "@/lib/router";
import { Search, Sparkles } from "lucide-react";
import { POPULAR_SEARCHES } from "@/data/home";

export function Hero() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const plan = (q: string) => {
    const trimmed = q.trim();
    navigate(trimmed ? `/host/plan?q=${encodeURIComponent(trimmed)}` : "/host/plan");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    plan(query);
  };

  return (
    <section aria-labelledby="hero-title" className="relative lg:min-h-[492px]">
      {/* Hero photography: desktop sits behind the header on the right, mobile stacks below the copy. */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 top-0 hidden h-[490px] w-[min(806px,52.5vw)] lg:block"
        style={{
          WebkitMaskImage: "linear-gradient(to right, transparent 0%, #000 14%)",
          maskImage: "linear-gradient(to right, transparent 0%, #000 14%)",
        }}
      >
        <img src="/images/hero.webp" alt="" width={806} height={490} fetchPriority="high" className="h-full w-full object-cover object-[35%_center]" />
      </div>

      <div className="relative z-10 px-4 pt-8 sm:px-6 lg:w-[48%] lg:px-[54px] lg:pr-0 lg:pt-[162px] xl:w-[57%]">
        <p className="inline-flex items-center gap-[3px]">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-[#FFD45E] to-[#F8AC00] shadow-sm">
            <Sparkles aria-hidden className="h-4 w-4 fill-white stroke-white" />
          </span>
          <span className="rounded-full bg-gradient-to-r from-[#9FDCE3] via-[#D9CBE5] to-[#F2BDD9] px-[11px] py-[5px] text-[13.5px] font-medium text-plum-950">
            AI-Powered Celebration Commerce
          </span>
        </p>

        <h1 id="hero-title" className="mt-4 font-display text-[44px] font-bold leading-[1.02] text-plum-950 sm:text-[58px] lg:text-[36px] xl:mt-[12px] xl:text-[58px] 2xl:text-[63px]">
          Plan. Source. <span className="text-plum-500">Celebrate.</span>
        </h1>

        <p className="mt-4 max-w-[560px] text-[17px] leading-[1.32] tracking-[-0.003em] text-[#1F1626] sm:text-[19.5px] xl:mt-[10px] xl:max-w-[590px] xl:tracking-[-0.008em]">
          From traditional weddings to grand parties, Ówàńbè helps you plan meaningful events, discover trusted vendors, and bring your celebration to life — with the power of AI.
        </p>

        <form role="search" onSubmit={onSubmit} className="mt-6 flex h-14 w-full max-w-[629px] items-center rounded-full bg-white pl-5 shadow-search xl:mt-[24px] xl:pl-[28px]">
          <Search aria-hidden className="h-[21px] w-[21px] shrink-0 stroke-[2.25] text-plum-900" />
          <label htmlFor="hero-search" className="sr-only">What kind of celebration are you planning?</label>
          <input
            id="hero-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What kind of celebration are you planning?"
            className="h-full min-w-0 flex-1 bg-transparent pl-[15px] pr-2 text-[15.5px] text-ink placeholder:text-[13.5px] placeholder:text-[#665A74] focus:outline-none sm:placeholder:text-[15.5px]"
          />
          <button type="submit" className="btn-primary h-14 shrink-0 px-5 text-[15px] xl:w-[167px]">
            Plan with AI <Sparkles aria-hidden className="h-[15px] w-[15px] fill-gold stroke-gold" />
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-x-[9px] gap-y-2 pb-6 xl:mt-[9px] xl:pl-1 xl:pb-0">
          <span className="mr-[3px] text-[14px] font-medium text-plum-950">Popular searches:</span>
          {POPULAR_SEARCHES.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => plan(label)}
              className={`h-[26px] rounded-full border border-plum-900/[0.06] bg-white px-3 text-[12px] font-medium shadow-[0_2px_6px_-3px_rgba(65,11,82,0.25)] transition-colors hover:bg-plum-100 ${i === POPULAR_SEARCHES.length - 1 ? "text-[#57305A]" : "text-plum-950"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <img src="/images/hero.webp" alt="Guests in purple and blue gele and agbada celebrating at an Ówàńbè" width={806} height={490} className="relative mt-2 block max-h-[460px] w-full object-cover object-[35%_30%] lg:hidden" />
    </section>
  );
}
