/**
 * Exam preparation (docs/agent-driver-plan.md §6a–6b): an exam's pattern,
 * its past-year-question (PYQ) bank, generated tests, and the attempts
 * every progress measure is derived from. Files live under
 * data/exams/<examId>/; the source material under PYQ/<folder>/.
 */

export type ExamQuestionType = "mcq" | "msq" | "numeric";

export interface ExamMarks {
	correct: number;
	/** Usually ≤ 0: negative marking. */
	wrong: number;
	unanswered: number;
}

export interface ExamSection {
	name: string;
	questionCount: number;
	types: ExamQuestionType[];
	marks: ExamMarks;
	/** Syllabus topics this section draws on (empty = the exam's topics). */
	topics?: string[];
}

export interface ExamDefinition {
	id: string;
	name: string;
	/** The material folder, relative to PYQ/ ("CGL"). */
	folder: string;
	durationMin: number;
	sections: ExamSection[];
	topics: string[];
	notes?: string;
	/** Questions per day for the streak. */
	dailyGoal: number;
	/** The exam-prep chat that owns this exam. */
	chatId: string;
	createdAt: string;
}

/** How a question is answered: option indexes (0-based) or a number. */
export interface ExamAnswer {
	choices?: number[];
	value?: number;
	tolerance?: number;
}

export interface ExamQuestion {
	id: string;
	type: ExamQuestionType;
	/** English text (Markdown + LaTeX). */
	question: string;
	/** Marathi (or other second-language) text, when the source had it. */
	questionAlt?: string;
	options?: string[];
	optionsAlt?: string[];
	answer: ExamAnswer;
	solution?: string;
	topics: string[];
	/** 1 (easy) – 5 (hard), on the exam's own scale. */
	difficulty: number;
	section?: string;
}

export interface PyqItem extends ExamQuestion {
	year: number;
	/** Paper label ("Prelim", "Mains Paper 2"). */
	paper: string;
	number: number;
	source: { file: string; page?: number; url?: string };
}

export interface TestQuestion extends ExamQuestion {
	origin: "generated" | "pyq";
	pyqId?: string;
	/** A held-out PYQ used once as a readiness probe. */
	probe?: boolean;
	/** The earlier missed question this one retests (fresh surface). */
	retestOf?: string;
}

export const CONFIDENCE_LEVELS = [0.5, 0.7, 0.9, 1] as const;

export interface TestResponse {
	choices?: number[];
	value?: number;
	confidence?: number;
	markedForReview?: boolean;
	visited?: boolean;
	timeSec: number;
}

export type TestKind = "quiz" | "mock";

export interface TestRecord {
	id: string;
	examId: string;
	kind: TestKind;
	status: "generating" | "ready" | "submitted" | "failed";
	error?: string;
	createdAt: string;
	durationSec: number;
	questions: TestQuestion[];
	responses: Record<string, TestResponse>;
	startedAt?: string;
	submittedAt?: string;
	/** Topics the test was weighted toward, and why (shown on the result page). */
	focus?: { topic: string; reason: string }[];
}

/** One graded answer — the single source of every progress measure. */
export interface Attempt {
	id: string;
	examId: string;
	testId: string;
	questionId: string;
	topics: string[];
	/** null = left unanswered. */
	correct: boolean | null;
	confidence?: number;
	timeSec: number;
	difficulty: number;
	at: string;
	probe?: boolean;
	pyqId?: string;
	retestOf?: string;
}
