/**
 * Shared types for benchmark results
 * Used by bench/collect.ts and bench/generate-dashboard.ts
 */

export interface SingleBenchResult {
  name: string;
  rps: number;
  avgMs: number;
  totalMs?: number;
  errors: number;
}

export interface BenchTestGroup {
  name: string;
  results: SingleBenchResult[];
}

export interface BenchmarkSnapshot {
  timestamp: string;
  commit: string;
  branch: string;
  groups: BenchTestGroup[];
}
