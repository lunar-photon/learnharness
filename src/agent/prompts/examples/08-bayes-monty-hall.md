# Bayes' theorem through the Monty Hall problem

Lesson: Separate prediction from inference first, then turn "should I switch?" into "what made Monty open that door?": the observed event, the hypotheses that could have produced it, how likely it was under each, and only then priors and normalisation, so the information visibly shrinks the sample space.

## Generic answer

Bayes' theorem states

\[ P(H \mid E) = \frac{P(E \mid H)\,P(H)}{P(E)}, \qquad P(E) = \sum_i P(E \mid H_i)\,P(H_i). \]

In the Monty Hall problem you pick door A, Monty opens door C to show a goat, and you are asked whether to switch to B. Each door starts with prior \(\tfrac13\). Applying Bayes' theorem gives \(P(\text{car behind B} \mid \text{Monty opened C}) = \tfrac23\), so you should switch.

This is correct, but it starts from the formula, never says what kind of question Bayes' theorem answers, and leaves the 50–50 intuition ("two doors are left") standing unexplained.

## Preferred construction

**What kind of question is this?** Probability can be used to answer different kinds of questions. Sometimes probability is used to predict an uncertain event. The possible outcomes may be equally likely, in which case we can often proceed simply by counting, or they may be distributed unequally, in which case we need to know the corresponding probability distribution in order to make predictions. Sometimes, however, probability is used to infer which of several possible situations could have produced an observed event. We begin with an event that has already occurred and ask what possible hypotheses, histories, or mechanisms could have led to that outcome. We then want to determine, among these possibilities, which one is most consistent with what was observed. In cosmological parameter estimation, the observed event is the data \(d\), while the possible situations are the different cosmological models specified by the parameters \(\lambda\). Rather than predicting the data from a given model, we therefore ask which models could have produced the observed data. Bayes' theorem provides the rule for making this inference.

**Monty Hall as an inference.** Three doors hide one car and two goats. We choose door A. Monty, who knows where the car is, always opens one of the two other doors to show a goat, choosing at random when he has a choice. He opens door C.

*The event.* What we observed is "Monty opened door C". Call it \(M_C\).

*What made him open that door?* This replaces "should I switch?". Before any number, ask which situations could have produced this event. The only thing we do not know is where the car is, so the possible explanations are the three locations of the car: \(H_A\), \(H_B\), \(H_C\).

*How probable was the event under each hypothesis?* Take them one at a time. Monty knows where the car is, never opens our door, and never reveals the car.

- \(H_A\), the car is behind our door: B and C both hide goats, so he picks at random, \(P(M_C \mid H_A) = \tfrac12\).
- \(H_B\), the car is behind B: he cannot open A (ours) or B (the car), so he is forced to open C, \(P(M_C \mid H_B) = 1\).
- \(H_C\), the car is behind C: he never reveals the car, \(P(M_C \mid H_C) = 0\).

*Only then the priors, and normalise.* Each location had prior \(\tfrac13\), so

\[ P(H_B \mid M_C) = \frac{P(M_C \mid H_B)\,P(H_B)}{\sum_d P(M_C \mid H_d)\,P(H_d)} = \frac{1\cdot\tfrac13}{\tfrac12\cdot\tfrac13 + 1\cdot\tfrac13 + 0\cdot\tfrac13} = \frac{1/3}{1/2} = \frac23, \]

and likewise \(P(H_A \mid M_C) = \tfrac13\), \(P(H_C \mid M_C) = 0\).

**Information shrinks the sample space.** Draw the sample space as a square of area 1, cut into three equal strips for \(H_A\), \(H_B\), \(H_C\). The event \(M_C\) is a box covering half of the \(H_A\) strip, all of the \(H_B\) strip and none of the \(H_C\) strip: exactly the three likelihoods. Once we have seen \(M_C\), that box is the whole world, and its \(H_B\) piece is twice its \(H_A\) piece.

The usual intuition, "Monty removed one door, so the remaining two are 50–50", misses the information carried by Monty's choice: the observed event was twice as likely under \(H_B\) as under \(H_A\), so the posterior weights differ by a factor of two.

## Teaching lesson

Name the kind of question first: prediction runs from a known situation to an uncertain outcome; inference runs from an observed outcome back to the situations that could have produced it. Then reframe the puzzle's question ("should he switch?") as the inference question ("why did Monty open that door?") and follow the fixed order: the event, the hypotheses that could have produced it, the probability of the event under each (with a reason for each), and only then the priors and the normalisation. The rectangle picture shows the information shrinking the sample space, so the \(\tfrac23\) is seen rather than computed. For this learner the inference framing connects directly to cosmological parameter estimation: data \(d\), models \(\lambda\).

## Accuracy constraint

The \(\tfrac23\) depends on Monty's protocol: he knows where the car is, always opens an unchosen goat door, and chooses at random when both are goats. If he opened B or C at random and merely happened to show a goat behind C, then \(P(M_C \mid H_A) = P(M_C \mid H_B) = \tfrac12\) and the posterior is \(\tfrac12\) each: here the 50–50 intuition is right. State the protocol before the answer.
