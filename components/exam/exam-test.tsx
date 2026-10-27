"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONFIDENCE_LEVELS, type ExamDefinition, type TestQuestion, type TestRecord, type TestResponse } from "@/src/core";
import { MessageResponse } from "@/components/ai-elements/message";
import { ExamResult, type ExamResultData } from "@/components/exam/exam-result";

/**
 * The computer-based test page (docs/agent-driver-plan.md §6b): intro →
 * timed test with a question palette → result. The server owns the clock;
 * every answer autosaves, so a reload resumes where the learner was.
 */

type View = { exam: ExamDefinition; test: TestRecord; secondsLeft: number };
const btn = "lh-btn";
const primary = "lh-btn lh-btn-primary";
const confLabel = (c: number) => (c === 1 ? "Certain" : `${Math.round(c * 100)}%`);

/** "How sure?" right where the answer was given: one tap, keys 1-4, Esc skips. */
function ConfidencePopup({ onPick, onSkip }: { onPick: (c: number) => void; onSkip: () => void }) {
	return (
		<div
			role="dialog"
			aria-label="How sure are you?"
			className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl border-2 border-[var(--lh-gold)] bg-[var(--lh-gold-tint)] px-3 py-2"
			onKeyDown={(e) => {
				const n = Number(e.key);
				if (n >= 1 && n <= CONFIDENCE_LEVELS.length) { e.preventDefault(); onPick(CONFIDENCE_LEVELS[n - 1]!); }
				if (e.key === "Escape") { e.preventDefault(); onSkip(); }
			}}
		>
			<span className="text-sm font-extrabold text-[var(--lh-gold-text)]">How sure?</span>
			{CONFIDENCE_LEVELS.map((c, k) => (
				<button key={c} type="button" className={btn} autoFocus={k === 0} onClick={() => onPick(c)}>
					{confLabel(c)}<span className="sr-only"> (key {k + 1})</span>
				</button>
			))}
			<button type="button" className="ml-auto text-xs font-bold text-muted-foreground underline-offset-2 hover:underline" onClick={onSkip}>Skip</button>
		</div>
	);
}

function clock(sec: number): string {
	const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
	return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
}

const answered = (r?: TestResponse) => !!r && ((r.choices?.length ?? 0) > 0 || r.value !== undefined);

/** Palette state of one question, as the real CBT shows it. */
function statusOf(r?: TestResponse): "fresh" | "seen" | "answered" | "marked" | "answered-marked" {
	if (!r?.visited && !answered(r) && !r?.markedForReview) return "fresh";
	if (r?.markedForReview) return answered(r) ? "answered-marked" : "marked";
	return answered(r) ? "answered" : "seen";
}

const PALETTE: Record<ReturnType<typeof statusOf>, { cls: string; label: string }> = {
	fresh: { cls: "border-border bg-card text-muted-foreground", label: "Not visited" },
	seen: { cls: "border-rose-500/60 bg-rose-500/15 text-foreground", label: "Not answered" },
	answered: { cls: "border-emerald-500/60 bg-emerald-500/20 text-foreground rounded-t-lg", label: "Answered" },
	marked: { cls: "border-violet-500/60 bg-violet-500/20 text-foreground rounded-full", label: "Marked for review" },
	"answered-marked": { cls: "border-violet-500/60 bg-violet-500/20 text-foreground rounded-full ring-2 ring-emerald-500/70", label: "Answered and marked" },
};

export function ExamTest({ examId, testId }: { examId: string; testId: string }) {
	const [view, setView] = useState<View | null>(null);
	const [result, setResult] = useState<ExamResultData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [index, setIndex] = useState(0);
	const [left, setLeft] = useState(0);
	const [alt, setAlt] = useState(false);
	const [confirming, setConfirming] = useState(false);
	/** The answer just given, awaiting its confidence: question id and option (-1 = numeric). */
	const [asking, setAsking] = useState<{ q: string; at: number } | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const base = `/api/exams/${examId}/tests/${testId}`;
	const deadline = useRef(0);
	const enteredAt = useRef(Date.now());
	const responses = useRef<Record<string, TestResponse>>({});

	const load = useCallback(async () => {
		const res = await fetch(base, { cache: "no-store" });
		const body = await res.json();
		if (!res.ok) return setError(body.error ?? `HTTP ${res.status}`);
		if (body.test.status === "submitted") {
			const r = await fetch(`${base}?result=1`, { cache: "no-store" });
			return setResult(await r.json());
		}
		responses.current = body.test.responses;
		setView(body);
		setLeft(body.secondsLeft);
		deadline.current = Date.now() + body.secondsLeft * 1000;
	}, [base]);

	useEffect(() => { void load(); }, [load]);

	// While the test is being written, check back every few seconds.
	useEffect(() => {
		if (view?.test.status !== "generating") return;
		const t = setInterval(() => void load(), 4000);
		return () => clearInterval(t);
	}, [view?.test.status, load]);

	const started = !!view?.test.startedAt;
	const questions = view?.test.questions ?? [];
	const q: TestQuestion | undefined = questions[index];

	const submit = useCallback(async () => {
		setSubmitting(true);
		const res = await fetch(`${base}/submit`, { method: "POST" });
		const body = await res.json();
		setSubmitting(false);
		setConfirming(false);
		if (!res.ok) return setError(body.error ?? `HTTP ${res.status}`);
		setResult(body);
	}, [base]);

	// The countdown follows the server's deadline; zero submits.
	useEffect(() => {
		if (!started || result) return;
		const t = setInterval(() => {
			const s = Math.max(0, Math.round((deadline.current - Date.now()) / 1000));
			setLeft(s);
			if (s === 0) { clearInterval(t); void submit(); }
		}, 500);
		return () => clearInterval(t);
	}, [started, result, submit]);

	const save = useCallback(async (questionId: string, patch: Partial<TestResponse>) => {
		const next: TestResponse = { timeSec: 0, ...responses.current[questionId], ...patch };
		responses.current = { ...responses.current, [questionId]: next };
		setView((v) => (v ? { ...v, test: { ...v.test, responses: responses.current } } : v));
		const res = await fetch(`${base}/responses`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId, response: next }) }).catch(() => null);
		if (!res) return setError("Saving failed: check the connection. Your answers are kept on this page.");
		const body = await res.json();
		if (!res.ok) return setError(body.error);
		setError(null);
		deadline.current = Date.now() + body.secondsLeft * 1000;
	}, [base]);

	/** Leave the current question: bank its time, mark it visited. */
	const go = useCallback((to: number, patch: Partial<TestResponse> = {}) => {
		if (q) {
			const spent = (Date.now() - enteredAt.current) / 1000;
			const prev = responses.current[q.id];
			void save(q.id, { visited: true, timeSec: Math.round((prev?.timeSec ?? 0) + spent), ...patch });
		}
		enteredAt.current = Date.now();
		setIndex(Math.max(0, Math.min(questions.length - 1, to)));
	}, [q, questions.length, save]);

	const counts = useMemo(() => {
		const c = { answered: 0, marked: 0, unanswered: 0 };
		for (const x of questions) {
			const r = view?.test.responses[x.id];
			if (answered(r)) c.answered++; else c.unanswered++;
			if (r?.markedForReview) c.marked++;
		}
		return c;
	}, [questions, view?.test.responses]);

	if (result) return <ExamResult data={result} />;
	if (error && !view) return <p className="p-8 font-ui text-sm text-destructive" role="alert">{error}</p>;
	if (!view) return <p className="p-8 font-ui text-sm text-muted-foreground">Loading the test…</p>;
	const { exam, test } = view;

	if (test.status === "generating") return (
		<div className="mx-auto max-w-xl p-8 font-ui text-sm" role="status">
			<h1 className="mb-2 text-base font-medium">Writing your {test.kind === "mock" ? "mock test" : "quiz"}…</h1>
			<p className="text-muted-foreground">Every question is new, at or above the level of {exam.name}'s past papers, and solved before it reaches you. This takes a minute or two; the page updates by itself.</p>
		</div>
	);
	if (test.status === "failed") return <p className="p-8 font-ui text-sm text-destructive" role="alert">The test could not be written: {test.error}. Ask in your exam session for a new one.</p>;

	if (!started) {
		const section = exam.sections[0]!;
		return (
			<div className="mx-auto max-w-xl space-y-4 p-8 font-ui text-sm">
				<h1 className="text-base font-medium">{exam.name}: {test.kind === "mock" ? "full mock test" : "quiz"}</h1>
				<ul className="list-disc space-y-1 pl-5 text-muted-foreground">
					<li>{questions.length} questions, {clock(test.durationSec)} on the clock. It submits itself when time runs out.</li>
					<li>Marking: +{section.marks.correct} right, {section.marks.wrong} wrong, {section.marks.unanswered} unanswered{exam.sections.length > 1 ? " (per section, as in the real exam)" : ""}.</li>
					<li>For each answer, say how sure you are. Honest confidence earns the most XP and tells your lessons what to fix.</li>
					<li>The questions are pitched at or above the real exam. Finding them hard is expected: that is the point.</li>
				</ul>
				{test.focus?.length ? <p className="text-muted-foreground">This one leans on: {test.focus.map((f) => f.topic).join(", ")}.</p> : null}
				<button type="button" className={primary} onClick={async () => {
					const res = await fetch(`${base}/start`, { method: "POST" });
					const body = await res.json();
					if (!res.ok) return setError(body.error);
					responses.current = body.test.responses;
					enteredAt.current = Date.now();
					deadline.current = Date.now() + body.secondsLeft * 1000;
					setView(body);
					setLeft(body.secondsLeft);
				}}>Start the test</button>
				{error && <p className="text-destructive" role="alert">{error}</p>}
			</div>
		);
	}

	const r = q ? test.responses[q.id] : undefined;
	const text = alt && q?.questionAlt ? q.questionAlt : q?.question ?? "";
	const options = alt && q?.optionsAlt?.length === q?.options?.length ? q?.optionsAlt : q?.options;
	const low = left <= 300;

	return (
		// Full screen while the clock runs, as a real computer-based test is.
		<div className="fixed inset-0 z-40 flex flex-col bg-background font-ui text-sm">
			<div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
			<header className="flex items-center gap-3 border-b border-border px-4 py-2">
				<span className="truncate font-medium">{exam.name} · {test.kind === "mock" ? "Mock test" : "Quiz"}</span>
				<span className="ml-auto tabular-nums" role="timer" aria-label={`Time left ${clock(left)}`}>
					<span className={low ? "text-destructive" : "text-foreground"}>{clock(left)}</span>
				</span>
				<button type="button" className={primary} onClick={() => setConfirming(true)}>Submit</button>
			</header>
			<div className="flex min-h-0 flex-1 flex-col md:flex-row">
				<main className="order-2 flex min-w-0 flex-1 flex-col overflow-y-auto p-4 md:order-1">
					{q && (
						<>
							<div className="mb-3 flex items-center gap-3">
								<h2 className="font-medium">Question {index + 1} of {questions.length}</h2>
								{q.type === "msq" && <span className="text-xs text-muted-foreground">Select all that apply</span>}
								{q.questionAlt && (
									<button type="button" className={`${btn} ml-auto`} aria-pressed={alt} onClick={() => setAlt((a) => !a)}>
										{alt ? "English" : "मराठी"}
									</button>
								)}
							</div>
							<div className="lh-prose mb-4"><MessageResponse>{text}</MessageResponse></div>
							{q.type === "numeric" ? (
								<label className="mb-4 flex items-center gap-2">
									<span>Your answer</span>
									<input
										type="number"
										inputMode="decimal"
										step="any"
										className="w-40 rounded-sm border border-border bg-card px-2 py-1"
										value={r?.value ?? ""}
										onChange={(e) => void save(q.id, { value: e.target.value === "" ? undefined : Number(e.target.value) })}
										onBlur={() => r?.value !== undefined && r.confidence === undefined && setAsking({ q: q.id, at: -1 })}
										onKeyDown={(e) => e.key === "Enter" && r?.value !== undefined && setAsking({ q: q.id, at: -1 })}
									/>
								</label>
							) : (
								<fieldset className="mb-4 space-y-2">
									<legend className="sr-only">Options</legend>
									{options?.map((opt, i) => {
										const checked = r?.choices?.includes(i) ?? false;
										return (
											<div key={i}>
											<label className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-b-4 px-4 py-3 text-base font-bold transition-colors ${checked ? "border-[var(--lh-blue)] bg-[var(--lh-blue-tint)]" : "border-[var(--lh-edge)] bg-card hover:bg-accent"}`}>
												<input
													type={q.type === "msq" ? "checkbox" : "radio"}
													name={`q-${q.id}`}
													className="mt-1"
													checked={checked}
													onChange={() => {
														const choices = q.type === "msq" ? (checked ? (r?.choices ?? []).filter((c) => c !== i) : [...(r?.choices ?? []), i]) : [i];
														// A new single answer needs its own confidence; a multi-select asks once.
														void save(q.id, q.type === "msq" ? { choices } : { choices, confidence: undefined });
														if (!checked && (q.type !== "msq" || r?.confidence === undefined)) setAsking({ q: q.id, at: i });
													}}
												/>
												<span className="flex min-w-0 flex-1 gap-2"><span className="text-muted-foreground">{i + 1}.</span><span className="min-w-0 flex-1"><MessageResponse>{opt}</MessageResponse></span></span>
											</label>
											{asking?.q === q.id && asking.at === i && (
												<ConfidencePopup onPick={(c) => { void save(q.id, { confidence: c }); setAsking(null); }} onSkip={() => setAsking(null)} />
											)}
											</div>
										);
									})}
								</fieldset>
							)}
							{asking?.q === q.id && asking.at === -1 && (
								<ConfidencePopup onPick={(c) => { void save(q.id, { confidence: c }); setAsking(null); }} onSkip={() => setAsking(null)} />
							)}
							<p className="mb-6 mt-1 min-h-6 text-sm font-bold text-muted-foreground">
								{answered(r) && asking?.q !== q.id && (
									r?.confidence !== undefined
										? <>Confidence: {confLabel(r.confidence)} · <button type="button" className="underline-offset-2 hover:underline" onClick={() => setAsking({ q: q.id, at: q.type === "numeric" ? -1 : (r.choices?.[0] ?? 0) })}>change</button></>
										: <button type="button" className="underline-offset-2 hover:underline" onClick={() => setAsking({ q: q.id, at: q.type === "numeric" ? -1 : (r?.choices?.[0] ?? 0) })}>Add how sure you are (earns calibration XP)</button>
								)}
							</p>
							<div className="mt-auto flex flex-wrap gap-2">
								<button type="button" className={btn} disabled={index === 0} onClick={() => go(index - 1)}>Previous</button>
								<button type="button" className={btn} onClick={() => void save(q.id, { choices: undefined, value: undefined, confidence: undefined })}>Clear</button>
								<button type="button" className={btn} onClick={() => go(index + 1, { markedForReview: !r?.markedForReview })}>
									{r?.markedForReview ? "Unmark" : "Mark for review"} &amp; next
								</button>
								<button type="button" className={primary} onClick={() => go(index + 1, { markedForReview: false })}>Save &amp; next</button>
							</div>
							{error && <p className="mt-2 text-destructive" role="alert">{error}</p>}
						</>
					)}
				</main>
				<nav aria-label="Question palette" className="order-1 max-h-32 shrink-0 overflow-y-auto border-b border-border p-3 md:order-2 md:max-h-none md:w-64 md:border-b-0 md:border-l">
					<div className="grid grid-cols-8 gap-1.5 md:grid-cols-5">
						{questions.map((x, i) => {
							const s = statusOf(test.responses[x.id]);
							return (
								<button
									key={x.id}
									type="button"
									aria-label={`Question ${i + 1}: ${PALETTE[s].label}`}
									aria-current={i === index ? "true" : undefined}
									className={`h-8 border text-xs tabular-nums ${PALETTE[s].cls} ${i === index ? "outline outline-2 outline-offset-1 outline-foreground" : ""}`}
									onClick={() => go(i)}
								>
									{i + 1}
								</button>
							);
						})}
					</div>
					<ul className="mt-4 hidden space-y-1 text-xs text-muted-foreground md:block">
						{(Object.keys(PALETTE) as (keyof typeof PALETTE)[]).map((k) => (
							<li key={k} className="flex items-center gap-2"><span className={`inline-block size-4 border ${PALETTE[k].cls}`} aria-hidden="true" />{PALETTE[k].label}</li>
						))}
					</ul>
					<p className="mt-4 text-xs text-muted-foreground">{counts.answered} answered · {counts.unanswered} left · {counts.marked} marked</p>
				</nav>
			</div>
			</div>
			{confirming && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80" role="dialog" aria-modal="true" aria-labelledby="submit-title">
					<div className="w-full max-w-sm space-y-3 rounded-sm border border-border bg-card p-4">
						<h2 id="submit-title" className="font-medium">Submit the test?</h2>
						<p className="text-muted-foreground">{counts.answered} answered, {counts.unanswered} unanswered, {counts.marked} marked for review. You can't change answers after submitting.</p>
						<div className="flex justify-end gap-2">
							<button type="button" className={btn} onClick={() => setConfirming(false)} autoFocus>Keep going</button>
							<button type="button" className={primary} disabled={submitting} onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit"}</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
