import { Loader2, Play } from "lucide-react";

export default function LaunchButton({ onClick, loading, disabled, label = "Launch demo" }: { onClick: () => void; loading: boolean; disabled: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
      {loading ? "Launching…" : label}
    </button>
  );
}
