# Replacing an integral with a pixel sum

Lesson: When the representation changes, show both versions and say what becomes what, including the measure.

## Preferred construction

Start from the continuous harmonic coefficient,

\[ a_{\ell m} = \int_{S^2} d\Omega \; T(\hat n)\, Y^*_{\ell m}(\hat n). \]

A pixelized approximation is

\[ a_{\ell m} \approx \sum_p \Delta\Omega_p \; T(\hat n_p)\, Y^*_{\ell m}(\hat n_p). \]

The correspondence:

- the continuous field becomes sampled pixel values;
- the integration measure becomes the pixel solid angle;
- the integrand is evaluated at each pixel direction;
- the integral becomes a weighted sum.

The sum approximates the integral, with accuracy set by the pixelization and quadrature scheme.

## Teaching lesson

When changing representations, show both versions and identify what becomes what. Do not say only that an integral becomes a sum; explain the role of the measure and of the sampled values.
