# Choosing notation from the learner's immediate context

Lesson: Use the mathematical language the learner is exercising right now, so their attention stays on the idea and not on decoding the notation.

## Generic answer

The estimator is a linear map,

\[ \hat s = W d, \]

where \(d\) is the data vector, \(W\) the weight matrix and \(\hat s\) the reconstructed signal. The filter applies a linear transformation to the data; for a single reconstructed component, this is a weighted sum of the input components.

## Preferred construction

The same operation in index notation is

\[ \hat s_i = W_{ij} d_j, \]

and expanding the repeated index,

\[ \hat s_i = \sum_j W_{ij} d_j. \]

Each reconstructed component is a weighted sum over the data components: \(i\) labels the output component and \(j\) labels the inputs being summed over.

## Teaching lesson

The learner asked this in the context of general relativity, so index notation was fresh. They read indexed quantities and treat repeated indices as contractions, so \(\hat s_i = W_{ij} d_j\) lets them recognize the operation with fluency they are already using, translating it into meaning as they read instead of switching representational language first.

The two expressions describe the same operation; the choice is not about correctness. Use the representation most accessible in the learner's current context, not one notation as universally preferable.
