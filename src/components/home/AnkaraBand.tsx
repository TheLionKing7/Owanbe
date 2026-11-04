/** Decorative ankara band that closes the homepage (from the approved mockup). */
export function AnkaraBand() {
  return (
    <div
      aria-hidden
      className="pointer-events-none h-[56px] w-full bg-[length:1536px_80px] bg-bottom bg-repeat-x sm:h-[80px] lg:bg-[length:100%_100%]"
      style={{ backgroundImage: "url(/images/ankara-band.webp)" }}
    />
  );
}
