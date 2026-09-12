import { roundOptions } from "@/lib/benchmark/round";

interface RoundPickerProps {
  value: string;
  onChange: (round: string) => void;
  includeAll?: boolean;
  includeLegacy?: boolean;
  className?: string;
}

/** Methodology-round selector shared by the community feed and leaderboard.
 * Values: "all" | a round version | "legacy" (rows with no spec_version). */
export function RoundPicker({ value, onChange, includeAll, includeLegacy, className = "" }: RoundPickerProps) {
  return (
    <label className={`inline-flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground ${className}`}>
      Round
      <select
        aria-label="Round"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-secondary/40 px-1.5 py-0.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {roundOptions({ includeAll, includeLegacy }).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
