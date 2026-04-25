import { Badge } from "@/components/ui/badge";

const variant = (status: string | null | undefined) => {
  switch ((status ?? "").toLowerCase()) {
    case "open":
      return "success" as const;
    case "halted":
      return "warning" as const;
    case "closed":
      return "muted" as const;
    case "settled":
      return "secondary" as const;
    case "pending":
    default:
      return "outline" as const;
  }
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const label = status ?? "unknown";
  return (
    <Badge variant={variant(status)} className="capitalize">
      {label}
    </Badge>
  );
}
