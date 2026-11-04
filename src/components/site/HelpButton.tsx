import { Link } from "@/lib/router";
import { MessageSquareMore } from "lucide-react";

export function HelpButton() {
  return (
    <Link
      to="/help"
      className="fixed bottom-4 right-4 z-40 inline-flex h-[38px] items-center gap-2 rounded-full bg-[#2E0B3C] pl-[12px] pr-[14px] text-[13.5px] font-semibold text-white shadow-pill transition-colors hover:bg-plum-800 lg:bottom-[26px] lg:right-[22px]"
    >
      <MessageSquareMore aria-hidden className="h-[19px] w-[19px] fill-white stroke-[#2E0B3C]" />
      Need Help?
    </Link>
  );
}
