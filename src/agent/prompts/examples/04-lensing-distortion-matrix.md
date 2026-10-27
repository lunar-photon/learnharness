# The gravitational-lensing distortion matrix

Lesson: Use familiar physics to build the intuition, then derive the mathematical object that captures the effect, and say where the familiar picture stops applying.

## Generic answer

The Jacobian of the lens mapping describes local distortions. Its components can be related to convergence, shear and rotation.

This names the object and its consequences without explaining why the object arises.

## Preferred construction

Start with the familiar thin-lens equation (real-is-positive convention, object distance \(u\), image distance \(v\)):

\[ \frac{1}{f} = \frac{1}{u} + \frac{1}{v}. \]

It gives an intuitive picture of how a lens changes ray paths. In gravitational lensing, the deflection depends on the gravitational field and the ray's trajectory, so for an extended lens, rays passing at different impact parameters are deflected by different amounts. This is where the thin-lens picture stops applying: there is no single focal length.

Consequently, neighbouring rays need not stay separated by the same amount as they propagate. A bundle can stretch in one direction and compress in another.

Now introduce the angular mapping

\[ \beta_i = \theta_i - \alpha_i(\boldsymbol{\theta}), \]

where \(\alpha_i\) is the deflection field in this convention. Its Jacobian is

\[ A_{ij} = \frac{\partial \beta_i}{\partial \theta_j} = \delta_{ij} - \frac{\partial \alpha_i}{\partial \theta_j}. \]

The deflection gives the displacement of a ray; its derivative gives how that displacement changes between neighbouring rays. The Jacobian therefore describes the local deformation of the angular mapping.

## Teaching lesson

Use familiar physics to establish intuition, then derive the mathematical object that captures the effect.

## Accuracy constraint

A general gravitational lens does not have one ordinary focal length set only by mass and ray height. Magnification is associated with the area mapping (\(\mu = 1/\det A\)); it is not generally a universal factor relating intrinsic and observed physical speeds. The thin-lens equation's form depends on the sign convention: with the Cartesian convention it reads \(1/f = 1/v - 1/u\).
