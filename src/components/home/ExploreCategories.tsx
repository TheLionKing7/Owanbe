import { Link } from "react-router-dom";
import { ArrowRight, ChevronRight } from "lucide-react";
import { CATEGORIES } from "@/data/home";

function BurstIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-[22px] w-[22px]">
      {[
        ["#F8AC00", 0],
        ["#E30974", 45],
        ["#6B1E8E", 90],
        ["#FB6335", 135],
        ["#F8AC00", 180],
        ["#E30974", 225],
        ["#6B1E8E", 270],
        ["#FB6335", 315],
      ].map(([c, r]) => (
        <rect key={r as number} x="10.6" y="1.5" width="2.8" height="7.5" rx="1.4" fill={c as string} transform={`rotate(${r} 12 12)`} />
      ))}
      <circle cx="12" cy="12" r="1.8" fill="#6B1E8E" />
    </svg>
  );
}

export function ExploreCategories() {
  return (
    <section aria-labelledby="categories-title" className="surface flex flex-col pb-[14px] pl-[25px] pr-[20px] pt-[11px]">
      <h2 id="categories-title" className="flex items-center gap-[10px] whitespace-nowrap font-display text-[clamp(17px,1.3vw,20px)] font-bold text-[#2B0A4D]">
        <BurstIcon />
        Explore Categories
      </h2>
      <ul className="mt-[8px]">
        {CATEGORIES.map(({ label, slug, icon: Icon, color }) => (
          <li key={slug} className="border-t border-plum-900/[0.08] first:border-t-0">
            <Link to={`/discover?category=${slug}`} className="group flex h-[37px] items-center gap-[12px] text-[14px] font-medium text-[#1F0D2A] hover:text-plum-600">
              <span className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full ${color}`}>
                <Icon aria-hidden className="h-[14px] w-[14px] stroke-[2.25] text-white" />
              </span>
              <span className="flex-1 whitespace-nowrap">{label}</span>
              <ChevronRight aria-hidden className="h-[17px] w-[17px] shrink-0 stroke-[2.25] text-[#9C94A6] transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/discover" className="mx-auto mt-auto inline-flex pb-[4px] pt-[8px] items-center gap-[6px] text-[13.5px] font-semibold text-[#4A0B5A] hover:text-plum-500">
        View All Categories <ArrowRight aria-hidden className="h-4 w-4 stroke-[2.25]" />
      </Link>
    </section>
  );
}
