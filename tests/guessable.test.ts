/**
 * Checks that can be answered without the idea are returned to the teacher
 * (owner, 2026-10-28): a right option copied from the teaching, or a right
 * option that stands out as the longest and most detailed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guessableChoiceProblems } from "../src/core/question-core.ts";

describe("guessableChoiceProblems", () => {
	it("flags the real lesson check whose right option is visibly the longest and most specific", () => {
		const input = {
			type: "check",
			options: [
				{ label: "It requires \\(L\\) to equal \\(\\ell_1+\\ell_2\\) exactly, removing off-diagonal mode couplings.", value: "a" },
				{ label: "It causes the disconnected noise \\(N_L^{(0)}\\) to scale with \\((2L+1)^2\\).", value: "b" },
				{ label: "It introduces an explicit dependence on azimuthal angle \\(M\\), breaking spherical isotropy.", value: "c" },
				{ label: "The sum over magnetic indices \\(m_1, m_2\\) collapses to \\(\\frac{\\delta_{LL'}\\delta_{MM'}}{2L+1}\\), making \\(A_L\\) completely independent of \\(M\\).", value: "d" },
			],
			correctAnswer: "d",
		};
		assert.match(guessableChoiceProblems(input, "").join(" "), /longest and most detailed/);
	});

	it("flags a right option copied from the teaching, but not in a prediction", () => {
		const teaching = "Since N1 depends linearly on the true lensing spectrum, the measured power becomes a linear system in C.";
		const input = {
			type: "check",
			options: [
				{ label: "N1 depends linearly on the true lensing spectrum", value: "a" },
				{ label: "N1 is independent of the lensing spectrum entirely", value: "b" },
				{ label: "N1 depends quadratically on the noise spectrum only", value: "c" },
			],
			correctAnswer: "a",
		};
		assert.match(guessableChoiceProblems(input, teaching).join(" "), /word for word/);
		assert.deepEqual(guessableChoiceProblems({ ...input, type: "predict" }, teaching), [], "a prediction precedes the teaching");
	});

	it("passes options of one form that need the idea, and leaves tap formats alone", () => {
		const input = {
			type: "check",
			options: [{ label: "$\\mathbf I+\\mathbf K$", value: "a" }, { label: "$\\mathbf K$", value: "b" }, { label: "$(\\mathbf I+\\mathbf K)^{-1}$", value: "c" }],
			correctAnswer: "a",
		};
		assert.deepEqual(guessableChoiceProblems(input, "d = (I + K) C"), []);
		assert.deepEqual(guessableChoiceProblems({ ...input, format: "order", correctAnswer: ["a", "b", "c"] }, ""), []);
	});
});
