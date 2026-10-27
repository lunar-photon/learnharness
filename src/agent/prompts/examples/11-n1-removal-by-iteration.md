# Removing \(N_L^{(1)}\) by iteration

Lesson: Write the reconstructed power as a linear equation in the unknown spectrum, then read the iteration off it as the fixed point of that equation, with its convergence condition, before naming any procedure.

## Generic answer

\(N_L^{(1)}\) is removed iteratively: compute it with a fiducial lensing spectrum, subtract it from the measured power, re-estimate \(C_L^{\phi\phi}\), recompute \(N_L^{(1)}\) with the new estimate, and repeat until the result stops changing.

That is a recipe. It does not say why the loop should land on the true spectrum, why starting from a fiducial guess is allowed, or when the loop fails.

## Preferred construction

The reconstructed lensing power spectrum is

\[ \hat C_L^{\hat\phi\hat\phi} = C_L^{\phi\phi} + N_L^{(0)} + N_L^{(1)}. \]

Since \(N^{(1)}\) depends linearly on the true lensing spectrum,

\[ N_L^{(1)} = \sum_{L'} K_{LL'}\, C_{L'}^{\phi\phi}, \]

subtracting \(N^{(0)}\), we obtain

\[ d_L = C_L^{\phi\phi} + \sum_{L'} K_{LL'}\, C_{L'}^{\phi\phi}, \]

where \(d_L = \hat C_L^{\hat\phi\hat\phi} - N_L^{(0)}\).

In matrix notation,

\[ \mathbf d = (\mathbf I + \mathbf K)\,\mathbf C. \]

Rearranging,

\[ \mathbf C = \mathbf d - \mathbf K\,\mathbf C. \]

Since \(\mathbf C\) is unknown, replace it on the right-hand side with the previous estimate:

\[ \boxed{\mathbf C^{(n+1)} = \mathbf d - \mathbf K\,\mathbf C^{(n)}} \]

Starting from a fiducial spectrum \(\mathbf C^{(0)}\), iterate until

\[ \left|\mathbf C^{(n+1)} - \mathbf C^{(n)}\right| \]

is sufficiently small.

The iteration converges if the spectral radius satisfies

\[ \boxed{\rho(\mathbf K) < 1.} \]

## Teaching lesson

The whole idea is one observation: \(N^{(1)}\) is linear in the spectrum we want. Once that is written down, the measured power becomes a linear system, and the iteration is not a recipe but the obvious way to solve \(\mathbf C = \mathbf d - \mathbf K\mathbf C\) when \(\mathbf C\) appears on both sides. The fixed point of the loop is the true spectrum by construction, the fiducial start only seeds it, and the error obeys \(\mathbf e^{(n+1)} = -\mathbf K\,\mathbf e^{(n)}\), which is where \(\rho(\mathbf K) < 1\) comes from. Teach it in this order: the decomposition the learner already holds, the linearity of \(N^{(1)}\) (the one new fact), the matrix form, the rearrangement, the iteration, the convergence condition.

## Accuracy constraint

This is the schematic, linear treatment. \(N^{(1)}\) is linear in \(C^{\phi\phi}\) at leading order; \(\mathbf K\) depends on the CMB spectra, noise and estimator weights, and in practice the subtraction is often done with realization-dependent or simulation-based estimates. Keep those refinements until this linear picture has landed. The convergence condition is the standard one for a fixed-point (Jacobi-type) iteration: it converges from any start if and only if \(\rho(\mathbf K) < 1\), which holds here because \(N^{(1)}\) is a small correction.
