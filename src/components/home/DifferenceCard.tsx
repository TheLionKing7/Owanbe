import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

export function DifferenceCard() {
  return (
    <section
      aria-labelledby="difference-title"
      className="relative isolate flex min-h-[318px] xl:h-[318px] flex-col overflow-hidden rounded-[18px] bg-[#3A0548] px-[28px] pt-[34px] text-white shadow-card"
    >
      <img
        src="/images/cta.webp"
        alt=""
        aria-hidden
        width={350}
        height={317}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 -z-10 h-full w-full object-cover object-right"
      />
      <h2 id="difference-title" className="max-w-[175px] font-display text-[28px] font-semibold leading-[1.13] tracking-[-0.005em]">
        Experience the Ówàńbè Difference
      </h2>
      <p className="mt-[14px] max-w-[215px] text-[14.5px] leading-[1.4] text-white/95">
        Smart planning. Trusted vendors. A celebration like no other.
      </p>
      <Link
        to="/host/plan"
        className="mt-[18px] inline-flex h-[42px] w-fit items-center gap-[10px] rounded-full bg-gold px-[22px] text-[14.5px] font-semibold text-[#1E0A2B] shadow-[0_8px_18px_-8px_rgba(248,172,0,0.8)] transition-colors hover:bg-[#FFBC1F]"
      >
        Start Planning <ArrowRight aria-hidden className="h-4 w-4 stroke-[2.5]" />
      </Link>
    </section>
  );
}
