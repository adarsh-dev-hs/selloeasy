export * from './types';
export * from './client';
export * from './providers';
export * from './config';
export * from './prompts';

import { qualityGatePrompt } from './prompts/data-quality';
import { callScriptPrompt, emailDraftPrompt, whatsappDraftPrompt } from './prompts/outreach';
import { icpSuggestPrompt, profileGeneratePrompt } from './prompts/profile';
import { leadScorePrompt } from './prompts/scoring';
import { signalMatchPrompt } from './prompts/signals';

/** Registry of every prompt (documented in /docs/pipeline/prompts). */
export const PROMPTS = [
  profileGeneratePrompt,
  icpSuggestPrompt,
  signalMatchPrompt,
  leadScorePrompt,
  emailDraftPrompt,
  whatsappDraftPrompt,
  callScriptPrompt,
  qualityGatePrompt,
] as const;
