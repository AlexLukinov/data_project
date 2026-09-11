/**
 * The shapes the tier-3 panels read (plan F.10). Separate from the components because
 * `<script setup>` has no exports, and both the app and the tests need these names.
 *
 * They mirror `analysis/pool/reconstruct.py` and `analysis/pool/realization.py` field for
 * field, in the wire's snake_case, so a panel never has to be told how to rename anything.
 */

/** One 169-combo class of a reconstructed range. */
export interface EstimatedClass {
  readonly hand_class: string;
  /** The class's share of the prior that was sent. */
  readonly prior: number;
  readonly posterior: number;
  /** 1 means "takes this action as often as the node's average"; above 1 means more often. */
  readonly likelihood: number;
  readonly action_rate: number;
  /** Revealed decisions of this class at the node. */
  readonly sample_size: number;
  /** The sample was too thin to reweight, so the prior was left exactly alone. */
  readonly fallback: boolean;
}

/** What one holding took away from a node. The numbers are null under the bucket threshold. */
export interface RealizationRow {
  readonly hand_class: string;
  readonly sample_size: number;
  readonly mean_net_bb: number | null;
  readonly mean_pot_bb: number | null;
  /** EV as a share of the pot. EQR is this divided by the hand's equity. */
  readonly realized: number | null;
}

/**
 * EQR from the pool's own realization and an equity we computed, or `null` when either half is
 * missing. Never a number invented from one of them: an EQR without an equity is not an EQR.
 */
export function poolEqr(realized: number | null, equity: number | null): number | null {
  if (realized === null || equity === null || equity <= 0) return null;
  return realized / equity;
}
