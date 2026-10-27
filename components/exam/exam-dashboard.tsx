"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExamDefinition, ExamSummary, TestRecord, TestScore } from "@/src/core";

/**
 * The exam dashboard (docs/agent-driver-plan.md §6b): today's goal, the
 * streak, XP, readiness from held-out past-paper questions, mastery per
 * topic, and the tests. Every number is derived from attempts server-side.
 */

interface Dashboard {
	exam: ExamDefinition;
	summary: ExamSummary;
	bank: { items: number; heldOut: number; papers: number };
	tests: { id: string; kind: TestRecord["kind"]; status: TestRecord["status"]; createdAt: string; questions: number; score?: TestScore }[];
}

const btn = "lh-btn";
const primary = "lh-btn lh-btn-primary";
const pct = (x: number) => `${Math.round(x * 100)}%`;

const TONES = {
	plain: "border-border bg-card",
	orange: "border-[#fdcfa8] bg-[var(--lh-orange-tint)] text-[var(--lh-orange-text)] dark:border-transparent",
	gold: "border-[#f5d77a] bg-[var(--lh-gold-tint)] text-[var(--lh-gold-text)] dark:border-transparent",
	blue: "border-[#a9c9f2] bg-[var(--lh-blue-tint)] dark:border-transparent",
} as const;

function Tile({ label, value, detail, children, tone = "plain" }: { label: string; value: string; detail?: string; children?: React.ReactNode; tone?: keyof typeof TONES }) {
	return (
		<div className={`rounded-2xl border-2 border-b-[6px] p-4 ${TONES[tone]}`}>
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="mt-1 text-2xl font-black tabular-nums">{value}</div>
			{children}
			{detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
		</div>
	);
}

/** A 0–1 meter with an optional interval band; the value is printed, so the bar is never the only carrier. */
function Meter({ value, low, high, label }: { value: number; low?: number; high?: number; label: string }) {
	return (
		<div className="relative mt-2 h-3 rounded-full bg-[var(--lh-edge)]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label={label}>
			{low !== undefined && high !== undefined && (
				<div className="absolute inset-y-0 rounded-full bg-foreground/25" style={{ left: `${low * 100}%`, width: `${Math.max(0, high - low) * 100}%` }} />
			)}
			<div className="absolute inset-y-0 left-0 rounded-full bg-[var(--lh-orange)]" style={{ width: `${Math.min(1, value) * 100}%` }} />
		</div>
	);
}

function Pips({ level }: { level: number }) {
	return (
		<span className="inline-flex gap-1" aria-label={`Mastery level ${level} of 5`} role="img">
			{[1, 2, 3, 4, 5].map((k) => <span key={k} className={`size-4 rounded-md ${k <= level ? "bg-[var(--lh-purple)]" : "border-2 border-[var(--lh-edge)]"}`} />)}
		</span>
	);
}

export function ExamDashboard({ examId }: { examId: string }) {
	const router = useRouter();
	const [data, setData] = useState<Dashboard | null>(null);
	const [missing, setMissing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [starting, setStarting] = useState<string | null>(null);
	const [goal, setGoal] = useState("");
	const [folder, setFolder] = useState<string | null>(null);

	const load = useCallback(async () => {
		const res = await fetch(`/api/exams/${examId}`, { cache: "no-store" });
		if (res.status === 404) return setMissing(true);
		const body = await res.json();
		if (!res.ok) return setError(body.error);
		setData(body);
		setGoal(String(body.exam.dailyGoal));
		const pyq = await fetch("/api/pyq", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null), () => null);
		if (pyq?.path) setFolder(`${pyq.path}/${body.exam.folder}`);
	}, [examId]);
	useEffect(() => { void load(); }, [load]);

	if (missing) return (
		<div className="mx-auto max-w-xl p-8 font-ui text-sm">
			<h1 className="mb-2 text-base font-medium">This exam isn't set up yet</h1>
			<p className="text-muted-foreground">Go back to your exam-prep session: it settles the exam's pattern and reads its past papers first.</p>
		</div>
	);
	if (!data) return <p className="p-8 font-ui text-sm text-muted-foreground">{error ?? "Loading…"}</p>;
	const { exam, summary, bank, tests } = data;
	const { daily, readiness } = summary;

	const start = async (kind: "quiz" | "mock") => {
		setStarting(kind);
		setError(null);
		const res = await fetch(`/api/exams/${examId}/tests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
		const body = await res.json();
		setStarting(null);
		if (!res.ok) return setError(body.error);
		router.push(`/exam/${examId}/test/${body.id}`);
	};

	const saveGoal = async () => {
		const res = await fetch(`/api/exams/${examId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dailyGoal: Number(goal) }) });
		const body = await res.json();
		if (!res.ok) return setError(body.error);
		void load();
	};

	return (
		<div className="mx-auto max-w-4xl space-y-6 p-6 font-ui text-sm">
			<header className="flex flex-wrap items-end gap-3">
				<div className="min-w-0 flex-1">
					<h1 className="text-xl font-medium">{exam.name}</h1>
					<p className="text-muted-foreground">
						{exam.sections.map((s) => `${s.questionCount} questions`).join(" + ")} · {exam.durationMin} min · past-paper bank: {bank.items} question{bank.items === 1 ? "" : "s"} from {bank.papers} paper{bank.papers === 1 ? "" : "s"} ({bank.heldOut} held back to measure readiness)
					</p>
				</div>
				<a className={btn} href={`/chat/${exam.chatId}`}>Back to the session</a>
				<button type="button" className={btn} disabled={starting !== null} onClick={() => void start("quiz")}>{starting === "quiz" ? "Writing…" : "Quick quiz"}</button>
				<button type="button" className={primary} disabled={starting !== null} onClick={() => void start("mock")}>{starting === "mock" ? "Writing…" : "Full mock test"}</button>
			</header>
			{folder && (
				<p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<span>Material folder: <code className="break-all">{folder}</code>. Add papers, keys or notes here and ask your session to read them.</span>
					<button type="button" className={btn} onClick={() => void fetch("/api/pyq", { method: "POST" })}>Open folder</button>
				</p>
			)}
			{error && <p className="text-destructive" role="alert">{error}</p>}

			<section aria-label="Progress" className="grid grid-cols-2 gap-2 md:grid-cols-4">
				<Tile label="Today" value={`${daily.today} / ${daily.goal}`} detail={daily.today >= daily.goal ? "Daily goal met" : `${daily.goal - daily.today} questions to go`}>
					<Meter value={daily.today / Math.max(1, daily.goal)} label="Daily goal progress" />
				</Tile>
				<Tile tone="orange" label="Streak" value={`${daily.streak} day${daily.streak === 1 ? "" : "s"}`} detail={daily.frozen.length ? `${daily.frozen.length} missed day covered by the freeze` : "One missed day a week is covered"} />
				<Tile tone="gold" label="XP" value={String(summary.xp)} detail="Right answers and honest confidence earn the most" />
				<Tile
					tone="blue"
					label="Readiness"
					value={readiness.enough ? pct(readiness.expected!) : "—"}
					detail={readiness.enough ? `Likely ${pct(readiness.low!)}–${pct(readiness.high!)} of the maximum, from ${readiness.probes} unseen past-paper questions` : `Needs 5 unseen past-paper questions (${readiness.probes} so far); full mocks include them`}
				>
					{readiness.enough && <Meter value={readiness.expected!} low={readiness.low} high={readiness.high} label="Estimated exam score" />}
				</Tile>
			</section>

			<section aria-labelledby="mastery-title">
				<h2 id="mastery-title" className="mb-2 font-medium">Topic mastery</h2>
				<p className="mb-2 text-xs text-muted-foreground">A level rises at most once a day, on new questions at past-paper level; a slump lowers it.</p>
				<table className="w-full text-left">
					<thead className="text-xs text-muted-foreground"><tr><th className="py-1 font-normal">Topic</th><th className="font-normal">Level</th><th className="font-normal">Accuracy estimate</th><th className="font-normal">Next</th></tr></thead>
					<tbody>
						{summary.mastery.map((m) => {
							const f = summary.focus.find((x) => x.topic === m.topic);
							return (
								<tr key={m.topic} className="border-t border-border">
									<td className="py-1.5">{m.topic}</td>
									<td><Pips level={m.level} /></td>
									<td className="tabular-nums">{m.evidence < 0.5 ? "—" : pct(m.mean)}</td>
									<td className="text-xs text-muted-foreground">{f?.reason}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</section>

			{summary.calibration.some((b) => b.verdict !== "too few") && (
				<section aria-labelledby="calib-title">
					<h2 id="calib-title" className="mb-2 font-medium">Confidence vs accuracy, all tests</h2>
					<ul className="space-y-1">
						{summary.calibration.filter((b) => b.verdict !== "too few").map((b) => (
							<li key={b.confidence}>Said {b.confidence === 1 ? "certain" : pct(b.confidence)}: right {pct(b.accuracy)} of {b.n}, {b.verdict}.</li>
						))}
					</ul>
				</section>
			)}

			<section aria-labelledby="tests-title">
				<h2 id="tests-title" className="mb-2 font-medium">Tests</h2>
				{tests.length === 0 ? <p className="text-muted-foreground">No tests yet. Start with a quick quiz.</p> : (
					<ul className="space-y-1">
						{tests.map((t) => (
							<li key={t.id} className="flex items-center gap-3 border-t border-border py-1.5">
								<a className="flex-1 hover:underline" href={`/exam/${examId}/test/${t.id}`}>{t.kind === "mock" ? "Mock test" : "Quiz"} · {new Date(t.createdAt).toLocaleString()}</a>
								<span className="tabular-nums text-muted-foreground">{t.score ? `${t.score.score} / ${t.score.max}` : t.status === "ready" ? "Not taken" : t.status}</span>
							</li>
						))}
					</ul>
				)}
			</section>

			<section aria-labelledby="goal-title" className="flex items-end gap-2">
				<label className="flex flex-col gap-1">
					<span id="goal-title" className="text-xs text-muted-foreground">Daily goal (questions)</span>
					<input type="number" min={1} max={500} value={goal} onChange={(e) => setGoal(e.target.value)} className="w-24 rounded-sm border border-border bg-card px-2 py-1" />
				</label>
				<button type="button" className={btn} onClick={() => void saveGoal()}>Save</button>
			</section>
		</div>
	);
}
