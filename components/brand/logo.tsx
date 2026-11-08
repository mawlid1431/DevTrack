import { cn } from "@/lib/utils";

/**
 * The DevTrack "Board" mark (brand/DevTrack-Brand-Guidelines.pdf, section 02).
 *
 * A bold D holding three rising columns: to do, doing, done. The navy parts
 * follow `--logo` (Deep Navy on light, white on navy dark mode); the last
 * column is always Done Green. Below 32 px the simplified two-column mark is
 * used, as the guidelines require. The mark never carries text: when the
 * name is needed, set "DevTrack" next to it in Inter SemiBold (see
 * <BrandName>).
 */
export function Logo({
  size = 24,
  className,
  title = "DevTrack",
}: {
  size?: number;
  className?: string;
  /** Accessible name; pass "" when a visible "DevTrack" label sits next to it. */
  title?: string;
}) {
  const small = size < 32;
  return (
    <svg
      viewBox="0 0 74 72"
      width={size}
      height={(size * 72) / 74}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0 text-[var(--logo)]", className)}
    >
      {small ? (
        <>
          <path
            fillRule="evenodd"
            fill="currentColor"
            d="M0 0H38A36 36 0 0 1 38 72H0Z M15 15H38A21 21 0 0 1 38 57H15Z"
          />
          <rect x="22" y="35" width="10" height="16" fill="currentColor" />
          <rect x="36" y="23" width="10" height="28" fill="var(--brand-green)" />
        </>
      ) : (
        <>
          <path
            fillRule="evenodd"
            fill="currentColor"
            d="M0 0H38A36 36 0 0 1 38 72H0Z M13 13H38A23 23 0 0 1 38 59H13Z"
          />
          <rect x="19" y="40" width="7" height="13" rx="1.5" fill="currentColor" />
          <rect x="30" y="31" width="7" height="22" rx="1.5" fill="currentColor" />
          <rect x="41" y="21" width="7" height="32" rx="1.5" fill="var(--brand-green)" />
        </>
      )}
    </svg>
  );
}

/** "DevTrack" as text, set the brand way: Inter SemiBold, separate from the mark. */
export function BrandName({ className }: { className?: string }) {
  return <span className={cn("font-semibold tracking-tight", className)}>DevTrack</span>;
}
