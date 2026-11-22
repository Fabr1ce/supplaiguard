import { CheckCircle2, CircleDashed, Loader2, XCircle, Ban, Clock } from "lucide-react";
import { OUTCOME_LABEL, type Outcome } from "../../services/format";

const STYLE: Record<Outcome, { cls: string; Icon: typeof Clock; spin?: boolean }> = {
  ready: { cls: "text-mute border-line", Icon: CircleDashed },
  queued: { cls: "text-warn border-warn/40", Icon: Clock },
  in_progress: { cls: "text-green border-green/40", Icon: Loader2, spin: true },
  success: { cls: "text-ok border-ok/40", Icon: CheckCircle2 },
  failure: { cls: "text-bad border-bad/40", Icon: XCircle },
  cancelled: { cls: "text-mute border-line", Icon: Ban },
};

export default function StatusIndicator({ outcome }: { outcome: Outcome }) {
  const { cls, Icon, spin } = STYLE[outcome];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`} role="status">
      <Icon className={`h-3.5 w-3.5 ${spin ? "animate-spin" : ""}`} aria-hidden />
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}
