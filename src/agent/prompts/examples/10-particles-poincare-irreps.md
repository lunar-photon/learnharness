# "Particles are irreducible representations of the Poincaré group"

Lesson: Decompress a dense slogan into its constituents, each one already familiar (a representation, a basis change, block-diagonal form, irreducibility), then reassemble the slogan so every word means something.

## Generic answer

Wigner showed that elementary particles correspond to the unitary irreducible representations of the Poincaré group. These are classified by the eigenvalues of the Casimir operators \(P^\mu P_\mu = m^2\) and \(W^\mu W_\mu\), i.e. by mass and spin (helicity for massless particles).

True, and the standard statement, but every noun in it ("unitary irreducible representation", "Casimir") is something the learner has to unpack before the sentence says anything.

## Preferred construction

**A symmetry acts on states.** Rotations, boosts and translations form the Poincaré group. Each transformation \(g\) acts on the space of quantum states through an operator \(U(g)\), and doing two transformations is the same as doing their product, \(U(g_1)\,U(g_2) = U(g_1 g_2)\). A set of operators with that property is a *representation* of the group.

**In a generic basis the matrices are full.** Write every \(U(g)\) as a matrix in some basis of states. A boost could, as far as the matrix shows, mix every state with every other.

**Change basis until they are block diagonal, all at once.** Choose a basis in which every \(U(g)\) has the same block-diagonal form:

\[ U(g) = \begin{pmatrix} D_1(g) & 0 & \cdots \\ 0 & D_2(g) & \cdots \\ \vdots & \vdots & \ddots \end{pmatrix} \quad \text{for every } g . \]

Then the state space splits into pieces that no symmetry transformation ever mixes: a state in block 1 stays in block 1 under every rotation, boost and translation.

**Split until nothing splits further.** If a block can itself be brought to block-diagonal form, split it. A block that cannot be split any further is *irreducible*.

**A particle is one irreducible block.** Take an electron. A boost changes its momentum, a rotation changes its spin component, a translation changes its phase, but no Poincaré transformation turns an electron state into a photon state or into a two-electron state. The states of one electron, at every momentum and every spin orientation, are exactly the basis vectors of one block that cannot be split. That block *is* "the electron" as far as spacetime symmetry is concerned.

**Why mass and spin label particles.** Within one irreducible block, some quantities are the same for every state: \(P^\mu P_\mu = m^2\) (the mass) and the spin. They are what all the block's states share, so they name the block, which is why particles are classified by mass and spin.

So: "particles are irreducible representations of the Poincaré group" means *a particle is a smallest set of states that spacetime symmetries turn into one another and never into anything else*.

## Teaching lesson

The slogan was broken into constituents the learner already holds: matrices that multiply like the group, a change of basis, block-diagonal form, "cannot be split further". Each was introduced in one step, and then the slogan was reassembled with every word meaningful, connected to something physical (an electron's states under boosts and rotations). Do this whenever a definition packs several abstract ideas into one sentence.

## Accuracy constraint

A particle corresponds to one irreducible block, the invariant subspace; its states are the basis of that block, not "the basis in which the representation is block diagonal". The representations must be unitary, and the nontrivial unitary ones of the (non-compact) Poincaré group are infinite-dimensional: each block is spanned by states \(|p,\sigma\rangle\) over the whole continuous mass shell, so "block-diagonal matrix" is the finite-dimensional picture of a decomposition into invariant subspaces. Half-integer spin needs the double cover (projective representations), and massless particles are labelled by helicity rather than spin. Multi-particle states live in reducible representations (tensor products), which is what "elementary" excludes.
