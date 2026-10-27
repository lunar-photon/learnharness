"use client";

import { useEffect, useState } from "react";
import type { ChatListItem, ExamDefinition, ExamSummary } from "@/src/core";

/**
 * The playful home strip (the redesign mock-up): streak, XP, today's goal,
 * Continue for the latest lesson, and the exam's topic path. Floats over
 * the knowledge graph; renders nothing until there is something to show.
 */
interface ExamCard { exam: ExamDefinition; summary: ExamSummary }

function Flame() {
	return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 3.5 5 5.5 5 10.5A5 5 0 0 1 7 12.5C7 10 8.5 8.5 9.5 7.5c0 2 1 3 2.5 3.5C11.5 7.5 10 5 12 2z" fill="var(--lh-orange)" /></svg>;
}
function Gem() {
	return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 6-8 14L4 8z" fill="var(--lh-gold)" /></svg>;
}

export function HomePanel() {
	const [exam, setExam] = useState<ExamCard | null>(null);
	const [last, setLast] = useState<ChatListItem | null>(null);
	useEffect(() => {
		let alive = true;
		fetch("/api/exams", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((b) => alive && b?.exams?.[0] && setExam(b.exams[0])).catch(() => {});
		fetch("/api/chats", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((b) => {
			const lesson = (b?.chats as ChatListItem[] | undefined)?.find((c) => (c.kind ?? "teach") === "teach");
			if (alive && lesson) setLast(lesson);
		}).catch(() => {});
		return () => { alive = false; };
	}, []);
	if (!exam && !last) return null;
	const daily = exam?.summary.daily;
	const examHref = exam ? `/exam/${exam.exam.id}` : "";
	const path = exam ? [...exam.summary.mastery].sort((a, b) => b.level - a.level) : [];
	const next = exam?.summary.focus[0]?.topic;

	return (
		<section aria-label="Your progress" className="pointer-events-auto mx-auto mt-14 w-full max-w-[46rem] space-y-3 rounded-3xl border-2 border-b-[6px] border-border bg-card/95 p-4 shadow-lg backdrop-blur">
			<div className="flex flex-wrap items-center gap-2">
				<h1 className="mr-auto text-xl font-black">Ready for a few wins?</h1>
				{daily && (
					<>
						<span className="flex items-center gap-1.5 rounded-full border-2 border-[#fdcfa8] bg-[var(--lh-orange-tint)] px-3 py-1 font-black text-[var(--lh-orange-text)] dark:border-transparent"><Flame />{daily.streak} day{daily.streak === 1 ? "" : "s"}</span>
						<span className="flex items-center gap-1.5 rounded-full border-2 border-[#f5d77a] bg-[var(--lh-gold-tint)] px-3 py-1 font-black text-[var(--lh-gold-text)] dark:border-transparent"><Gem />{exam!.summary.xp} XP</span>
						<span className="rounded-full border-2 border-border px-3 py-1 font-black tabular-nums">{daily.today} / {daily.goal} today</span>
					</>
				)}
			</div>
			<div className="flex flex-wrap gap-2">
				{last && <a href={`/chat/${last.id}`} className="lh-btn lh-btn-primary min-w-0 max-w-full normal-case tracking-normal"><span className="truncate">Continue: {last.title}</span></a>}
				{exam && <a href={examHref} className="lh-btn">Exam prep: {exam.exam.name.replace(/\s*\(.*\)$/, "")}</a>}
			</div>
			{exam && (
				<ol aria-label={`${exam.exam.name} topic path`} className="flex flex-wrap gap-3">
					{path.map((m) => {
						const isNext = m.topic === next;
						return (
							<li key={m.topic}>
								<a href={examHref} className="flex w-24 flex-col items-center gap-1 text-center no-underline">
									<span
										aria-hidden="true"
										className={`flex size-12 items-center justify-center rounded-full border-b-4 text-lg font-black ${
											m.level > 0 ? "border-[#5b21b6] bg-[var(--lh-purple)] text-white" : isNext ? "border-2 border-b-4 border-[var(--lh-orange)] bg-card text-[var(--lh-orange-text)]" : "border-[var(--lh-edge)] bg-[var(--lh-edge)] text-muted-foreground"
										}`}
									>
										{m.level > 0 ? m.level : isNext ? "!" : "·"}
									</span>
									<span className="line-clamp-2 text-xs font-extrabold text-foreground">{m.topic}</span>
									<span className="sr-only">{m.level > 0 ? `level ${m.level} of 5` : isNext ? "next up" : "not tested yet"}</span>
								</a>
							</li>
						);
					})}
				</ol>
			)}
		</section>
	);
}
