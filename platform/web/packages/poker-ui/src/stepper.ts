/**
 * The shape `StepperNav` walks. A separate module because `<script setup>` has no exports of its
 * own, and the app builds this list from its own step definitions.
 */

export interface StepLabel {
  readonly step: number;
  readonly title: string;
}
