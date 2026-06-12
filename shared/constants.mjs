export const LEGITIMACY_LEVELS = ['high', 'caution', 'suspicious'];
export const DEFAULT_LEGITIMACY = 'high';
export const BLOCKING_LEGITIMACY = new Set(['suspicious']);

export const LIVENESS_STATUSES = ['live', 'expired', 'bot_challenge', 'uncertain'];
export const DEFAULT_LIVENESS = null;
export const BLOCKING_LIVENESS = new Set(['expired']);

export const OUTCOME_STATUSES = [
  'pending',
  'responded',
  'oa',
  'interview',
  'offer',
  'rejected',
  'ghosted',
];
export const DEFAULT_OUTCOME_STATUS = 'pending';
