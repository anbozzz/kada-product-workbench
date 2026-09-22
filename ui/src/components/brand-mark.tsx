import { cn } from "@/lib/utils"

export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}favicon.svg`}
      alt=""
      aria-hidden="true"
      width={128}
      height={128}
      className={cn("size-9 shrink-0", className)}
    />
  )
}
