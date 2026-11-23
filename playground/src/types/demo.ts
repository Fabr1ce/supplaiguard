export interface DemoFinding {
  id: string;
  type: string;
  ruleId: string;
  severity: string;
  component: string;
  source: string;
  why: string;
  advisories: number;
  currentVersion: string;
  recommendedVersion: string;
}

/**
 * A demo card. The public demos carry the scanner's real expected findings. A private demo (see "Private Demo" in the
 * README) carries ONLY id, name, description and `private: true`: its contents are deliberately not described here.
 */
export interface Demo {
  id: string;
  name: string;
  description: string;
  /** True for a demo that runs in a separate private repository. Such an entry has none of the fields below. */
  private?: boolean;
  categories?: string[];
  bySeverity?: Record<string, number>;
  scannerVersion?: string;
  findings?: DemoFinding[];
}
