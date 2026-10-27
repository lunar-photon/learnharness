"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LockIcon } from "lucide-react";
import { SidebarToggle } from "@/components/sidebar";
import type { ChatListItem, ExamDefinition, ExamSummary } from "@/src/core";

/**
 * The home (the redesign mock-up): greeting with streak and XP, Continue for
 * the latest lesson, the daily goal, the three doors, and the topic path of
 * the exam the learner is working on. Sections without data stay hidden;
 * the knowledge graph lives at /map.
 */
interface ExamCard { exam: ExamDefinition; summary: ExamSummary; tests: { createdAt: string }[] }

const card = "rounded-3xl border-2 border-b-[6px] border-border bg-card";

function Flame() {
	return <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 3.5 5 5.5 5 10.5A5 5 0 0 1 7 12.5C7 10 8.5 8.5 9.5 7.5c0 2 1 3 2.5 3.5C11.5 7.5 10 5 12 2z" fill="var(--lh-orange)" /></svg>;
}
function Gem() {
	return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 6-8 14L4 8z" fill="var(--lh-gold)" /></svg>;
}
function BookIcon() {
	return <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" fill="var(--lh-green-bright)" /><path d="M6 19h13v2H6a2 2 0 0 1 0-2z" fill="var(--lh-green)" /></svg>;
}
function DumbbellArt() {
	return <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="9" width="4" height="6" rx="1" fill="var(--lh-blue)" /><rect x="18" y="9" width="4" height="6" rx="1" fill="var(--lh-blue)" /><rect x="6" y="6" width="3" height="12" rx="1" fill="var(--lh-blue)" opacity="0.7" /><rect x="15" y="6" width="3" height="12" rx="1" fill="var(--lh-blue)" opacity="0.7" /><rect x="9" y="11" width="6" height="2" fill="var(--lh-blue)" /></svg>;
}
function TrophyArt() {
	return <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v6a5 5 0 0 1-10 0z" fill="var(--lh-orange)" /><path d="M10 15h4v3h3v3H7v-3h3z" fill="var(--lh-gold)" /><path d="M7 5H4a3 3 0 0 0 3 5M17 5h3a3 3 0 0 1-3 5" stroke="var(--lh-gold)" strokeWidth="2" fill="none" /></svg>;
}

function greeting(hour: number): string {
	return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** The exam with the most recent activity (its latest test, else its creation). */
function latestExam(exams: ExamCard[]): ExamCard | null {
	const last = (e: ExamCard) => [e.exam.createdAt, ...e.tests.map((t) => t.createdAt)].sort().at(-1)!;
	return [...exams].sort((a, b) => last(b).localeCompare(last(a)))[0] ?? null;
}

const DOORS = [
	{ href: "/chat/new", label: "Learn", blurb: "Understand a new idea, one step at a time", art: <BookIcon />, tone: "border-[var(--lh-green-edge)] bg-[var(--lh-green-tint)]", ink: "text-[var(--lh-green)]" },
	{ href: "/chat/new?mode=practice", label: "Practice", blurb: "Make what you know come to mind fast", art: <DumbbellArt />, tone: "border-[var(--lh-blue)]/40 bg-[var(--lh-blue-tint)]", ink: "text-[var(--lh-blue)]" },
	{ href: "/chat/new?mode=exam", label: "Exam prep", blurb: "Timed tests at past-paper level", art: <TrophyArt />, tone: "border-[#fdcfa8] bg-[var(--lh-orange-tint)] dark:border-transparent", ink: "text-[var(--lh-orange-text)]" },
] as const;

export function HomeDashboard() {
	const [exam, setExam] = useState<ExamCard | null>(null);
	const [last, setLast] = useState<ChatListItem | null>(null);
	const [hello, setHello] = useState("Hello");
	useEffect(() => {
		let alive = true;
		setHello(greeting(new Date().getHours()));
		fetch("/api/exams", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((b) => alive && setExam(latestExam(b?.exams ?? []))).catch(() => {});
		fetch("/api/chats", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((b) => {
			const lesson = (b?.chats as ChatListItem[] | undefined)?.find((c) => (c.kind ?? "teach") === "teach");
			if (alive && lesson) setLast(lesson);
		}).catch(() => {});
		return () => { alive = false; };
	}, []);

	const daily = exam?.summary.daily;
	const examHref = exam ? `/exam/${exam.exam.id}` : "";
	const next = exam?.summary.focus[0];
	const ring = 2 * Math.PI * 60;
	const done = daily ? Math.min(daily.today / daily.goal, 1) : 0;

	return (
		<div className="relative h-dvh overflow-y-auto">
			{/* Window-drag strip first in the DOM (Electron's mask resolves by DOM order). */}
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			<header className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 px-3 py-2">
				<div className="pointer-events-auto"><SidebarToggle /></div>
			</header>

			<main className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-4 pb-14 pt-16 sm:px-7">
				<header className="flex flex-wrap items-center gap-3">
					<h1 className="mr-auto text-2xl font-black sm:text-3xl">{hello}, ready for a few wins?</h1>
					{daily && (
						<>
							<span className="flex items-center gap-1.5 rounded-full border-2 border-[#fdcfa8] bg-[var(--lh-orange-tint)] px-3.5 py-1.5 font-black text-[var(--lh-orange-text)] dark:border-transparent">
								<Flame /><span className="text-lg">{daily.streak}</span> day streak
							</span>
							<span className="flex items-center gap-1.5 rounded-full border-2 border-[#f5d77a] bg-[var(--lh-gold-tint)] px-3.5 py-1.5 font-black text-[var(--lh-gold-text)] dark:border-transparent">
								<Gem /><span className="text-lg">{exam!.summary.xp}</span> XP
							</span>
						</>
					)}
				</header>

				{(last || daily) && (
					<div className="flex flex-wrap gap-6">
						{last && (
							<section aria-labelledby="continue-title" className={`${card} flex flex-[2_1_420px] flex-col gap-4 p-6 sm:p-7`}>
								<span className="self-start rounded-full bg-[var(--lh-green-tint)] px-2.5 py-1 text-xs font-extrabold uppercase tracking-wider text-[var(--lh-green)]">Continue</span>
								<h2 id="continue-title" className="text-2xl font-black">{last.title}</h2>
								<div>
									<Link href={`/chat/${last.id}`} className="lh-btn lh-btn-primary inline-block px-7 py-3.5 text-[15px]">Continue lesson</Link>
								</div>
							</section>
						)}
						{daily && (
							<section aria-labelledby="goal-title" className={`${card} flex flex-[1_1_260px] flex-col items-center gap-3 p-6`}>
								<h2 id="goal-title" className="self-start text-lg font-black">Daily goal</h2>
								<svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label={`${daily.today} of ${daily.goal} questions answered today`}>
									<circle cx="75" cy="75" r="60" stroke="var(--border)" strokeWidth="16" fill="none" />
									{done > 0 && <circle cx="75" cy="75" r="60" stroke="var(--lh-orange)" strokeWidth="16" fill="none" strokeLinecap="round" strokeDasharray={`${done * ring} ${ring}`} transform="rotate(-90 75 75)" />}
									<text x="75" y="72" textAnchor="middle" fontWeight="900" fontSize="34" fill="var(--foreground)">{daily.today}</text>
									<text x="75" y="96" textAnchor="middle" fontWeight="700" fontSize="14" fill="var(--muted-foreground)">of {daily.goal} today</text>
								</svg>
								<p className="text-center font-bold text-muted-foreground">
									{daily.today >= daily.goal ? "Goal met. Your streak is safe today." : `${daily.goal - daily.today} more question${daily.goal - daily.today === 1 ? "" : "s"} keeps your streak alive.`}
								</p>
							</section>
						)}
					</div>
				)}

				<section aria-labelledby="start-title" className="flex flex-col gap-3.5">
					<h2 id="start-title" className="text-xl font-black">Start something new</h2>
					<div className="grid gap-4 sm:grid-cols-3">
						{DOORS.map((d) => (
							<Link key={d.href} href={d.href} className={`flex flex-col gap-2 rounded-[22px] border-2 border-b-[6px] p-5 text-foreground no-underline transition-transform active:translate-y-0.5 ${d.tone}`}>
								{d.art}
								<span className={`text-xl font-black ${d.ink}`}>{d.label}</span>
								<span className="font-bold">{d.blurb}</span>
							</Link>
						))}
					</div>
				</section>

				{exam && (
					<section aria-labelledby="path-title" className="flex flex-col gap-4 rounded-3xl bg-muted p-6 sm:px-7">
						<div className="flex flex-wrap items-baseline gap-3">
							<h2 id="path-title" className="flex-1 text-xl font-black">{exam.exam.name}: your topic path</h2>
							<Link href={examHref} className="font-extrabold">Open dashboard</Link>
						</div>
						<ol className="flex flex-wrap gap-4">
							{exam.summary.mastery.map((m) => {
								const isNext = m.topic === next?.topic;
								const tested = m.evidence > 0;
								return (
									<li key={m.topic} className="flex w-26 flex-col items-center gap-2 text-center">
										<span
											aria-hidden="true"
											className={`flex size-18 items-center justify-center rounded-full font-black ${
												isNext
													? "border-4 border-b-8 border-[var(--lh-orange)] bg-card text-[13px] uppercase text-[var(--lh-orange-text)]"
													: m.level > 0
														? "border-b-[6px] border-[#5b21b6] bg-[var(--lh-purple)] text-2xl text-white"
														: "border-b-[6px] border-[#cbd2d9] bg-[var(--lh-edge)] text-2xl text-muted-foreground dark:border-transparent"
											}`}
										>
											{isNext ? "Next" : m.level > 0 || tested ? m.level : <LockIcon className="size-6" />}
										</span>
										<span className="text-sm font-extrabold">{m.topic}</span>
										<span className={`text-xs font-bold ${isNext ? "text-[var(--lh-orange-text)]" : "text-muted-foreground"}`}>
											{isNext ? next!.reason : tested ? `Level ${m.level} of 5` : "Not tested yet"}
										</span>
									</li>
								);
							})}
						</ol>
					</section>
				)}
			</main>
		</div>
	);
}
