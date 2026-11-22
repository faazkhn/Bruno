export interface Settings {
  windowDays: number;
  minCount: number;
  minPeople: number;
  /** W: how long after the trigger a human action still counts */
  windowHours: number;
  minTriggerCoverage: number;
  maxMedianDelayHours: number;
  minGain: number;
  maxClauses: number;
  minHoldoutPositives: number;
  minCoverage: number;
  top: number;
  /** 'now' or 'lastActivity' (seeded/old projects: window ends at the last event) */
  anchor: 'now' | 'lastActivity';
  excludedFields: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  windowDays: 90,
  minCount: 20,
  minPeople: 2,
  windowHours: 48,
  minTriggerCoverage: 0.6,
  maxMedianDelayHours: 8,
  minGain: 0.02,
  maxClauses: 3,
  minHoldoutPositives: 10,
  minCoverage: 0.8,
  top: 10,
  anchor: 'now',
  excludedFields: [],
};

export interface Range { from: number; to: number }
