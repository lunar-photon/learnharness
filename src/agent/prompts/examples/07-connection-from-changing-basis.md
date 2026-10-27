# Deriving the connection from a changing basis

Lesson: Recover an abstract object from a familiar operation, compute its concrete components, then show that the abstract formula reproduces them.

## Generic answer

The Christoffel symbols are

\[ \Gamma^k{}_{ij} = \tfrac12 g^{kl}\left(\partial_i g_{jl} + \partial_j g_{il} - \partial_l g_{ij}\right). \]

They appear in covariant derivatives.

## Preferred construction

Start with a position vector in polar coordinates, \(\mathbf r = r\,\hat e_r\). Differentiating with respect to time,

\[ \frac{d\mathbf r}{dt} = \dot r\,\hat e_r + r\,\frac{d\hat e_r}{dt}. \]

The radial unit vector changes direction with \(\theta\):

\[ \frac{d\hat e_r}{dt} = \frac{\partial \hat e_r}{\partial\theta}\,\dot\theta = \dot\theta\,\hat e_\theta, \qquad\text{so}\qquad \frac{d\mathbf r}{dt} = \dot r\,\hat e_r + r\dot\theta\,\hat e_\theta. \]

The angular term exists because the basis changes.

For a vector field in a position-dependent coordinate basis, \(V = V^j e_j\),

\[ \partial_i V = (\partial_i V^j)\, e_j + V^j\, \partial_i e_j. \]

The coordinate-basis connection coefficients encode the basis derivative within the tangent space, \(\nabla_i e_j = \Gamma^k{}_{ij}\, e_k\), and consequently

\[ \nabla_i V^k = \partial_i V^k + \Gamma^k{}_{ij} V^j. \]

**Compute the coefficients.** For the Euclidean plane in polar coordinates, \(ds^2 = dr^2 + r^2 d\theta^2\), so \(g_{rr} = 1\), \(g_{\theta\theta} = r^2\), \(g_{r\theta} = 0\). From the metric formula,

\[ \Gamma^r{}_{\theta\theta} = -\tfrac12 g^{rr}\partial_r g_{\theta\theta} = -\tfrac12 \partial_r (r^2) = -r, \qquad \Gamma^\theta{}_{r\theta} = \tfrac12 g^{\theta\theta}\partial_r g_{\theta\theta} = \tfrac12 \cdot \frac{1}{r^2} \cdot 2r = \frac1r. \]

Hence \(\Gamma^r{}_{\theta\theta} = -r\) and \(\Gamma^\theta{}_{r\theta} = \Gamma^\theta{}_{\theta r} = 1/r\): different components of the same connection.

**Connect to the sphere.** Embed the sphere in three-dimensional Euclidean space, where the Cartesian basis is fixed. Write the sphere's tangent basis in that fixed basis and differentiate it; the derivative shows how the tangent basis changes over the sphere. The full derivative can have a component normal to the sphere; the intrinsic connection is its projection onto the tangent space.

## Teaching lesson

Recover an abstract object from a familiar operation, calculate its concrete components, then show that the abstract formula reproduces them. The example is a genuine instance of the concept, not merely an analogy.
