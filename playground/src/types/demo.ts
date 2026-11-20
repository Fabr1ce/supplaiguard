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

export interface Demo {
  id: string;
  name: string;
  description: string;
  categories: string[];
  bySeverity: Record<string, number>;
  scannerVersion: string;
  findings: DemoFinding[];
}
