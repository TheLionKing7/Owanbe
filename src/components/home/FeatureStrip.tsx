import { FEATURES } from "@/data/home";

export function FeatureStrip() {
  return (
    <section aria-label="Why Ówàńbè" className="surface relative z-10 bg-white mx-4 grid grid-cols-2 sm:mx-6 sm:grid-cols-3 lg:mx-8 xl:h-[112px] xl:grid-cols-6 xl:rounded-[18px]">
      {FEATURES.map(({ title, description, icon: Icon }, i) => (
        <div
          key={title}
          className={`flex flex-col items-center px-3 py-4 text-center xl:my-[14px] xl:h-[84px] xl:pt-[3px] ${i > 0 ? "xl:border-l xl:border-plum-900/15" : ""}`}
        >
          <Icon aria-hidden className="h-[33px] w-[33px] shrink-0 fill-plum-800/10 stroke-[1.9] text-plum-800" />
          <h2 className="mt-[8px] text-[14px] font-semibold leading-tight text-[#24093A]">{title}</h2>
          <p className="mt-[3px] max-w-[150px] [text-wrap:balance] text-[12px] leading-[1.35] text-ink-muted xl:max-w-[170px]">{description}</p>
        </div>
      ))}
    </section>
  );
}
