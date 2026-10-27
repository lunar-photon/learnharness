# Understanding \(N_L^{(0)}\) and \(N_L^{(1)}\) through the measured correlator and diagram channels

Lesson: Start from the observable, expose the correlator underneath it, identify its contributions, and use diagram channels to separate the target from the leading corrections before explaining the bias correction.

## Generic answer

\(N_L^{(0)}\) is Gaussian reconstruction noise, while \(N_L^{(1)}\) is a lensing-induced correction to the reconstructed lensing power spectrum.

These labels do not explain why the contributions exist or how they relate to the signal.

## Preferred construction

**Begin with what is measured.** We observe CMB data, build a quadratic estimator for the lensing potential, and compute its two-point function \(\langle \hat\phi_L \hat\phi^*_{L'} \rangle\). Each estimator is quadratic in CMB fields, so its two-point function involves a CMB four-point function. For an \(EB\) estimator the field structure is schematically \(\langle E B E B \rangle\), with the appropriate harmonic or Fourier indices and estimator weights.

**The correlator contains multiple contributions.** We do not measure individual diagrams separately. We measure the correlator, which receives every allowed contraction and interaction at the perturbative order considered. The task is to identify the contribution carrying the desired lensing-potential power and distinguish it from the others.

**Separate disconnected Gaussian contractions from connected lensing contributions.** Label the four fields \(\tilde X_1\tilde X_2\tilde X_3\tilde X_4\), with legs 1, 2 entering one estimator and 3, 4 the other. There are three ways to pair them. The pairing \((1,2)(3,4)\), \(\langle\tilde X_1\tilde X_2\rangle\langle\tilde X_3\tilde X_4\rangle\), is the mean field: each estimator's own expectation, subtracted before the power is formed. The other two pairings, \((1,3)(2,4)\) and \((1,4)(2,3)\), connect the two estimators and give the leading reconstruction-noise term, conventionally \(N_L^{(0)}\); it is present even when there is no lensing signal. Lensing also induces connected four-point correlations, which give further contributions, including the leading correction conventionally \(N_L^{(1)}\).

**Organize the connected terms by channel.** At leading order the connected four-point function can be organized schematically into three exchange channels: the s-channel carries the desired \(C_L^{\phi\phi}\) contribution for the reconstruction configuration considered, and the crossed t- and u-channels give the leading \(N_L^{(1)}\) corrections. The disconnected \(N_L^{(0)}\) is separate from these connected channels.

**The diagram** (`figures/05-reconstruction-biases-diagrams.png`, the learner's own figure, which they find makes \(N_L^{(1)}\) easy to see). Two rows of three, in the order above. Top row, the disconnected pairings drawn as two lines: the mean field \((1,2)(3,4)\) as two vertical lines, \(N_L^{(0)}\) direct \((1,3)(2,4)\) as two horizontal lines, and \(N_L^{(0)}\) cross \((1,4)(2,3)\) as two crossing lines. Bottom row, the connected terms as a single lens exchange \(\phi\) (a dashed line) between two vertices: the signal (s-channel) joins vertex (1,2) to vertex (3,4) through \(\phi(\boldsymbol q)\) with \(\boldsymbol q = \boldsymbol\ell_1+\boldsymbol\ell_2\), weighted \(f_{\alpha\beta}(\boldsymbol\ell_1,\boldsymbol\ell_2)\,C^{\phi\phi}_q\,f_{\alpha\beta}(\boldsymbol\ell_3,\boldsymbol\ell_4)\); \(N_L^{(1)}\) direct (t-channel) joins (1,3) to (2,4) through \(\phi(\boldsymbol q')\), \(\boldsymbol q' = \boldsymbol\ell_1+\boldsymbol\ell_3\); \(N_L^{(1)}\) cross (u-channel) joins (1,4) to (2,3) through \(\phi(\boldsymbol q'')\), \(\boldsymbol q'' = \boldsymbol\ell_1+\boldsymbol\ell_4\). The picture makes the point at a glance: the signal is the exchange whose momentum is the one the estimator reconstructs, \(N_L^{(1)}\) is the same lens exchange routed across the two estimators, so it carries \(C^{\phi\phi}\) at other wavevectors. When teaching \(N_L^{(1)}\), draw this figure (with the `visual` tool) or describe it panel by panel.

**Identify the inference problem.** After the appropriate estimator normalization, schematically,

\[ \text{reconstructed power} = C_L^{\phi\phi} + N_L^{(0)} + N_L^{(1)} + \dots \]

The precise normalization, multipole dependence and higher-order terms depend on the estimator and convention. We estimate or subtract the unwanted contributions to recover the desired lensing power.

## Teaching lesson

Start from the observable, expose the underlying correlator, identify its contributions, and use diagram channels to distinguish the target from the leading corrections. Only then explain the bias-correction mechanism. The learner should leave with the central idea: the observable is a sum of contributions, and bias correction separates the desired physical signal from the rest.

## Accuracy constraint

The s/t/u assignment is a schematic description of the standard leading-order trispectrum and reconstruction-bias diagrammatics; the exact assignment must follow the external-leg and momentum conventions of the calculation being discussed, so cite the source whose conventions you use (e.g. Kesden, Cooray & Kamionkowski 2003; Hanson et al. 2011). \(N_L^{(1)}\) is not simply every connected diagram other than the signal; it is the relevant leading correction under the chosen perturbative convention.
