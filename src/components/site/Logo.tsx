import { Link } from "react-router-dom";

interface LogoProps {
  className?: string;
  showTagline?: boolean;
}

export function Logo({ className = "", showTagline = true }: LogoProps) {
  return (
    <Link to="/" aria-label="Ówàńbè home" className={`inline-flex flex-col items-center ${className}`}>
      <img
        src="/images/owanbe-logo-wordmark.webp"
        alt="Ówàńbè"
        width={600}
        height={175}
        className="h-auto w-[180px] sm:w-[230px] xl:w-[288px]"
        decoding="async"
      />
      {showTagline && (
        <span className="mt-[9px] hidden whitespace-nowrap text-[11px] font-semibold tracking-[-0.005em] text-plum-950 sm:block">
          Your Celebration. Our Culture. Powered by AI.
        </span>
      )}
    </Link>
  );
}
