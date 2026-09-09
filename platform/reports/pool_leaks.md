# Pool statistics — GGPoker Rush & Cash 6-max

Extraction only. No strategy or exploit commentary.

## Dataset

| Field | Value |
|---|---|
| Source table | marts.player_hand_flags (54.56M player-hand rows) |
| Filter | dataset = 'population' (zero hero seats by construction) |
| Hands | 9,079,995 |
| Stakes | NL10 (2.97M hands) + NL25 (6.11M hands) — see assumptions |
| Game | GGPoker Rush & Cash, 6-max NL Hold'em, fast-fold |
| Date range | 2023-08-29 to 2025-05-13 |
| Low-N rule | preflop N<1000, postflop N<500 flagged |

## Cheat sheet

| Stat | Segment | Pool freq | N | Flag |
|---|---|---:|---:|---|
| VPIP | all seats | 22.8% | 54,443,970 | |
| PFR | all seats | 16.8% | 54,443,970 | |
| 3bet% | all seats | 7.9% | 20,816,312 | |
| Fold to 3bet (as opener) | all seats | 52.9% | 1,656,896 | |
| Fold to flop c-bet | srp · HU · IP | 36.6% | 310,869 |  |
| Fold to flop c-bet | srp · HU · OOP | 43.6% | 885,354 |  |
| Fold to turn c-bet | srp · HU · IP | 45.2% | 175,472 |  |
| Fold to turn c-bet | srp · HU · OOP | 50.2% | 331,159 |  |
| Fold to river c-bet | srp · HU · IP | 54.2% | 94,596 |  |
| Fold to river c-bet | srp · HU · OOP | 61.4% | 153,563 |  |
| WTSD | all | 30.3% | 7,243,924 |  |
| W$SD | all | 52.0% | 2,227,805 |  |
| WWSF | all | 47.6% | 7,243,924 |  |
| Aggression frequency — flop | all | 49.6% | 5,129,448 |  |
| Aggression frequency — turn | all | 49.9% | 3,214,322 |  |
| Aggression frequency — river | all | 50.8% | 1,899,381 |  |

## A. Preflop

| Stat | Segment | Pool freq | N | Flag | Note |
|---|---|---:|---:|---|---|
| VPIP | UTG | 19.2% | 9,073,994 |  |  |
| VPIP | HJ | 19.9% | 9,073,994 |  |  |
| VPIP | CO | 22.0% | 9,073,994 |  |  |
| VPIP | BU | 26.9% | 9,073,996 |  |  |
| VPIP | SB | 23.6% | 9,073,996 |  |  |
| VPIP | BB | 25.4% | 9,073,996 |  |  |
| PFR | UTG | 18.4% | 9,073,994 |  |  |
| PFR | HJ | 18.2% | 9,073,994 |  |  |
| PFR | CO | 19.2% | 9,073,994 |  |  |
| PFR | BU | 22.2% | 9,073,996 |  |  |
| PFR | SB | 16.9% | 9,073,996 |  |  |
| PFR | BB | 5.7% | 9,073,996 |  |  |
| RFI (raise first in) | UTG | 18.4% | 9,073,994 |  |  |
| RFI (raise first in) | HJ | 20.8% | 7,332,886 |  |  |
| RFI (raise first in) | CO | 25.7% | 5,755,373 |  |  |
| RFI (raise first in) | BU | 37.5% | 4,236,356 |  |  |
| RFI (raise first in) | SB | 39.1% | 2,617,778 |  |  |
| Open-limp% | UTG | 0.8% | 9,073,994 |  |  |
| Open-limp% | HJ | 0.7% | 7,332,886 |  |  |
| Open-limp% | CO | 0.7% | 5,755,373 |  |  |
| Open-limp% | BU | 0.7% | 4,236,356 |  |  |
| Open-limp% | SB | 3.5% | 2,617,778 |  |  |
| Cold-call% | HJ | 5.7% | 1,665,149 |  |  |
| Cold-call% | CO | 6.4% | 3,199,092 |  |  |
| Cold-call% | BU | 8.3% | 4,698,367 |  |  |
| 3bet% | HJ | 6.8% | 1,665,149 |  |  |
| 3bet% | CO | 7.9% | 3,085,680 |  |  |
| 3bet% | BU | 8.9% | 4,341,832 |  |  |
| 3bet% | SB | 8.3% | 5,571,036 |  |  |
| 3bet% | BB | 7.2% | 6,152,615 |  |  |
| Fold to 3bet (as opener) | UTG | 46.2% | 456,579 |  |  |
| Fold to 3bet (as opener) | HJ | 49.3% | 397,633 |  |  |
| Fold to 3bet (as opener) | CO | 54.5% | 354,423 |  |  |
| Fold to 3bet (as opener) | BU | 62.9% | 314,842 |  |  |
| Fold to 3bet (as opener) | SB | 58.2% | 131,479 |  |  |
| Fold to 3bet (as opener) | BB | 42.7% | 1,940 |  |  |
| Call 3bet (as opener) | UTG | 42.4% | 456,579 |  |  |
| Call 3bet (as opener) | HJ | 39.7% | 397,633 |  |  |
| Call 3bet (as opener) | CO | 35.2% | 354,423 |  |  |
| Call 3bet (as opener) | BU | 29.9% | 314,842 |  |  |
| Call 3bet (as opener) | SB | 31.2% | 131,479 |  |  |
| Call 3bet (as opener) | BB | 45.7% | 1,940 |  |  |
| Squeeze% | CO | 6.5% | 95,059 |  |  |
| Squeeze% | BU | 7.1% | 282,498 |  |  |
| Squeeze% | SB | 6.6% | 613,097 |  |  |
| Squeeze% | BB | 6.3% | 983,778 |  |  |
| 4bet% | CO | 2.3% | 113,412 |  |  |
| 4bet% | BU | 2.6% | 353,887 |  |  |
| 4bet% | SB | 2.7% | 730,321 |  |  |
| 4bet% | BB | 2.8% | 1,174,095 |  |  |
| Fold to 4bet (as 3bettor) | HJ | 48.7% | 24,442 |  |  |
| Fold to 4bet (as 3bettor) | CO | 51.1% | 51,070 |  |  |
| Fold to 4bet (as 3bettor) | BU | 52.6% | 77,075 |  |  |
| Fold to 4bet (as 3bettor) | SB | 51.2% | 60,032 |  |  |
| Fold to 4bet (as 3bettor) | BB | 43.1% | 46,396 |  |  |
| Call 4bet (as 3bettor) | HJ | 38.2% | 24,442 |  |  |
| Call 4bet (as 3bettor) | CO | 36.8% | 51,070 |  |  |
| Call 4bet (as 3bettor) | BU | 36.1% | 77,075 |  |  |
| Call 4bet (as 3bettor) | SB | 32.6% | 60,032 |  |  |
| Call 4bet (as 3bettor) | BB | 38.4% | 46,396 |  |  |
| Limp-fold% | UTG | 30.0% | 42,671 |  | denom = limped AND faced a raise behind |
| Limp-fold% | HJ | 29.9% | 27,083 |  | denom = limped AND faced a raise behind |
| Limp-fold% | CO | 29.9% | 16,735 |  | denom = limped AND faced a raise behind |
| Limp-fold% | BU | 31.5% | 8,977 |  | denom = limped AND faced a raise behind |
| Limp-fold% | SB | 51.4% | 23,843 |  | denom = limped AND faced a raise behind |
| Limp-call% | UTG | 63.9% | 42,671 |  | denom = limped AND faced a raise behind |
| Limp-call% | HJ | 65.3% | 27,083 |  | denom = limped AND faced a raise behind |
| Limp-call% | CO | 66.2% | 16,735 |  | denom = limped AND faced a raise behind |
| Limp-call% | BU | 65.2% | 8,977 |  | denom = limped AND faced a raise behind |
| Limp-call% | SB | 44.7% | 23,843 |  | denom = limped AND faced a raise behind |
| Limp-raise% | UTG | 6.1% | 42,671 |  | denom = limped AND faced a raise behind |
| Limp-raise% | HJ | 4.8% | 27,083 |  | denom = limped AND faced a raise behind |
| Limp-raise% | CO | 3.8% | 16,735 |  | denom = limped AND faced a raise behind |
| Limp-raise% | BU | 3.3% | 8,977 |  | denom = limped AND faced a raise behind |
| Limp-raise% | SB | 3.9% | 23,843 |  | denom = limped AND faced a raise behind |
| Fold to steal | SB vs BTN | 80.9% | 1,615,010 |  | denom = in blind, faced a CO/BU/SB open |
| Fold to steal | BB vs BTN | 62.7% | 1,428,468 |  | denom = in blind, faced a CO/BU/SB open |
| Fold to steal | SB vs CO | 83.2% | 1,336,028 |  | denom = in blind, faced a CO/BU/SB open |
| Fold to steal | BB vs CO | 65.6% | 1,220,547 |  | denom = in blind, faced a CO/BU/SB open |
| Fold to steal | BB vs SB | 58.1% | 1,045,411 |  | denom = in blind, faced a CO/BU/SB open |
| Call vs steal | SB vs BTN | 7.5% | 1,615,010 |  | denom = in blind, faced a CO/BU/SB open |
| Call vs steal | BB vs BTN | 28.4% | 1,428,468 |  | denom = in blind, faced a CO/BU/SB open |
| Call vs steal | SB vs CO | 8.2% | 1,336,028 |  | denom = in blind, faced a CO/BU/SB open |
| Call vs steal | BB vs CO | 28.3% | 1,220,547 |  | denom = in blind, faced a CO/BU/SB open |
| Call vs steal | BB vs SB | 29.4% | 1,045,411 |  | denom = in blind, faced a CO/BU/SB open |
| 3bet vs steal | SB vs BTN | 11.6% | 1,615,010 |  | denom = in blind, faced a CO/BU/SB open |
| 3bet vs steal | BB vs BTN | 8.9% | 1,428,468 |  | denom = in blind, faced a CO/BU/SB open |
| 3bet vs steal | SB vs CO | 8.6% | 1,336,028 |  | denom = in blind, faced a CO/BU/SB open |
| 3bet vs steal | BB vs CO | 6.1% | 1,220,547 |  | denom = in blind, faced a CO/BU/SB open |
| 3bet vs steal | BB vs SB | 12.5% | 1,045,411 |  | denom = in blind, faced a CO/BU/SB open |
| 3bet% by relative position | OOP vs opener | 7.3% | 10,678,240 |  | IP/OOP from postflop acting order vs the opener |
| 3bet% by relative position | IP vs opener | 8.6% | 10,138,072 |  | IP/OOP from postflop acting order vs the opener |
| 3bet% blinds vs late | blinds vs BTN | 10.3% | 3,043,478 |  |  |
| 3bet% blinds vs late | blinds vs CO | 7.4% | 2,556,575 |  |  |
| 3bet% blinds vs late | non-blind vs CO | 10.9% | 1,499,275 |  |  |
| 3bet% blinds vs late | blinds vs SB | 12.5% | 1,045,411 |  |  |

## B. Flop

| Stat | Segment | Pool freq | N | Flag | Note |
|---|---|---:|---:|---|---|
| C-bet flop (as PFR) | srp · HU | 56.5% | 2,118,130 |  |  |
| C-bet flop (as PFR) | 3bet · HU | 70.8% | 592,155 |  |  |
| C-bet flop (as PFR) | srp · multiway | 36.1% | 340,397 |  |  |
| C-bet flop (as PFR) | 4bet · HU | 61.8% | 89,121 |  |  |
| C-bet flop (as PFR) | 3bet · multiway | 49.4% | 50,071 |  |  |
| C-bet flop (as PFR) | 5bet_plus · HU | 4.8% | 20,121 |  |  |
| C-bet flop (as PFR) | 4bet · multiway | 38.2% | 2,780 |  |  |
| C-bet flop (as PFR) | 5bet_plus · multiway | 2.0% | 1,022 |  |  |
| C-bet flop — size mix | small | 100.0% | 949,944 |  | share of c-bets in each size bucket (freq column = 100% by construction; read N) |
| C-bet flop — size mix | mid | 100.0% | 585,259 |  | share of c-bets in each size bucket (freq column = 100% by construction; read N) |
| C-bet flop — size mix | large | 100.0% | 234,683 |  | share of c-bets in each size bucket (freq column = 100% by construction; read N) |
| C-bet flop — size mix | pot | 100.0% | 30,791 |  | share of c-bets in each size bucket (freq column = 100% by construction; read N) |
| C-bet flop — size mix | overbet | 100.0% | 19,499 |  | share of c-bets in each size bucket (freq column = 100% by construction; read N) |
| Fold to flop c-bet | srp · HU · OOP | 43.6% | 885,354 |  |  |
| Fold to flop c-bet | srp · HU · IP | 36.6% | 310,869 |  |  |
| Fold to flop c-bet | 3bet · HU · OOP | 38.4% | 223,654 |  |  |
| Fold to flop c-bet | 3bet · HU · IP | 35.5% | 195,452 |  |  |
| Fold to flop c-bet | srp · MW · OOP | 60.4% | 177,815 |  |  |
| Fold to flop c-bet | srp · MW · IP | 52.7% | 77,594 |  |  |
| Fold to flop c-bet | 3bet · MW · OOP | 58.3% | 37,269 |  |  |
| Fold to flop c-bet | 4bet · HU · IP | 28.8% | 36,147 |  |  |
| Fold to flop c-bet | 4bet · HU · OOP | 31.9% | 18,889 |  |  |
| Fold to flop c-bet | 3bet · MW · IP | 56.2% | 12,928 |  |  |
| Fold to flop c-bet | 4bet · MW · OOP | 54.6% | 1,257 |  |  |
| Fold to flop c-bet | 4bet · MW · IP | 48.2% | 853 |  |  |
| Fold to flop c-bet | 5bet_plus · HU · OOP | 31.6% | 528 |  |  |
| Fold to flop c-bet | 5bet_plus · HU · IP | 28.1% | 445 | LOW-N — don't trust |  |
| Fold to flop c-bet | 5bet_plus · MW · OOP | 45.0% | 20 | LOW-N — don't trust |  |
| Fold to flop c-bet | 5bet_plus · MW · IP | 17.6% | 17 | LOW-N — don't trust |  |
| Fold to flop c-bet — by texture | two-tone/wet · OOP | 42.9% | 390,579 |  | SRP heads-up only, to keep the texture split clean |
| Fold to flop c-bet — by texture | dry-high · OOP | 45.0% | 162,291 |  | SRP heads-up only, to keep the texture split clean |
| Fold to flop c-bet — by texture | paired · OOP | 47.3% | 151,036 |  | SRP heads-up only, to keep the texture split clean |
| Fold to flop c-bet — by texture | two-tone/wet · IP | 36.4% | 136,902 |  | SRP heads-up only, to keep the texture split clean |
| Fold to flop c-bet — by texture | other · OOP | 39.5% | 96,111 |  | SRP heads-up only, to keep the texture split clean |
| Fold to flop c-bet — by texture | dry-high · IP | 38.1% | 57,891 |  | SRP heads-up only, to keep the texture split clean |
| Fold to flop c-bet — by texture | paired · IP | 39.2% | 52,987 |  | SRP heads-up only, to keep the texture split clean |
| Fold to flop c-bet — by texture | low-connected · OOP | 37.6% | 43,756 |  | SRP heads-up only, to keep the texture split clean |
| Fold to flop c-bet — by texture | monotone · OOP | 47.0% | 41,581 |  | SRP heads-up only, to keep the texture split clean |
| Fold to flop c-bet — by texture | other · IP | 31.8% | 33,055 |  | SRP heads-up only, to keep the texture split clean |
| Fold to flop c-bet — by texture | low-connected · IP | 30.1% | 16,241 |  | SRP heads-up only, to keep the texture split clean |
| Fold to flop c-bet — by texture | monotone · IP | 41.4% | 13,793 |  | SRP heads-up only, to keep the texture split clean |
| Fold to flop c-bet — by size faced | small | 39.2% | 997,979 |  |  |
| Fold to flop c-bet — by size faced | mid | 54.3% | 195,392 |  |  |
| Fold to flop c-bet — by size faced | large | 68.9% | 2,172 |  |  |
| Fold to flop c-bet — by size faced | pot | 82.9% | 680 |  |  |
| Raise flop c-bet | srp · HU | 9.9% | 1,196,223 |  | same denom as fold-to-c-bet |
| Raise flop c-bet | 3bet · HU | 9.4% | 419,106 |  | same denom as fold-to-c-bet |
| Raise flop c-bet | srp · multiway | 5.9% | 255,409 |  | same denom as fold-to-c-bet |
| Raise flop c-bet | 4bet · HU | 12.8% | 55,036 |  | same denom as fold-to-c-bet |
| Raise flop c-bet | 3bet · multiway | 7.5% | 50,197 |  | same denom as fold-to-c-bet |
| Raise flop c-bet | 4bet · multiway | 10.6% | 2,110 |  | same denom as fold-to-c-bet |
| Raise flop c-bet | 5bet_plus · HU | 14.2% | 973 |  | same denom as fold-to-c-bet |
| Raise flop c-bet | 5bet_plus · multiway | 8.1% | 37 | LOW-N — don't trust | same denom as fold-to-c-bet |
| Float-fold (call flop c-bet, fold turn) | srp · HU | 21.7% | 584,924 |  |  |
| Float-fold (call flop c-bet, fold turn) | 3bet · HU | 22.2% | 227,909 |  |  |
| Float-fold (call flop c-bet, fold turn) | srp · multiway | 25.0% | 93,387 |  |  |
| Float-fold (call flop c-bet, fold turn) | 4bet · HU | 20.4% | 31,969 |  |  |
| Float-fold (call flop c-bet, fold turn) | 3bet · multiway | 22.2% | 17,851 |  |  |
| Float-fold (call flop c-bet, fold turn) | 4bet · multiway | 18.5% | 753 |  |  |
| Float-fold (call flop c-bet, fold turn) | 5bet_plus · HU | 12.1% | 514 |  |  |
| Float-fold (call flop c-bet, fold turn) | 5bet_plus · multiway | 23.1% | 13 | LOW-N — don't trust |  |
| Donk-bet flop | srp · HU | 5.3% | 1,471,075 |  |  |
| Donk-bet flop | srp · multiway | 7.7% | 492,974 |  |  |
| Donk-bet flop | 3bet · HU | 4.0% | 317,871 |  |  |
| Donk-bet flop | limped · HU | 28.4% | 144,734 |  |  |
| Donk-bet flop | 3bet · multiway | 8.2% | 76,964 |  |  |
| Donk-bet flop | limped · multiway | 13.3% | 67,341 |  |  |
| Donk-bet flop | 4bet · HU | 4.1% | 41,999 |  |  |
| Donk-bet flop | 5bet_plus · HU | 0.4% | 19,530 |  |  |
| Donk-bet flop | 4bet · multiway | 10.2% | 3,894 |  |  |
| Donk-bet flop | 5bet_plus · multiway | 2.6% | 1,996 |  |  |
| Fold to donk (as PFR) | srp · HU | 42.2% | 221,543 |  |  |
| Fold to donk (as PFR) | srp · multiway | 61.6% | 84,652 |  |  |
| Fold to donk (as PFR) | 3bet · HU | 33.5% | 44,788 |  |  |
| Fold to donk (as PFR) | 3bet · multiway | 56.8% | 9,885 |  |  |
| Fold to donk (as PFR) | 4bet · HU | 29.8% | 6,427 |  |  |
| Fold to donk (as PFR) | 4bet · multiway | 44.7% | 608 |  |  |
| Fold to donk (as PFR) | 5bet_plus · HU | 11.1% | 144 | LOW-N — don't trust |  |
| Fold to donk (as PFR) | 5bet_plus · multiway | 7.4% | 54 | LOW-N — don't trust |  |
| Flop check-raise | srp · HU | 9.7% | 1,029,263 |  |  |
| Flop check-raise | srp · multiway | 5.2% | 286,364 |  |  |
| Flop check-raise | 3bet · HU | 10.4% | 255,749 |  |  |
| Flop check-raise | limped · HU | 3.8% | 43,405 |  |  |
| Flop check-raise | 3bet · multiway | 7.4% | 40,876 |  |  |
| Flop check-raise | limped · multiway | 3.1% | 26,263 |  |  |
| Flop check-raise | 4bet · HU | 15.4% | 23,577 |  |  |
| Flop check-raise | 4bet · multiway | 10.9% | 1,500 |  |  |
| Flop check-raise | 5bet_plus · HU | 17.9% | 585 |  |  |
| Flop check-raise | 5bet_plus · multiway | 5.7% | 53 | LOW-N — don't trust |  |
| Fold to flop raise (after betting) | srp · HU | 44.3% | 142,688 |  |  |
| Fold to flop raise (after betting) | 3bet · HU | 41.6% | 46,469 |  |  |
| Fold to flop raise (after betting) | srp · multiway | 45.3% | 25,075 |  |  |
| Fold to flop raise (after betting) | 4bet · HU | 32.9% | 8,292 |  |  |
| Fold to flop raise (after betting) | 3bet · multiway | 39.4% | 5,364 |  |  |
| Fold to flop raise (after betting) | limped · HU | 41.7% | 3,605 |  |  |
| Fold to flop raise (after betting) | limped · multiway | 40.4% | 1,761 |  |  |
| Fold to flop raise (after betting) | 4bet · multiway | 19.3% | 373 | LOW-N — don't trust |  |
| Fold to flop raise (after betting) | 5bet_plus · HU | 17.5% | 166 | LOW-N — don't trust |  |
| Fold to flop raise (after betting) | 5bet_plus · multiway | 0.0% | 7 | LOW-N — don't trust |  |

## C. Turn

| Stat | Segment | Pool freq | N | Flag | Note |
|---|---|---:|---:|---|---|
| Second barrel (turn c-bet) | srp · HU | 45.3% | 642,997 |  |  |
| Second barrel (turn c-bet) | 3bet · HU | 47.4% | 245,393 |  |  |
| Second barrel (turn c-bet) | srp · multiway | 46.0% | 80,158 |  |  |
| Second barrel (turn c-bet) | 4bet · HU | 47.8% | 35,173 |  |  |
| Second barrel (turn c-bet) | 3bet · multiway | 43.2% | 15,748 |  |  |
| Second barrel (turn c-bet) | 4bet · multiway | 38.0% | 731 |  |  |
| Second barrel (turn c-bet) | 5bet_plus · HU | 34.9% | 604 |  |  |
| Second barrel (turn c-bet) | 5bet_plus · multiway | 18.8% | 16 | LOW-N — don't trust |  |
| Second barrel — size mix | large | 100.0% | 195,317 |  | read N, not the frequency |
| Second barrel — size mix | mid | 100.0% | 129,360 |  | read N, not the frequency |
| Second barrel — size mix | small | 100.0% | 71,116 |  | read N, not the frequency |
| Second barrel — size mix | overbet | 100.0% | 42,268 |  | read N, not the frequency |
| Second barrel — size mix | pot | 100.0% | 30,829 |  | read N, not the frequency |
| Fold to turn c-bet | srp · HU · OOP | 50.2% | 331,159 |  |  |
| Fold to turn c-bet | srp · HU · IP | 45.2% | 175,472 |  |  |
| Fold to turn c-bet | 3bet · HU · IP | 42.0% | 83,935 |  |  |
| Fold to turn c-bet | 3bet · HU · OOP | 47.5% | 78,053 |  |  |
| Fold to turn c-bet | srp · MW · OOP | 61.5% | 65,826 |  |  |
| Fold to turn c-bet | srp · MW · IP | 54.5% | 34,191 |  |  |
| Fold to turn c-bet | 4bet · HU · IP | 37.3% | 14,967 |  |  |
| Fold to turn c-bet | 3bet · MW · OOP | 54.3% | 10,701 |  |  |
| Fold to turn c-bet | 4bet · HU · OOP | 40.1% | 6,639 |  |  |
| Fold to turn c-bet | 3bet · MW · IP | 52.1% | 4,309 |  |  |
| Fold to turn c-bet | 4bet · MW · OOP | 41.9% | 351 | LOW-N — don't trust |  |
| Fold to turn c-bet | 4bet · MW · IP | 47.2% | 231 | LOW-N — don't trust |  |
| Fold to turn c-bet | 5bet_plus · HU · OOP | 26.4% | 148 | LOW-N — don't trust |  |
| Fold to turn c-bet | 5bet_plus · HU · IP | 32.8% | 137 | LOW-N — don't trust |  |
| Fold to turn c-bet | 5bet_plus · MW · OOP | 44.4% | 9 | LOW-N — don't trust |  |
| Fold to turn c-bet | 5bet_plus · MW · IP | 80.0% | 5 | LOW-N — don't trust |  |
| Fold to turn c-bet — by size faced | small | 42.9% | 404,286 |  |  |
| Fold to turn c-bet — by size faced | mid | 54.2% | 385,146 |  |  |
| Fold to turn c-bet — by size faced | large | 67.3% | 15,822 |  |  |
| Fold to turn c-bet — by size faced | pot | 68.5% | 871 |  |  |
| Fold to turn c-bet — by size faced | overbet | 0.0% | 8 | LOW-N — don't trust |  |
| Turn probe (non-PFR bets after flop checked through) | srp · HU | 36.4% | 700,364 |  |  |
| Turn probe (non-PFR bets after flop checked through) | srp · multiway | 23.9% | 277,192 |  |  |
| Turn probe (non-PFR bets after flop checked through) | 3bet · HU | 34.4% | 128,261 |  |  |
| Turn probe (non-PFR bets after flop checked through) | limped · HU | 26.7% | 120,490 |  |  |
| Turn probe (non-PFR bets after flop checked through) | limped · multiway | 19.3% | 39,820 |  |  |
| Turn probe (non-PFR bets after flop checked through) | 3bet · multiway | 26.4% | 31,541 |  |  |
| Turn probe (non-PFR bets after flop checked through) | 4bet · HU | 14.2% | 27,658 |  |  |
| Turn probe (non-PFR bets after flop checked through) | 5bet_plus · HU | 0.4% | 19,004 |  |  |
| Turn probe (non-PFR bets after flop checked through) | 4bet · multiway | 12.4% | 2,214 |  |  |
| Turn probe (non-PFR bets after flop checked through) | 5bet_plus · multiway | 1.1% | 1,897 |  |  |
| Fold to turn probe (as PFR who checked) | srp · HU | 52.3% | 254,798 |  |  |
| Fold to turn probe (as PFR who checked) | srp · multiway | 69.8% | 66,210 |  |  |
| Fold to turn probe (as PFR who checked) | 3bet · HU | 45.3% | 44,074 |  |  |
| Fold to turn probe (as PFR who checked) | 3bet · multiway | 67.5% | 8,333 |  |  |
| Fold to turn probe (as PFR who checked) | 4bet · HU | 40.6% | 3,919 |  |  |
| Fold to turn probe (as PFR who checked) | 4bet · multiway | 54.0% | 274 | LOW-N — don't trust |  |
| Fold to turn probe (as PFR who checked) | 5bet_plus · HU | 27.6% | 76 | LOW-N — don't trust |  |
| Fold to turn probe (as PFR who checked) | 5bet_plus · multiway | 13.6% | 22 | LOW-N — don't trust |  |
| Delayed c-bet (PFR checks flop, bets turn) | srp · HU | 26.3% | 817,598 |  |  |
| Delayed c-bet (PFR checks flop, bets turn) | srp · multiway | 17.5% | 163,173 |  |  |
| Delayed c-bet (PFR checks flop, bets turn) | 3bet · HU | 29.5% | 154,693 |  |  |
| Delayed c-bet (PFR checks flop, bets turn) | 4bet · HU | 15.2% | 31,487 |  |  |
| Delayed c-bet (PFR checks flop, bets turn) | 3bet · multiway | 18.9% | 19,292 |  |  |
| Delayed c-bet (PFR checks flop, bets turn) | 5bet_plus · HU | 0.4% | 19,107 |  |  |
| Delayed c-bet (PFR checks flop, bets turn) | 4bet · multiway | 9.0% | 1,405 |  |  |
| Delayed c-bet (PFR checks flop, bets turn) | 5bet_plus · multiway | 0.5% | 994 |  |  |
| Fold to delayed c-bet | srp · HU | 55.1% | 199,635 |  |  |
| Fold to delayed c-bet | srp · multiway | 70.6% | 50,869 |  |  |
| Fold to delayed c-bet | 3bet · HU | 48.9% | 42,571 |  |  |
| Fold to delayed c-bet | 3bet · multiway | 66.9% | 6,388 |  |  |
| Fold to delayed c-bet | 4bet · HU | 41.0% | 4,519 |  |  |
| Fold to delayed c-bet | 4bet · multiway | 57.2% | 229 | LOW-N — don't trust |  |
| Fold to delayed c-bet | 5bet_plus · HU | 33.8% | 68 | LOW-N — don't trust |  |
| Fold to delayed c-bet | 5bet_plus · multiway | 50.0% | 10 | LOW-N — don't trust |  |
| Turn check-raise | srp · HU | 7.6% | 457,448 |  |  |
| Turn check-raise | srp · multiway | 5.8% | 133,412 |  |  |
| Turn check-raise | 3bet · HU | 10.9% | 125,660 |  |  |
| Turn check-raise | limped · HU | 3.7% | 23,242 |  |  |
| Turn check-raise | 3bet · multiway | 8.5% | 16,731 |  |  |
| Turn check-raise | 4bet · HU | 13.6% | 14,091 |  |  |
| Turn check-raise | limped · multiway | 4.0% | 11,771 |  |  |
| Turn check-raise | 4bet · multiway | 7.4% | 555 |  |  |
| Turn check-raise | 5bet_plus · HU | 13.1% | 191 | LOW-N — don't trust |  |
| Turn check-raise | 5bet_plus · multiway | 15.0% | 20 | LOW-N — don't trust |  |
| Fold to turn raise (after betting) | srp · HU | 46.8% | 71,233 |  |  |
| Fold to turn raise (after betting) | 3bet · HU | 40.7% | 26,449 |  |  |
| Fold to turn raise (after betting) | srp · multiway | 44.6% | 17,578 |  |  |
| Fold to turn raise (after betting) | 4bet · HU | 33.6% | 3,877 |  |  |
| Fold to turn raise (after betting) | 3bet · multiway | 35.8% | 2,990 |  |  |
| Fold to turn raise (after betting) | limped · HU | 43.9% | 2,410 |  |  |
| Fold to turn raise (after betting) | limped · multiway | 43.0% | 1,264 |  |  |
| Fold to turn raise (after betting) | 4bet · multiway | 35.1% | 114 | LOW-N — don't trust |  |
| Fold to turn raise (after betting) | 5bet_plus · HU | 26.1% | 46 | LOW-N — don't trust |  |
| Fold to turn raise (after betting) | 5bet_plus · multiway | 0.0% | 6 | LOW-N — don't trust |  |

## D. River

| Stat | Segment | Pool freq | N | Flag | Note |
|---|---|---:|---:|---|---|
| Triple barrel (river c-bet) | srp · HU | 40.4% | 240,233 |  |  |
| Triple barrel (river c-bet) | 3bet · HU | 41.6% | 80,951 |  |  |
| Triple barrel (river c-bet) | srp · multiway | 40.5% | 34,546 |  |  |
| Triple barrel (river c-bet) | 4bet · HU | 36.3% | 11,723 |  |  |
| Triple barrel (river c-bet) | 3bet · multiway | 35.8% | 5,699 |  |  |
| Triple barrel (river c-bet) | 4bet · multiway | 25.6% | 238 | LOW-N — don't trust |  |
| Triple barrel (river c-bet) | 5bet_plus · HU | 30.0% | 170 | LOW-N — don't trust |  |
| Triple barrel (river c-bet) | 5bet_plus · multiway | 60.0% | 5 | LOW-N — don't trust |  |
| Triple barrel — size mix | large | 100.0% | 48,840 |  | read N, not the frequency |
| Triple barrel — size mix | mid | 100.0% | 30,198 |  | read N, not the frequency |
| Triple barrel — size mix | overbet | 100.0% | 27,711 |  | read N, not the frequency |
| Triple barrel — size mix | small | 100.0% | 25,566 |  | read N, not the frequency |
| Triple barrel — size mix | pot | 100.0% | 18,769 |  | read N, not the frequency |
| Fold to river c-bet | srp · HU · OOP | 61.4% | 153,563 |  |  |
| Fold to river c-bet | srp · HU · IP | 54.2% | 94,596 |  |  |
| Fold to river c-bet | 3bet · HU · IP | 49.0% | 41,225 |  |  |
| Fold to river c-bet | 3bet · HU · OOP | 56.6% | 32,622 |  |  |
| Fold to river c-bet | srp · MW · OOP | 68.3% | 28,567 |  |  |
| Fold to river c-bet | srp · MW · IP | 58.4% | 17,119 |  |  |
| Fold to river c-bet | 4bet · HU · IP | 45.7% | 6,798 |  |  |
| Fold to river c-bet | 3bet · MW · OOP | 60.5% | 4,112 |  |  |
| Fold to river c-bet | 4bet · HU · OOP | 55.7% | 2,344 |  |  |
| Fold to river c-bet | 3bet · MW · IP | 54.6% | 1,742 |  |  |
| Fold to river c-bet | 4bet · MW · OOP | 50.0% | 106 | LOW-N — don't trust |  |
| Fold to river c-bet | 4bet · MW · IP | 55.2% | 87 | LOW-N — don't trust |  |
| Fold to river c-bet | 5bet_plus · HU · IP | 36.5% | 63 | LOW-N — don't trust |  |
| Fold to river c-bet | 5bet_plus · HU · OOP | 51.7% | 60 | LOW-N — don't trust |  |
| Fold to river c-bet | 5bet_plus · MW · OOP | 20.0% | 5 | LOW-N — don't trust |  |
| Fold to river c-bet | 5bet_plus · MW · IP | 50.0% | 2 | LOW-N — don't trust |  |
| Fold to river bet — by size faced | mid | 62.3% | 194,715 |  | 'overbet' = >110% pot |
| Fold to river bet — by size faced | small | 50.4% | 164,024 |  | 'overbet' = >110% pot |
| Fold to river bet — by size faced | large | 73.2% | 21,852 |  | 'overbet' = >110% pot |
| Fold to river bet — by size faced | pot | 79.1% | 2,413 |  | 'overbet' = >110% pot |
| Fold to river bet — by size faced | overbet | 0.0% | 7 | LOW-N — don't trust | 'overbet' = >110% pot |
| River probe (turn checked through) | srp · HU | 33.0% | 546,281 |  |  |
| River probe (turn checked through) | srp · multiway | 22.0% | 156,671 |  |  |
| River probe (turn checked through) | 3bet · HU | 30.7% | 143,520 |  |  |
| River probe (turn checked through) | limped · HU | 22.5% | 72,736 |  |  |
| River probe (turn checked through) | 4bet · HU | 12.1% | 34,046 |  |  |
| River probe (turn checked through) | limped · multiway | 18.3% | 22,375 |  |  |
| River probe (turn checked through) | 3bet · multiway | 20.9% | 20,527 |  |  |
| River probe (turn checked through) | 5bet_plus · HU | 0.2% | 19,303 |  |  |
| River probe (turn checked through) | 4bet · multiway | 5.1% | 2,393 |  |  |
| River probe (turn checked through) | 5bet_plus · multiway | 0.3% | 1,938 |  |  |
| Fold to river probe (as PFR) | srp · HU | 63.9% | 180,139 |  |  |
| Fold to river probe (as PFR) | 3bet · HU | 59.7% | 44,064 |  |  |
| Fold to river probe (as PFR) | srp · multiway | 71.8% | 29,291 |  |  |
| Fold to river probe (as PFR) | 4bet · HU | 57.2% | 4,105 |  |  |
| Fold to river probe (as PFR) | 3bet · multiway | 66.3% | 3,881 |  |  |
| Fold to river probe (as PFR) | 4bet · multiway | 50.9% | 114 | LOW-N — don't trust |  |
| Fold to river probe (as PFR) | 5bet_plus · HU | 33.3% | 45 | LOW-N — don't trust |  |
| Fold to river probe (as PFR) | 5bet_plus · multiway | 0.0% | 7 | LOW-N — don't trust |  |
| River raise (facing a bet) | srp · HU | 7.6% | 562,648 |  |  |
| River raise (facing a bet) | 3bet · HU | 7.7% | 152,572 |  |  |
| River raise (facing a bet) | srp · multiway | 7.1% | 144,590 |  |  |
| River raise (facing a bet) | limped · HU | 6.6% | 27,005 |  |  |
| River raise (facing a bet) | 3bet · multiway | 6.6% | 17,566 |  |  |
| River raise (facing a bet) | 4bet · HU | 6.1% | 16,732 |  |  |
| River raise (facing a bet) | limped · multiway | 6.5% | 12,527 |  |  |
| River raise (facing a bet) | 4bet · multiway | 6.6% | 530 |  |  |
| River raise (facing a bet) | 5bet_plus · HU | 9.0% | 211 | LOW-N — don't trust |  |
| River raise (facing a bet) | 5bet_plus · multiway | 4.3% | 23 | LOW-N — don't trust |  |
| Fold to river raise (after betting) | srp · HU | 55.0% | 43,023 |  |  |
| Fold to river raise (after betting) | 3bet · HU | 49.9% | 11,729 |  |  |
| Fold to river raise (after betting) | srp · multiway | 51.0% | 10,176 |  |  |
| Fold to river raise (after betting) | limped · HU | 52.3% | 1,770 |  |  |
| Fold to river raise (after betting) | 3bet · multiway | 46.5% | 1,155 |  |  |
| Fold to river raise (after betting) | 4bet · HU | 44.3% | 1,024 |  |  |
| Fold to river raise (after betting) | limped · multiway | 46.3% | 807 |  |  |
| Fold to river raise (after betting) | 4bet · multiway | 28.6% | 35 | LOW-N — don't trust |  |
| Fold to river raise (after betting) | 5bet_plus · HU | 36.8% | 19 | LOW-N — don't trust |  |
| Fold to river raise (after betting) | 5bet_plus · multiway | 0.0% | 1 | LOW-N — don't trust |  |
| Bet-call river (after betting, facing raise) | srp · HU | 39.5% | 43,023 |  | same denom as fold-to-river-raise; the two are the fold/call split |
| Bet-call river (after betting, facing raise) | 3bet · HU | 46.5% | 11,729 |  | same denom as fold-to-river-raise; the two are the fold/call split |
| Bet-call river (after betting, facing raise) | srp · multiway | 42.7% | 10,176 |  | same denom as fold-to-river-raise; the two are the fold/call split |
| Bet-call river (after betting, facing raise) | limped · HU | 42.0% | 1,770 |  | same denom as fold-to-river-raise; the two are the fold/call split |
| Bet-call river (after betting, facing raise) | 3bet · multiway | 48.3% | 1,155 |  | same denom as fold-to-river-raise; the two are the fold/call split |
| Bet-call river (after betting, facing raise) | 4bet · HU | 54.2% | 1,024 |  | same denom as fold-to-river-raise; the two are the fold/call split |
| Bet-call river (after betting, facing raise) | limped · multiway | 46.0% | 807 |  | same denom as fold-to-river-raise; the two are the fold/call split |
| Bet-call river (after betting, facing raise) | 4bet · multiway | 57.1% | 35 | LOW-N — don't trust | same denom as fold-to-river-raise; the two are the fold/call split |
| Bet-call river (after betting, facing raise) | 5bet_plus · HU | 52.6% | 19 | LOW-N — don't trust | same denom as fold-to-river-raise; the two are the fold/call split |
| Bet-call river (after betting, facing raise) | 5bet_plus · multiway | 100.0% | 1 | LOW-N — don't trust | same denom as fold-to-river-raise; the two are the fold/call split |
| Check-fold river | srp · HU | 61.1% | 222,729 |  | denom = checked river then faced a bet |
| Check-fold river | srp · multiway | 67.9% | 60,002 |  | denom = checked river then faced a bet |
| Check-fold river | 3bet · HU | 56.7% | 59,301 |  | denom = checked river then faced a bet |
| Check-fold river | limped · HU | 73.3% | 11,911 |  | denom = checked river then faced a bet |
| Check-fold river | 3bet · multiway | 64.5% | 6,722 |  | denom = checked river then faced a bet |
| Check-fold river | 4bet · HU | 57.0% | 6,078 |  | denom = checked river then faced a bet |
| Check-fold river | limped · multiway | 73.3% | 5,672 |  | denom = checked river then faced a bet |
| Check-fold river | 4bet · multiway | 67.6% | 188 | LOW-N — don't trust | denom = checked river then faced a bet |
| Check-fold river | 5bet_plus · HU | 50.6% | 85 | LOW-N — don't trust | denom = checked river then faced a bet |
| Check-fold river | 5bet_plus · multiway | 20.0% | 5 | LOW-N — don't trust | denom = checked river then faced a bet |
| Check-call river | srp · HU | 34.3% | 222,729 |  | denom = checked river then faced a bet |
| Check-call river | srp · multiway | 28.3% | 60,002 |  | denom = checked river then faced a bet |
| Check-call river | 3bet · HU | 38.9% | 59,301 |  | denom = checked river then faced a bet |
| Check-call river | limped · HU | 24.2% | 11,911 |  | denom = checked river then faced a bet |
| Check-call river | 3bet · multiway | 32.5% | 6,722 |  | denom = checked river then faced a bet |
| Check-call river | 4bet · HU | 40.9% | 6,078 |  | denom = checked river then faced a bet |
| Check-call river | limped · multiway | 24.2% | 5,672 |  | denom = checked river then faced a bet |
| Check-call river | 4bet · multiway | 30.3% | 188 | LOW-N — don't trust | denom = checked river then faced a bet |
| Check-call river | 5bet_plus · HU | 48.2% | 85 | LOW-N — don't trust | denom = checked river then faced a bet |
| Check-call river | 5bet_plus · multiway | 60.0% | 5 | LOW-N — don't trust | denom = checked river then faced a bet |

## E. Summary

| Stat | Segment | Pool freq | N | Flag | Note |
|---|---|---:|---:|---|---|
| WWSF | all | 47.6% | 7,243,924 |  |  |
| WWSF by position | UTG | 51.4% | 881,795 |  |  |
| WWSF by position | HJ | 51.7% | 898,403 |  |  |
| WWSF by position | CO | 51.8% | 974,472 |  |  |
| WWSF by position | BU | 51.4% | 1,177,055 |  |  |
| WWSF by position | SB | 48.9% | 1,138,769 |  |  |
| WWSF by position | BB | 39.8% | 2,173,430 |  |  |
| WTSD | all | 30.3% | 7,243,924 |  |  |
| WTSD by position | UTG | 31.5% | 881,795 |  |  |
| WTSD by position | HJ | 31.4% | 898,403 |  |  |
| WTSD by position | CO | 31.0% | 974,472 |  |  |
| WTSD by position | BU | 30.4% | 1,177,055 |  |  |
| WTSD by position | SB | 30.5% | 1,138,769 |  |  |
| WTSD by position | BB | 29.0% | 2,173,430 |  |  |
| W$SD | all | 52.0% | 2,227,805 |  |  |
| W$SD by position | UTG | 52.9% | 281,842 |  |  |
| W$SD by position | HJ | 52.3% | 285,835 |  |  |
| W$SD by position | CO | 51.3% | 306,915 |  |  |
| W$SD by position | BU | 50.0% | 363,706 |  |  |
| W$SD by position | SB | 53.2% | 353,148 |  |  |
| W$SD by position | BB | 52.3% | 636,359 |  |  |
| Aggression frequency — flop | all | 49.6% | 5,129,448 |  | (bet+raise) / (bet+raise+call+fold) |
| Aggression frequency — turn | all | 49.9% | 3,214,322 |  | (bet+raise) / (bet+raise+call+fold) |
| Aggression frequency — river | all | 50.8% | 1,899,381 |  | (bet+raise) / (bet+raise+call+fold) |
| Average players to flop | all | 2.21 | 54,443,970 |  |  |
| Pot-type share (of hands that saw a flop) | srp | 100.0% | 5,290,612 |  | read N — share of flops by pot type |
| Pot-type share (of hands that saw a flop) | 3bet | 100.0% | 1,336,617 |  | read N — share of flops by pot type |
| Pot-type share (of hands that saw a flop) | limped | 100.0% | 386,735 |  | read N — share of flops by pot type |
| Pot-type share (of hands that saw a flop) | 4bet | 100.0% | 186,630 |  | read N — share of flops by pot type |
| Pot-type share (of hands that saw a flop) | 5bet_plus | 100.0% | 43,330 |  | read N — share of flops by pot type |
| Multiway share (of flops) | all | 18.2% | 7,243,924 |  | 3+ players to the flop |

## F. Per-stake split

| Stat | Segment | Pool freq | N | Flag | Note |
|---|---|---:|---:|---|---|
| VPIP | NL10 | 22.8% | 17,811,558 |  |  |
| VPIP | NL25 | 22.8% | 36,632,412 |  |  |
| PFR | NL10 | 16.8% | 17,811,558 |  |  |
| PFR | NL25 | 16.8% | 36,632,412 |  |  |
| 3bet% | NL10 | 8.0% | 6,804,731 |  |  |
| 3bet% | NL25 | 7.9% | 14,011,581 |  |  |
| Fold to 3bet | NL10 | 52.2% | 544,436 |  |  |
| Fold to 3bet | NL25 | 53.2% | 1,112,460 |  |  |
| C-bet flop | NL10 | 56.6% | 1,054,501 |  |  |
| C-bet flop | NL25 | 56.7% | 2,159,296 |  |  |
| Fold to flop c-bet | NL10 | 43.0% | 650,095 |  |  |
| Fold to flop c-bet | NL25 | 42.9% | 1,328,996 |  |  |
| Fold to turn c-bet | NL10 | 48.3% | 266,181 |  |  |
| Fold to turn c-bet | NL25 | 49.1% | 539,952 |  |  |
| Fold to river c-bet | NL10 | 57.4% | 125,596 |  |  |
| Fold to river c-bet | NL25 | 58.1% | 257,415 |  |  |
| WTSD | NL10 | 30.5% | 2,377,738 |  |  |
| WTSD | NL25 | 30.3% | 4,866,186 |  |  |
| W$SD | NL10 | 52.0% | 733,330 |  |  |
| W$SD | NL25 | 52.0% | 1,494,475 |  |  |

## Assumptions and interpretations

- **Stakes are NL10 + NL25, not NL2-NL5.** The brief specified NL2-NL5, but the only NL2-NL5 data in this database is 18,215 hero-export hands (~91k villain seats) — far too few for the requested postflop splits. The 9.07M-hand pool is NL10 (2.97M) + NL25 (6.11M).
- **Hero exclusion is structural, not filtered.** The population dataset contains zero hero seats, so no hero rows can enter any aggregate. The hero ID placeholder in the brief was never filled in and was not needed.
- **Opponents in this dataset are NOT anonymised.** The brief assumed GG anonymisation; this export carries real screen names (94,276 distinct ids across 54.4M seats). Everything below is still reported as a single pool aggregate as requested — no per-player stats.
- **Bet-size buckets do not match the brief's boundaries.** The pipeline buckets at <=37% / 37-60% / 60-85% / 85-110% / >110% of pot (labelled small/mid/large/pot/overbet), not <=33 / 33-66 / 66-100 / >100. The underlying ratio is stored, so re-bucketing to the brief's exact boundaries is a schema change plus a rebuild, not a re-query.
- **'Fold to river bet' uses the aggressor's river bet** (fold_to_cbet_r), i.e. facing the player who was betting the previous streets — not any river bet from any player.
- **IP/OOP postflop** = acts last on the flop among live players, read from the action stream rather than inferred from seat numbers. Preflop IP/OOP (3bet split) is relative to the opener, using postflop acting order SB<BB<UTG<HJ<CO<BU.
- **Flop-texture buckets are evaluated in priority order** (paired > monotone > low-connected > dry-high > two-tone/wet), so every flop lands in exactly one bucket. A paired monotone board counts as paired.
- **Limp-fold/call/raise denominator is 'limped AND faced a raise behind'.** A limp that walked to the flop was never a fold/call/raise decision.
- **'Size mix' rows are distributions, not frequencies.** Their freq column is 100% by construction; the information is in N — the count of actions in each size bucket.
- Rush & Cash dissolves the table every hand, so there is no table-level or session-level context; every hand is independent.
- Date range is 2023-08-29 to 2025-05-13, dominated by Dec 2024 - May 2025. The brief's optional 'last 3 months' filter was not applied — full database, as instructed by default.

## Not derivable from this schema

- **Hole cards for the pool are only known at showdown** (~2-13% of actions depending on street). Any range-composition stat is therefore showdown-biased. No stat in this report depends on hole cards, so all numbers here are unaffected.
- **Folding ranges are permanently invisible** — a folded hand never shows its cards, on any site. This limits future range work, not the frequencies reported here.
- **'Bet-fold vs bet-call' is reported for the river only.** It is the fold/call split of the same opportunity (bet, then faced a raise). Flop and turn equivalents exist in the schema as fold_to_flop_raise / fold_to_turn_raise but the call half was not added.
- **Effective stack is ~100BB by table type but not filtered on.** Short stacks are included; stack_bucket exists in the schema if a depth filter is wanted later.

## SQL appendix

All 74 queries, in execution order.

**1. A. Preflop · VPIP**

```sql
SELECT position AS segment, sum(vpip_opp) AS n, sum(vpip_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND vpip_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**2. A. Preflop · PFR**

```sql
SELECT position AS segment, sum(pfr_opp) AS n, sum(pfr_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND pfr_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**3. A. Preflop · RFI (raise first in)**

```sql
SELECT position AS segment, sum(rfi_opp) AS n, sum(rfi_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND rfi_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**4. A. Preflop · Open-limp%**

```sql
SELECT position AS segment, sum(limp_opp) AS n, sum(limp_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND limp_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**5. A. Preflop · Cold-call%**

```sql
SELECT position AS segment, sum(cold_call_opp) AS n, sum(cold_call_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND cold_call_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**6. A. Preflop · 3bet%**

```sql
SELECT position AS segment, sum(threebet_opp) AS n, sum(threebet_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND threebet_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**7. A. Preflop · Fold to 3bet (as opener)**

```sql
SELECT position AS segment, sum(fold_to_3bet_opp) AS n, sum(fold_to_3bet_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_3bet_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**8. A. Preflop · Call 3bet (as opener)**

```sql
SELECT position AS segment, sum(call_3bet_opp) AS n, sum(call_3bet_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND call_3bet_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**9. A. Preflop · Squeeze%**

```sql
SELECT position AS segment, sum(squeeze_opp) AS n, sum(squeeze_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND squeeze_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**10. A. Preflop · 4bet%**

```sql
SELECT position AS segment, sum(fourbet_opp) AS n, sum(fourbet_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fourbet_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**11. A. Preflop · Fold to 4bet (as 3bettor)**

```sql
SELECT position AS segment, sum(fold_to_4bet_opp) AS n, sum(fold_to_4bet_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_4bet_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**12. A. Preflop · Call 4bet (as 3bettor)**

```sql
SELECT position AS segment, sum(vs_4bet_opp) AS n, sum(vs_4bet_call) AS k FROM marts.player_hand_flags WHERE dataset='population' AND vs_4bet_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**13. A. Preflop · Limp-fold%**

```sql
SELECT position AS segment, sum(limp_faced_raise_opp) AS n, sum(limp_fold_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND limp_faced_raise_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**14. A. Preflop · Limp-call%**

```sql
SELECT position AS segment, sum(limp_faced_raise_opp) AS n, sum(limp_call_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND limp_faced_raise_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**15. A. Preflop · Limp-raise%**

```sql
SELECT position AS segment, sum(limp_faced_raise_opp) AS n, sum(limp_raise_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND limp_faced_raise_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**16. A. Preflop · Fold to steal**

```sql
SELECT concat(position, ' vs ', vs_position) AS segment, sum(vs_open_opp) AS n, sum(vs_open_fold) AS k FROM marts.player_hand_flags WHERE dataset='population' AND vs_open_opp = 1 AND position IN ('SB','BB') AND vs_position IN ('CO','BTN','SB') GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**17. A. Preflop · Call vs steal**

```sql
SELECT concat(position, ' vs ', vs_position) AS segment, sum(vs_open_opp) AS n, sum(vs_open_call) AS k FROM marts.player_hand_flags WHERE dataset='population' AND vs_open_opp = 1 AND position IN ('SB','BB') AND vs_position IN ('CO','BTN','SB') GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**18. A. Preflop · 3bet vs steal**

```sql
SELECT concat(position, ' vs ', vs_position) AS segment, sum(threebet_opp) AS n, sum(threebet_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND threebet_opp = 1 AND position IN ('SB','BB') AND vs_position IN ('CO','BTN','SB') GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**19. A. Preflop · 3bet% by relative position**

```sql
SELECT if(indexOf(['SB','BB','UTG','HJ','CO','BTN'], position) > indexOf(['SB','BB','UTG','HJ','CO','BTN'], vs_position), 'IP vs opener', 'OOP vs opener') AS segment, sum(threebet_opp) AS n, sum(threebet_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND threebet_opp = 1 AND vs_position != '' GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**20. A. Preflop · 3bet% blinds vs late**

```sql
SELECT concat(if(position IN ('SB','BB'),'blinds','non-blind'), ' vs ', vs_position) AS segment, sum(threebet_opp) AS n, sum(threebet_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND threebet_opp = 1 AND vs_position IN ('CO','BTN','SB') GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**21. B. Flop · C-bet flop (as PFR)**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(cbet_flop_opp) AS n, sum(cbet_flop_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND cbet_flop_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**22. B. Flop · C-bet flop — size mix**

```sql
SELECT bet_size_bucket_f AS segment, sum(cbet_flop_action) AS n, sum(cbet_flop_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND cbet_flop_action = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**23. B. Flop · Fold to flop c-bet**

```sql
SELECT concat(pot_type,' · ',if(is_multiway=1,'MW','HU'),' · ',if(is_ip=1,'IP','OOP')) AS segment, sum(fold_to_cbet_f_opp) AS n, sum(fold_to_cbet_f_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_cbet_f_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**24. B. Flop · Fold to flop c-bet — by texture**

```sql
SELECT concat(multiIf( flop_pairing IN ('paired','trips'), 'paired', flop_suitedness = 'monotone', 'monotone', flop_high_card IN ('9','8','7','6','5','4','3','2') AND flop_connectedness IN ('connected','semi_connected'), 'low-connected', flop_high_card IN ('A','K','Q') AND flop_suitedness = 'rainbow' AND flop_connectedness = 'disconnected', 'dry-high', flop_suitedness = 'two_tone' OR flop_connectedness = 'connected', 'two-tone/wet', 'other'), ' · ', if(is_ip=1,'IP','OOP')) AS segment, sum(fold_to_cbet_f_opp) AS n, sum(fold_to_cbet_f_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_cbet_f_opp = 1 AND pot_type='srp' AND is_multiway=0 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**25. B. Flop · Fold to flop c-bet — by size faced**

```sql
SELECT faced_size_bucket_f AS segment, sum(fold_to_cbet_f_opp) AS n, sum(fold_to_cbet_f_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_cbet_f_opp = 1 AND pot_type='srp' AND is_multiway=0 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**26. B. Flop · Raise flop c-bet**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(fold_to_cbet_f_opp) AS n, sum(raise_cbet_f_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_cbet_f_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**27. B. Flop · Float-fold (call flop c-bet, fold turn)**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(float_fold_opp) AS n, sum(float_fold_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND float_fold_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**28. B. Flop · Donk-bet flop**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(donk_f_opp) AS n, sum(donk_f_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND donk_f_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**29. B. Flop · Fold to donk (as PFR)**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(fold_to_donk_opp) AS n, sum(fold_to_donk_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_donk_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**30. B. Flop · Flop check-raise**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(checkraise_f_opp) AS n, sum(checkraise_f_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND checkraise_f_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**31. B. Flop · Fold to flop raise (after betting)**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(fold_to_flop_raise_opp) AS n, sum(fold_to_flop_raise_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_flop_raise_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**32. C. Turn · Second barrel (turn c-bet)**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(cbet_turn_opp) AS n, sum(cbet_turn_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND cbet_turn_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**33. C. Turn · Second barrel — size mix**

```sql
SELECT bet_size_bucket_t AS segment, sum(cbet_turn_action) AS n, sum(cbet_turn_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND cbet_turn_action = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**34. C. Turn · Fold to turn c-bet**

```sql
SELECT concat(pot_type,' · ',if(is_multiway=1,'MW','HU'),' · ',if(is_ip=1,'IP','OOP')) AS segment, sum(fold_to_cbet_t_opp) AS n, sum(fold_to_cbet_t_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_cbet_t_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**35. C. Turn · Fold to turn c-bet — by size faced**

```sql
SELECT faced_size_bucket_t AS segment, sum(fold_to_cbet_t_opp) AS n, sum(fold_to_cbet_t_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_cbet_t_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**36. C. Turn · Turn probe (non-PFR bets after flop checked through)**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(probe_t_opp) AS n, sum(probe_t_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND probe_t_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**37. C. Turn · Fold to turn probe (as PFR who checked)**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(fold_to_probe_t_opp) AS n, sum(fold_to_probe_t_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_probe_t_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**38. C. Turn · Delayed c-bet (PFR checks flop, bets turn)**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(delayed_cbet_opp) AS n, sum(delayed_cbet_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND delayed_cbet_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**39. C. Turn · Fold to delayed c-bet**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(fold_to_delayed_cbet_opp) AS n, sum(fold_to_delayed_cbet_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_delayed_cbet_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**40. C. Turn · Turn check-raise**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(checkraise_t_opp) AS n, sum(checkraise_t_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND checkraise_t_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**41. C. Turn · Fold to turn raise (after betting)**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(fold_to_turn_raise_opp) AS n, sum(fold_to_turn_raise_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_turn_raise_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**42. D. River · Triple barrel (river c-bet)**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(cbet_river_opp) AS n, sum(cbet_river_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND cbet_river_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**43. D. River · Triple barrel — size mix**

```sql
SELECT bet_size_bucket_r AS segment, sum(cbet_river_action) AS n, sum(cbet_river_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND cbet_river_action = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**44. D. River · Fold to river c-bet**

```sql
SELECT concat(pot_type,' · ',if(is_multiway=1,'MW','HU'),' · ',if(is_ip=1,'IP','OOP')) AS segment, sum(fold_to_cbet_r_opp) AS n, sum(fold_to_cbet_r_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_cbet_r_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**45. D. River · Fold to river bet — by size faced**

```sql
SELECT faced_size_bucket_r AS segment, sum(fold_to_cbet_r_opp) AS n, sum(fold_to_cbet_r_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_cbet_r_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**46. D. River · River probe (turn checked through)**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(probe_r_opp) AS n, sum(probe_r_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND probe_r_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**47. D. River · Fold to river probe (as PFR)**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(fold_to_probe_r_opp) AS n, sum(fold_to_probe_r_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_probe_r_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**48. D. River · River raise (facing a bet)**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(river_face_bet_opp) AS n, sum(river_raise_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND river_face_bet_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**49. D. River · Fold to river raise (after betting)**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(fold_to_river_raise_opp) AS n, sum(fold_to_river_raise_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_river_raise_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**50. D. River · Bet-call river (after betting, facing raise)**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(fold_to_river_raise_opp) AS n, sum(bet_call_river_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_river_raise_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**51. D. River · Check-fold river**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(river_check_faced_opp) AS n, sum(river_check_fold_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND river_check_faced_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**52. D. River · Check-call river**

```sql
SELECT concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU')) AS segment, sum(river_check_faced_opp) AS n, sum(river_check_call_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND river_check_faced_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**53. E. Summary · WWSF**

```sql
SELECT '' AS segment, sum(wwsf_opp) AS n, sum(wwsf_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND wwsf_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**54. E. Summary · WWSF by position**

```sql
SELECT position AS segment, sum(wwsf_opp) AS n, sum(wwsf_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND wwsf_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**55. E. Summary · WTSD**

```sql
SELECT '' AS segment, sum(wtsd_opp) AS n, sum(wtsd_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND wtsd_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**56. E. Summary · WTSD by position**

```sql
SELECT position AS segment, sum(wtsd_opp) AS n, sum(wtsd_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND wtsd_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**57. E. Summary · W$SD**

```sql
SELECT '' AS segment, sum(wsd_opp) AS n, sum(wsd_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND wsd_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**58. E. Summary · W$SD by position**

```sql
SELECT position AS segment, sum(wsd_opp) AS n, sum(wsd_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND wsd_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**59. E. Summary · AFq flop**

```sql
SELECT '' AS segment, sum(aggr_f+call_f+fold_f) AS n, sum(aggr_f) AS k FROM marts.player_hand_flags WHERE dataset='population' AND saw_flop = 1 FORMAT JSONEachRow
```

**60. E. Summary · AFq turn**

```sql
SELECT '' AS segment, sum(aggr_t+call_t+fold_t) AS n, sum(aggr_t) AS k FROM marts.player_hand_flags WHERE dataset='population' AND saw_turn = 1 FORMAT JSONEachRow
```

**61. E. Summary · AFq river**

```sql
SELECT '' AS segment, sum(aggr_r+call_r+fold_r) AS n, sum(aggr_r) AS k FROM marts.player_hand_flags WHERE dataset='population' AND saw_river = 1 FORMAT JSONEachRow
```

**62. E. Summary · Average players to flop**

```sql
SELECT round(avgIf(players_to_flop, saw_flop=1), 3) AS v, count() AS n FROM marts.player_hand_flags WHERE dataset='population' FORMAT JSONEachRow
```

**63. E. Summary · Pot-type share (of hands that saw a flop)**

```sql
SELECT pot_type AS segment, sum(saw_flop) AS n, sum(saw_flop) AS k FROM marts.player_hand_flags WHERE dataset='population' AND saw_flop = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**64. E. Summary · Multiway share (of flops)**

```sql
SELECT '' AS segment, sum(saw_flop) AS n, sum(is_multiway) AS k FROM marts.player_hand_flags WHERE dataset='population' AND saw_flop = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**65. F. Per-stake split · VPIP**

```sql
SELECT stake_level AS segment, sum(vpip_opp) AS n, sum(vpip_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND vpip_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**66. F. Per-stake split · PFR**

```sql
SELECT stake_level AS segment, sum(pfr_opp) AS n, sum(pfr_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND pfr_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**67. F. Per-stake split · 3bet%**

```sql
SELECT stake_level AS segment, sum(threebet_opp) AS n, sum(threebet_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND threebet_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**68. F. Per-stake split · Fold to 3bet**

```sql
SELECT stake_level AS segment, sum(fold_to_3bet_opp) AS n, sum(fold_to_3bet_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_3bet_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**69. F. Per-stake split · C-bet flop**

```sql
SELECT stake_level AS segment, sum(cbet_flop_opp) AS n, sum(cbet_flop_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND cbet_flop_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**70. F. Per-stake split · Fold to flop c-bet**

```sql
SELECT stake_level AS segment, sum(fold_to_cbet_f_opp) AS n, sum(fold_to_cbet_f_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_cbet_f_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**71. F. Per-stake split · Fold to turn c-bet**

```sql
SELECT stake_level AS segment, sum(fold_to_cbet_t_opp) AS n, sum(fold_to_cbet_t_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_cbet_t_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**72. F. Per-stake split · Fold to river c-bet**

```sql
SELECT stake_level AS segment, sum(fold_to_cbet_r_opp) AS n, sum(fold_to_cbet_r_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND fold_to_cbet_r_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**73. F. Per-stake split · WTSD**

```sql
SELECT stake_level AS segment, sum(wtsd_opp) AS n, sum(wtsd_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND wtsd_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

**74. F. Per-stake split · W$SD**

```sql
SELECT stake_level AS segment, sum(wsd_opp) AS n, sum(wsd_action) AS k FROM marts.player_hand_flags WHERE dataset='population' AND wsd_opp = 1 GROUP BY segment HAVING n > 0 FORMAT JSONEachRow
```

