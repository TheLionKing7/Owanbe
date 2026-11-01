import { Hero } from "@/components/home/Hero";
import { FeatureStrip } from "@/components/home/FeatureStrip";
import { ExploreCategories } from "@/components/home/ExploreCategories";
import { FeaturedVendors } from "@/components/home/FeaturedVendors";
import { DifferenceCard } from "@/components/home/DifferenceCard";
import { AnkaraBand } from "@/components/home/AnkaraBand";

export default function Home() {
  return (
    <>
      <Hero />
      <FeatureStrip />
      <div className="mx-4 mt-5 grid gap-5 sm:mx-6 lg:mx-8 lg:mt-[21px] lg:grid-cols-[minmax(0,290fr)_15fr_minmax(0,793fr)_23fr_minmax(0,351fr)] lg:gap-0 xl:auto-rows-[318px] lg:[&>*:nth-child(2)]:col-start-3 lg:[&>*:nth-child(3)]:col-start-5">
        <ExploreCategories />
        <FeaturedVendors />
        <DifferenceCard />
      </div>
      <AnkaraBand />
    </>
  );
}
