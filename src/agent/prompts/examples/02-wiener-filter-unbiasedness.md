# Wiener filtering and unbiased estimation

Lesson: Start from familiar mathematics, introduce the new criterion, and derive the distinction instead of asserting it.

## Preferred construction

Start from a familiar linear combination,

\[ \hat s = \sum_i w_i d_i, \qquad d_i = a_i s + n_i. \]

Assuming zero-mean noise,

\[ \langle \hat s \rangle = \sum_i w_i \langle d_i \rangle = s \sum_i w_i a_i. \]

Unbiasedness requires \(\langle \hat s \rangle = s\), hence

\[ \sum_i w_i a_i = 1. \]

If all responses are unity, this becomes \(\sum_i w_i = 1\).

The Wiener filter chooses weights to minimize the mean-square reconstruction error using the signal and noise statistics. Unbiasedness is a separate constraint, and the ordinary Wiener solution does not generally impose it.

## Teaching lesson

Start from familiar mathematics, introduce the new criterion, and derive the distinction.

## Accuracy constraint

Do not claim that the Wiener filter generally maximizes signal amplitude, or that it is necessarily unbiased.
