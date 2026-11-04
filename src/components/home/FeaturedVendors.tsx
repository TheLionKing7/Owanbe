import { useState } from "react";
import { Link } from "@/lib/router";
import { ArrowRight, BadgeCheck, Crown, Heart, MapPin, Star } from "lucide-react";
import { FEATURED_VENDORS, type Vendor } from "@/data/home";

function VendorCard({ vendor }: { vendor: Vendor }) {
  const [saved, setSaved] = useState(false);
  return (
    <article className="flex flex-col overflow-hidden rounded-[10px] bg-white shadow-[0_6px_18px_-8px_rgba(65,11,82,0.22)] ring-1 ring-plum-900/[0.05]">
      <div className="relative">
        <img src={vendor.image} alt={vendor.imageAlt} width={241} height={136} loading="lazy" decoding="async" className="aspect-[241/136] w-full object-cover" />
        <button
          type="button"
          aria-label={saved ? `Remove ${vendor.name} from saved` : `Save ${vendor.name}`}
          aria-pressed={saved}
          onClick={() => setSaved((v) => !v)}
          className="absolute right-[8px] top-[8px] grid h-[26px] w-[26px] place-items-center rounded-full bg-[#5B3A5E]/45 backdrop-blur-[2px] transition-colors hover:bg-[#5B3A5E]/65"
        >
          <Heart aria-hidden className={`h-[15px] w-[15px] stroke-[2.5] ${saved ? "fill-[#E30974] stroke-[#E30974]" : "fill-white stroke-white"}`} />
        </button>
      </div>
      <div className="flex flex-1 flex-col px-[11px] pb-[11px] pt-[9px]">
        <h3 className="flex items-center gap-[5px] text-[14.5px] font-semibold text-[#0C0612]">
          {vendor.name}
          <BadgeCheck aria-label="Verified vendor" className="h-[16px] w-[16px] fill-verified stroke-white" />
        </h3>
        <p className="mt-[3px] flex items-center gap-[5px] text-[12px] text-[#3E2C4C]">
          <Star aria-hidden className="h-[13px] w-[13px] fill-gold stroke-gold" />
          <span className="font-semibold text-[#1F0D2A]">{vendor.rating}</span>
          <span>({vendor.reviews} reviews)</span>
        </p>
        <p className="mt-[3px] flex items-center gap-[5px] text-[11.5px] text-[#71677B]">
          <MapPin aria-hidden className="h-[12px] w-[12px] stroke-[2.25]" />
          {vendor.location}
        </p>
        <div className="mt-auto flex items-center justify-between pt-[6px]">
          <span className="inline-flex h-[23px] items-center gap-[5px] rounded-[5px] bg-gold-100 px-[7px] text-[11.5px] font-semibold text-[#180A17]">
            <Crown aria-hidden className="h-[13px] w-[13px] fill-gold stroke-[#E59A00]" />
            {vendor.badge}
          </span>
          <Link to={`/vendors/${vendor.id}`} className="btn-outline h-[24px] px-[12px] text-[12.5px] text-[#550772]">
            Contact
          </Link>
        </div>
      </div>
    </article>
  );
}

export function FeaturedVendors() {
  return (
    <section aria-labelledby="vendors-title" className="surface flex flex-col px-[17px] pb-[13px] pt-[6px]">
      <div className="flex items-center justify-between pl-[1px] pr-[8px]">
        <h2 id="vendors-title" className="flex items-center gap-[10px] whitespace-nowrap font-display text-[clamp(17px,1.3vw,20px)] font-bold text-[#0C0612]">
          <Crown aria-hidden className="h-[22px] w-[22px] fill-gold stroke-[#E59A00]" />
          Featured Vendors
        </h2>
        <Link to="/discover" className="inline-flex items-center gap-[6px] text-[13px] font-semibold text-[#3A045A] hover:text-plum-500">
          View All <ArrowRight aria-hidden className="h-[15px] w-[15px] stroke-[2.25]" />
        </Link>
      </div>
      <div className="mt-[11px] grid flex-1 grid-cols-1 gap-[18px] sm:grid-cols-3">
        {FEATURED_VENDORS.map((v) => (
          <VendorCard key={v.id} vendor={v} />
        ))}
      </div>
    </section>
  );
}
