"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { QuestionDock } from "@/components/question-dock";
import { SidebarToggle } from "@/components/sidebar";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { coerceCorrectAnswer, normalizeOptions, type QuestionAnswerData, type ReviewAnswer, type ReviewQuestion, type ReviewSet } from "@/src/core";

/**
 * A spaced-review set (core/review.ts): one question at a time in the
 * lesson's own check (tap formats, How sure?), the server grading each,
 * then the results with every explanation and each node's next review.
 * A miss offers "Explain this": a lesson on that node.
 */

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

function inDays(iso: string): string {
	const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
	return `${days <= 1 ? "tomorrow" : `in ${days} days`} (${dayFmt.format(new Date(iso))})`;
}

/** The option labels for a list of values, in that order. */
function labels(q: ReviewQuestion, values: readonly string[]): string[] {
	const options = normalizeOptions(q.quiz.options);
	return values.map((v) => options.find((o) => o.value === v)?.label ?? v);
}

export function ReviewRun({ id }: { id: string }) {
	const router = useRouter();
	const [set, setSet] = useState<ReviewSet | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [sending, setSending] = useState(false);

	const load = useCallback(async () => {
		const res = await fetch(`/api/reviews/${id}`, { cache: "no-store" }).catch(() => null);
		if (res?.ok) setSet((await res.json()) as ReviewSet);
		else setError("Couldn't load this review.");
	}, [id]);
	useEffect(() => { void load(); }, [load]);
	// Poll while the questions are being written.
	useEffect(() => {
		if (set?.status !== "generating") return;
		const t = setInterval(() => void load(), 2000);
		return () => clearInterval(t);
	}, [set?.status, load]);

	const current = set?.questions.find((q) => !set.answers[q.id]);

	const answer = async (q: ReviewQuestion, a: QuestionAnswerData) => {
		setSending(true);
		setError(null);
		const res = await fetch(`/api/reviews/${id}/answer`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ questionId: q.id, values: a.answers.map((x) => x.value), dontKnow: a.dontKnow, confidence: a.confidence }),
		}).catch(() => null);
		setSending(false);
		if (!res?.ok) return setError("Couldn't save that answer. Try again.");
		const saved = (await res.json()) as ReviewAnswer;
		setSet((s) => (s ? { ...s, answers: { ...s.answers, [q.id]: saved }, status: Object.keys(s.answers).length + 1 === s.questions.length ? "done" : s.status } : s));
	};

	const explain = async (q: ReviewQuestion) => {
		const res = await fetch("/api/chats", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: `Explain: ${q.nodeName}`, graphContext: { propositions: [{ id: q.nodeId, name: q.nodeName, statement: q.nodeStatement }] } }),
		}).catch(() => null);
		if (!res?.ok) return setError("Couldn't start the lesson.");
		const { id: chatId } = (await res.json()) as { id: string };
		router.push(`/chat/${chatId}?prompt=${encodeURIComponent(`I missed a review on "${q.nodeName}". Explain it again.`)}`);
	};

	const answeredCount = set ? Object.keys(set.answers).length : 0;
	const right = set ? Object.values(set.answers).filter((a) => a.correct).length : 0;

	return (
		<div className="relative h-dvh overflow-y-auto">
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			<header className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 px-3 py-2">
				<div className="pointer-events-auto"><SidebarToggle /></div>
			</header>
			<main className="mx-auto flex w-full max-w-[46rem] flex-col gap-5 px-4 pb-14 pt-16">
				<div className="flex items-center gap-3">
					<h1 className="mr-auto text-2xl font-black">Review</h1>
					{set && set.status !== "generating" && <span className="font-black tabular-nums text-muted-foreground">{Math.min(answeredCount + (current ? 1 : 0), set.questions.length)} / {set.questions.length}</span>}
				</div>
				{set && set.questions.length > 0 && (
					<div className="h-3 overflow-hidden rounded-full bg-border" role="progressbar" aria-label="Review progress" aria-valuenow={answeredCount} aria-valuemin={0} aria-valuemax={set.questions.length}>
						<div className="h-full rounded-full bg-[var(--lh-orange)] transition-[width]" style={{ width: `${(answeredCount / set.questions.length) * 100}%` }} />
					</div>
				)}
				{error && <p role="alert" className="font-bold text-destructive">{error}</p>}

				{!set && !error && <p className="text-muted-foreground">Loading…</p>}
				{set?.status === "generating" && <p className="font-bold text-muted-foreground" role="status">Writing your review questions (a minute or so)…</p>}
				{set?.status === "failed" && (
					<p role="alert" className="font-bold text-destructive">The questions couldn't be written: {set.error}. <Link href="/">Back home</Link></p>
				)}

				{set?.status === "ready" && current && (
					// The page scrolls, so the dock's lesson height cap is lifted.
					<section aria-label={`Question about ${current.nodeName}`} className="overflow-hidden rounded-2xl border bg-card shadow-lg" style={{ "--dock-max-h": "none" } as React.CSSProperties}>
						<p className="px-4 pt-3 text-sm font-bold text-muted-foreground">{current.nodeName}</p>
						<fieldset disabled={sending} className="contents">
							<QuestionDock
								key={current.id}
								toolName="quiz"
								toolCallId={current.id}
								input={{ type: "check", ...current.quiz } as never}
								expanded
								onExpand={() => {}}
								onSubmit={(a) => void answer(current, a)}
							/>
						</fieldset>
					</section>
				)}

				{set && set.status !== "generating" && set.status !== "failed" && !current && (
					<section aria-labelledby="review-done" className="flex flex-col gap-4">
						<div className="rounded-3xl border-2 border-b-[6px] border-[var(--lh-green-edge)] bg-[var(--lh-green-tint)] p-5">
							<h2 id="review-done" className="text-xl font-black text-[var(--lh-green)]">Review done: {right} of {set.questions.length} right</h2>
							<p className="font-bold">Each idea comes back when it is about to fade: a miss tomorrow, a sure answer later.</p>
						</div>
						{set.questions.map((q) => {
							const a = set.answers[q.id];
							if (!a) return null;
							const key = coerceCorrectAnswer(q.quiz.correctAnswer, normalizeOptions(q.quiz.options).map((o) => o.value));
							return (
								<article key={q.id} className={`flex flex-col gap-2 rounded-2xl border-2 p-4 ${a.correct ? "border-green-500/50" : "border-red-500/50"}`}>
									<div className="flex flex-wrap items-center gap-2 text-sm font-extrabold">
										<span className={`rounded-full px-2.5 py-0.5 ${a.correct ? "bg-green-500/15 text-green-600" : "bg-red-500/15 text-red-600"}`}>{a.correct ? "Right" : a.dontKnow ? "Didn't know" : "Missed"}</span>
										<span className="text-muted-foreground">{q.nodeName} · next review {inDays(a.nextDue)}</span>
									</div>
									<div className="lh-prose font-bold"><ToolContentResponse>{q.quiz.question}</ToolContentResponse></div>
									{!a.correct && !a.dontKnow && (
										<div className="lh-prose flex items-baseline gap-2 text-sm"><span className="shrink-0 font-bold">You:</span><ToolContentResponse>{labels(q, a.values).join(q.quiz.format === "order" ? " → " : ", ")}</ToolContentResponse></div>
									)}
									<div className="lh-prose flex items-baseline gap-2 text-sm"><span className="shrink-0 font-bold">Answer:</span><ToolContentResponse>{labels(q, key).join(q.quiz.format === "order" ? " → " : ", ")}</ToolContentResponse></div>
									<div className="lh-prose text-sm text-muted-foreground"><ToolContentResponse>{q.quiz.explanation}</ToolContentResponse></div>
									{!a.correct && (
										<div><button type="button" className="lh-btn" onClick={() => void explain(q)}>Explain this</button></div>
									)}
								</article>
							);
						})}
						<div><Link href="/" className="lh-btn lh-btn-primary inline-block">Back home</Link></div>
					</section>
				)}
			</main>
		</div>
	);
}
