import type { HandsApi } from '../hands/api';
import { createHandsApi } from '../hands/api';
import { useApi } from './useApi';

/** The hand endpoints bound to the session's fetcher (plan F.7). */
export function useHands(): HandsApi {
  return createHandsApi(useApi());
}
