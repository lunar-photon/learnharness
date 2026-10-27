# Fourier methods in CMB lensing

Lesson: Build the sequence from the geometry and representation of the field to the computational method, so each step makes the next one natural.

## Generic answer

CMB lensing remaps the temperature field,

\[ \tilde T(\mathbf{x}) = T(\mathbf{x} + \boldsymbol{\alpha}(\mathbf{x})), \qquad \boldsymbol{\alpha} = \nabla\phi. \]

Fourier methods are useful because derivatives are simple in Fourier space, while remapping can be performed in real space.

This is correct but jumps straight to the application.

## Preferred construction

1. \(T\) is a scalar field on the celestial sphere.
2. Spherical harmonics \(Y_{\ell m}\) form a basis for expanding that field: \( T(\hat n) = \sum_{\ell m} a_{\ell m} Y_{\ell m}(\hat n). \)
3. On a small enough sky patch, approximate the sphere by its tangent plane: the flat-sky approximation.
4. On a plane, plane waves are the natural Fourier basis.
5. The Fourier transform is an integral, but a computer represents the field by discrete pixel samples, so the integral is approximated by a weighted sum.
6. That sum is a discrete Fourier transform (DFT).
7. An FFT is an efficient algorithm for computing the DFT, not a different mathematical transform.

## Teaching lesson

Construct the sequence from the geometry and representation of the field to the computational method. Each step should make the next one natural. Keep the status of each step distinct: the flat-sky approximation is geometric, pixelization is a numerical approximation, and the FFT is an algorithm.
