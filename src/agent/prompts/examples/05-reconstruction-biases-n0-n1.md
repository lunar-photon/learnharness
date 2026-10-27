# Understanding \(N_L^{(0)}\) and \(N_L^{(1)}\) through the measured correlator and diagram channels

Lesson: Start from the observable, expose the correlator underneath it, identify its contributions, and use diagram channels to separate the target from the leading corrections before explaining the bias correction.

## Generic answer

\(N_L^{(0)}\) is Gaussian reconstruction noise, while \(N_L^{(1)}\) is a lensing-induced correction to the reconstructed lensing power spectrum.

These labels do not explain why the contributions exist or how they relate to the signal.

## Preferred construction

**Begin with what is measured.** We observe CMB data, build a quadratic estimator for the lensing potential, and compute its two-point function \(\langle \hat\phi_L \hat\phi^*_{L'} \rangle\). Each estimator is quadratic in CMB fields, so its two-point function involves a CMB four-point function. For an \(EB\) estimator the field structure is schematically \(\langle E B E B \rangle\), with the appropriate harmonic or Fourier indices and estimator weights.

**The correlator contains multiple contributions.** We do not measure individual diagrams separately. We measure the correlator, which receives every allowed contraction and interaction at the perturbative order considered. The task is to identify the contribution carrying the desired lensing-potential power and distinguish it from the others.

**Separate disconnected Gaussian contractions from connected lensing contributions.** The disconnected Gaussian contractions give the leading reconstruction-noise term, conventionally \(N_L^{(0)}\); it is present even when there is no lensing signal. Lensing also induces connected four-point correlations, which give further contributions, including the leading correction conventionally \(N_L^{(1)}\).

**Organize the connected terms by channel.** At leading order the connected four-point function can be organized schematically into three exchange channels: the s-channel carries the desired \(C_L^{\phi\phi}\) contribution for the reconstruction configuration considered, and the crossed t- and u-channels give the leading \(N_L^{(1)}\) corrections. The disconnected \(N_L^{(0)}\) is separate from these connected channels.

**Identify the inference problem.** After the appropriate estimator normalization, schematically,

\[ \text{reconstructed power} = C_L^{\phi\phi} + N_L^{(0)} + N_L^{(1)} + \dots \]

The precise normalization, multipole dependence and higher-order terms depend on the estimator and convention. We estimate or subtract the unwanted contributions to recover the desired lensing power.

## Teaching lesson

Start from the observable, expose the underlying correlator, identify its contributions, and use diagram channels to distinguish the target from the leading corrections. Only then explain the bias-correction mechanism. The learner should leave with the central idea: the observable is a sum of contributions, and bias correction separates the desired physical signal from the rest.

## Accuracy constraint

The s/t/u assignment is a schematic description of the standard leading-order trispectrum and reconstruction-bias diagrammatics; the exact assignment must follow the external-leg and momentum conventions of the calculation being discussed, so cite the source whose conventions you use (e.g. Kesden, Cooray & Kamionkowski 2003; Hanson et al. 2011). \(N_L^{(1)}\) is not simply every connected diagram other than the signal; it is the relevant leading correction under the chosen perturbative convention.
