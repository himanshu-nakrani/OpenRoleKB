import Link from "next/link";
import { MascotSvg } from "@/components/MascotSvg";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6 text-center">
      <MascotSvg className="w-[120px] opacity-60" />
      <h1 className="text-display font-medium font-display-opsz-display">
        We couldn&apos;t find that page.
      </h1>
      <p className="text-small text-ink-soft max-w-sm">
        The job you&apos;re looking for might have expired, or the link might be wrong.
      </p>
      <Link
        href="/"
        className="px-5 py-2 rounded-full bg-accent-dark text-accent-text text-small font-medium hover:brightness-110 active:brightness-90 active:scale-[0.98] transition-all duration-120"
      >
        Back to search
      </Link>
    </div>
  );
}
