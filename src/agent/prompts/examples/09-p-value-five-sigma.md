# The p-value and the 5σ discovery threshold

Lesson: Before any formula, ask the question the p-value answers in plain words: if nothing new were going on, would data like ours, or even more extreme, be something we would reasonably expect to see?

## Generic answer

The p-value is the probability, under the null hypothesis \(H_0\), of obtaining a test statistic at least as extreme as the one observed: \(p = P(T \ge t_{\rm obs} \mid H_0)\). If \(p < \alpha\) we reject \(H_0\). In particle physics a discovery requires \(5\sigma\), i.e. \(p < 2.87\times10^{-7}\).

Correct, but it is a definition followed by a rule. It doesn't say what question is being asked, why "at least as extreme" belongs in it, or where the number \(2.87\times10^{-7}\) comes from.

## Preferred construction

**The question in words.** We have some data. Suppose nothing new is going on: the coin is fair, the detector sees only background. *Given that, would data such as what we found, or even more extreme than that, be something we would reasonably expect?* If yes, the data give us no reason to doubt "nothing is going on". If such data would be very rare, either we were very unlucky or something is going on.

**A coin, by counting.** A coin comes up heads 8 times in 10 tosses. Would 8 heads, or more than 8 heads, be something we would reasonably expect from a fair coin? Count:

\[ P(n_h \ge 8 \mid \text{fair}) = \frac{\binom{10}{8} + \binom{10}{9} + \binom{10}{10}}{2^{10}} = \frac{45 + 10 + 1}{1024} = \frac{7}{128} \approx 0.055 . \]

About one time in eighteen: unusual, not alarming. With 17 heads in 20 tosses the same question gives \(1351/2^{20} \approx 0.0013\), about one time in 780: now "a fair coin did this" is hard to believe.

**Why "or more extreme".** The probability of exactly 8 heads, or of any single outcome, shrinks as we toss more, even for a fair coin, so it cannot measure surprise. The question is whether the data lie *this far or further* out in the direction we were worried about. That tail is the p-value, and which direction counts (more heads only, or either way) is decided before looking.

**From coins to σ.** Physicists quote the same tail probability as a distance on a standard normal: "\(z\sigma\)" means the one-sided tail beyond \(z\) standard deviations.

| \(z\) | one-sided tail | about one in |
|---|---|---|
| 1 | 0.159 | 6 |
| 2 | 0.0228 | 44 |
| 3 | 0.00135 | 740 |
| 5 | \(2.87\times10^{-7}\) | 3.5 million |

**5σ is the same question with a strict bar.** A search window expects \(b = 3.2\) background events and sees 11. Would 11 events, or more, be something we would reasonably expect from background alone?

\[ P(N \ge 11 \mid b = 3.2) = 1 - \sum_{k=0}^{10} \frac{3.2^k e^{-3.2}}{k!} \approx 5.0\times10^{-4} , \]

about 3.3σ: interesting, not a discovery. A discovery claim requires the answer "background alone would do this less than about once in 3.5 million repetitions" (5σ). The bar is that strict because many places are searched (look-elsewhere), systematics are imperfectly known, and a false discovery is costly.

## Teaching lesson

The learner holds the question "would this be something we'd reasonably expect?" from everyday reasoning. Ask it in words first, with the null stated as "nothing new is going on", answer it by counting for a coin, and only then name the tail a p-value and translate it into σ. Each new piece (the tail, the direction, the σ scale, the 5σ bar) is the same question made more precise.

## Accuracy constraint

A p-value is computed assuming the null is true. It is **not** the probability that the null is true, and \(1-p\) is not the probability that a signal exists. It depends on what counts as "more extreme" (one- or two-sided, the stopping rule), which must be fixed before looking. 5σ in particle physics is one-sided: \(2.87\times10^{-7}\); the two-sided tail beyond \(\pm5\sigma\) is twice that.
