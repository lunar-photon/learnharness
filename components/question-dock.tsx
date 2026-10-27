"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownIcon } from "lucide-react";
import { finishDictation, isDictationActive, joinDictation, useDictationTarget } from "@/components/dictation";
import { useEnterSubmits } from "@/components/enter-submits";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import {
	buildAnswer,
	repairMathForDisplay,
	normalizeQuizType,
	normalizeQuizFormat,
	fillBlankLine,
	CONFIDENCE_STOPS,
	emptyDockSelection,
	normalizeOptions,
	resolveCorrect,
	seededRandom,
	shuffleOptions,
	toolQuestionKind,
	parseAskInput,
	parseQuizInput,
	parseExplainInput,
	toggleOption,
	toggleOther,
	type AnswerRequest,
	type AskToolInput,
	type DockSelection,
	type ExplainToolInput,
	type QuestionAnswerData,
	type QuestionFormDraft,
	type QuestionData,
	type QuestionMode,
	type QuizToolInput,
	type SelectMode,
	type Phase3,
} from "@/src/core";
import { SurePopup, SURE_LABELS } from "@/components/sure-popup";

/** The header hint per tap format. */
const FORMAT_HINT: Partial<Record<string, string>> = { next_step: "tap the next line", fill_blank: "fill the blank", order: "tap the lines in order", spot_error: "tap the wrong line" };

/** The popup's levels as confidence stops (the exam's four, in percent). */
const SURE_STOPS = [50, 70, 90, 100] as const;

/**
 * The question dock — a pending quiz/ask REPLACES the chat composer: the
 * persistent bottom blob morphs into the question. One tap answers (owner,
 * 2026-10-27): a quiz option opens "How sure?" under it, whose level sends
 * the answer (with an optional "Add why", the thinking channel); an ask
 * option sends at once; written answers keep a field with Send.
 *
 * Collapse behavior (scroll-up → slim bar) is owned by the DockOverlay in the
 * chat view, which also owns the persistent shell and its height morph. This
 * component is content only. The expanded form stays MOUNTED while collapsed
 * (hidden, not unmounted) so a half-made selection survives scrolling.
 */

export interface QuestionDockProps {
	toolName: "quiz" | "probe" | "ask_user_question" | "explain" | "recall";
	toolCallId: string;
	input: QuizToolInput | AskToolInput | ExplainToolInput;
	/** Collapse state, owned by the DockOverlay (it drives the shell's height morph). */
	expanded: boolean;
	/** A teach-phase check's "Note a thought" channel (reading-thinking), owned by the chat view. */
	note?: { value: string; onChange: (v: string) => void };
	onExpand: () => void;
	onSubmit: (output: QuestionAnswerData) => void;
	/** Restore only this call's unconfirmed submission after recovery. */
	initialDraft?: QuestionFormDraft;
	onSaveDraft?: (draft: QuestionFormDraft) => void;
	/** Escape in a question field stops dictation (STT wave) — threaded
	 *  from the page that owns the dictation hook. */
	onEscape?: () => void;
	/** The keyboard machine (wave B) is armed only while the dock is
	 *  expanded — the collapsed bar keeps its native Enter-to-expand. */
	active?: boolean;
	/** Session phase at the question — scales the thinking field: probing
	 *  stays quick (one row), teaching invites dumping (three rows). */
	phase?: Phase3;
	/** Dictation claim: false hands dictated speech elsewhere. Default true. */
	dictationClaim?: boolean;
	/** Compaction is running for this chat (owner round 14): the answer
	 *  POST would block on the server's compaction gate — disable submit
	 *  and say so in the hint row. The server registry is the real gate;
	 *  this is the affordance. */
	compactionRunning?: boolean;
}

export function QuestionDock({
	toolName,
	toolCallId,
	input,
	expanded,
	note,
	onExpand,
	onSubmit,
	initialDraft,
	onSaveDraft,
	onEscape,
	phase = "probe",
	dictationClaim = true,
	compactionRunning = false,
}: QuestionDockProps) {
	// The probe-phase names (owner, 2026-10-09) canonicalize onto their
	// teach twins for every dock concern — parse dispatch, labels, kinds:
	// the probe quiz ("probe") is quiz-shaped, the probe free-recall
	// ("recall") is explain-shaped. Old records keep the teach names.
	const canonical =
		toolName === "probe" ? "quiz" : toolName === "recall" ? "explain" : toolName;
	// The chip's display name carries the tool's OWN name (owner
	// 2026-10-09): probe-phase questions label Probe/Recall in the
	// composer; teach tools keep the standing labels.
	const toolLabel = toolName === "probe" ? "Probe" : toolName === "recall" ? "Recall" : undefined;
	// Parse, don't cast (src/core/tool-parts.ts): the model authored this
	// input, and only the schema the tool declared vouches for its shape.
	// The dock mounts on input-available parts (already validated at the
	// bridge), so this is pure defense in depth — but it is STRUCTURAL now:
	// anything that slips through renders the quiet fallback, never a
	// crash on `.map` over model-authored bytes.
	const parsed =
		canonical === "quiz" ? parseQuizInput(input) : canonical === "explain" ? parseExplainInput(input) : parseAskInput(input);
	if (!parsed) {
		return (
			<div data-testid="malformed-question" className="rounded-xl border border-dashed bg-card/60 p-3 text-sm text-muted-foreground">
				This question arrived malformed — the transcript keeps the retry.
			</div>
		);
	}
	return (
		<>
			{!expanded && (
				<QuestionDockBar
					toolName={canonical}
					question={parsed.question}
					onExpand={onExpand}
					toolLabel={toolLabel}
					label={
						(canonical === "quiz" || canonical === "explain") &&
						normalizeQuizType((parsed as { type?: unknown }).type) === "predict"
							? "Prediction"
							: undefined
					}
				/>
			)}
			<div className={expanded ? "dock-variant" : "invisible h-0 overflow-hidden"}>
				<QuestionDockForm
					toolName={toolName}
					toolCallId={toolCallId}
					input={parsed}
					phase={phase}
					active={expanded}
					onSubmit={onSubmit}
					note={note}
					initialDraft={initialDraft}
					onSaveDraft={onSaveDraft}
					onEscape={onEscape}
					dictationClaim={dictationClaim}
					compactionRunning={compactionRunning}
				/>
			</div>
		</>
	);
}

/** A plain-text teaser of a question for the collapsed bar: unwrap math, flatten common LaTeX. */
function teaserText(q: string): string {
	return repairMathForDisplay(q)
		.replace(/\\\(([\s\S]*?)\\\)/g, "$1") // \(...\) inline math
		.replace(/\\\[([\s\S]*?)\\\]/g, "$1") // \[...\] display math
		.replace(/\$\$?([^$]*)\$\$?/g, "$1") // standard $...$/$$...$$ math
		.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
		.replace(/\\([a-zA-Z]+)/g, "$1")
		.replace(/[{}]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** The collapsed strip (scroll minimization): kind chip + one-liner + Answer ↓. */
export function QuestionDockBar({
	toolName,
	question,
	onExpand,
	label,
	toolLabel,
}: {
	toolName: "quiz" | "ask_user_question" | "explain";
	question: string;
	onExpand: () => void;
	/** The kind chip's text (owner 2026-10-03): "Prediction" when a
	 *  predict-type quiz minimizes by scroll. */
	label?: string;
	/** The chip's TOOL display name (owner 2026-10-09): probe-phase calls
	 *  label Probe/Recall — the phase boundary visible in the composer. */
	toolLabel?: string;
}) {
	return (
		<button
			type="button"
			data-testid="question-dock-bar"
			onClick={onExpand}
			className="dock-variant flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/40"
		>
			<span className="shrink-0 text-xs font-bold text-muted-foreground">
				{label ??
							toolLabel ??
							(toolName === "quiz" ? "Check" : toolName === "explain" ? "Explain" : "Question")}
			</span>
			<span className="min-w-0 flex-1 truncate text-muted-foreground">{teaserText(question)}</span>
			<span className="flex shrink-0 items-center gap-1 text-xs font-medium">
				Answer <ArrowDownIcon className="size-3.5" />
			</span>
		</button>
	);
}

/** The expanded question: label, question, options, and the unified bottom row. */
function QuestionDockForm({
	toolName,
	toolCallId,
	input,
	phase = "probe",
	active,
	onSubmit,
	note,
	initialDraft,
	onSaveDraft,
	onEscape,
	dictationClaim = true,
	compactionRunning = false,
}: Omit<QuestionDockProps, "expanded" | "onExpand">) {
	const kind = toolQuestionKind(toolName);

	// Canonical QuestionData, built once per question. Quiz options are
	// deterministically shuffled (seeded by toolCallId) so position never leaks
	// correctness AND server/client render the same order (hydration-safe);
	// the display order is snapshotted into the answer record at submit time.
	const qd = useMemo<QuestionData>(() => {
		const quizInput = kind === "quiz" ? (input as QuizToolInput) : null;
		const askInput = kind === "ask" ? (input as AskToolInput) : null;
		const explainInput = kind === "explain" ? (input as ExplainToolInput) : null;
		const multi = input instanceof Object && "multiSelect" in input ? input.multiSelect === true : false;
		const mode: QuestionMode =
			kind === "quiz"
				? multi
					? "multi-select"
					: "single-select"
				: askInput?.options?.length
					? multi
						? "multi-select"
						: "single-select"
						: "text";
		const options = normalizeOptions(
			(quizInput?.options ?? askInput?.options ?? []) as { label: string; value?: string }[],
		);
		const format = kind === "quiz" ? normalizeQuizFormat(quizInput?.format) : "choice";
		// Code keeps its indentation (normalizeOptions trims labels).
		if (quizInput?.language && Array.isArray(quizInput.options)) {
			const raw = new Map(quizInput.options.map((o) => [o.value?.trim() || o.label.trim(), o.label.replace(/\s+$/, "")]));
			for (const o of options) o.label = raw.get(o.value) ?? o.label;
		}
		// spot_error options ARE the worked lines, so they keep their order.
		const ordered = kind === "quiz" && options.length > 0 && format !== "spot_error" ? shuffleOptions(options, seededRandom(toolCallId)) : options;
		const q: QuestionData = {
			id: toolCallId,
			kind,
			// The role (owner 2026-10-03): predict questions gate by it in the
			// view (never collapsed) and the answered card tucks the explanation.
			questionType: kind === "quiz" ? normalizeQuizType((input as { type?: unknown }).type) : undefined,
			...(format !== "choice" ? { format } : {}),
			...(quizInput?.lines?.length ? { lines: quizInput.lines } : {}),
			...(quizInput?.language ? { language: quizInput.language } : {}),
			question: input.question,
			context: input.details,
			mode,
			options: ordered,
			createdAt: new Date().toISOString(),
		};
		if (quizInput) {
			const resolved = resolveCorrect(quizInput.correctAnswer, ordered);
			if (resolved.error) console.error("[quiz] correctAnswer did not resolve:", resolved.error);
			// An `order` key is the authored SEQUENCE (resolveCorrect returns a sorted set).
			const byValue = new Map(ordered.map((o, i) => [o.value, i + 1]));
			q.correctIndices =
				format === "order"
					? [quizInput.correctAnswer].flat().map((v) => byValue.get(String(v).trim())).filter((i): i is number => i !== undefined)
					: resolved.indices;
			q.explanation = quizInput.explanation;
		}
		if (explainInput) {
			// The commitment rides the question data (never sent to the
			// client before answering) and snapshots into the answer at submit.
			// One field, reasoning included — no separate explanation
			// (owner ruling 2026-09-27).
			q.committedAnswer = explainInput.correctAnswer;
		}
		return q;
	}, [toolCallId, kind, input]);

	// The selection state machine lives in question-core (pure, tested):
	// single-select displaces, multi-select coexists — picking the ask
	// "Other…" row in a multi-select must never clear already-picked
	// options, and picking an option must never clear a typed custom answer.
	const [sel, setSel] = useState<DockSelection>(() => initialDraft?.selection ?? emptyDockSelection());
	// The learner's transfer channel — thinking, never "a note".
	const [thinking, setThinking] = useState(initialDraft?.thinking ?? "");
	const [other, setOther] = useState(initialDraft?.other ?? "");
	const [text, setText] = useState(initialDraft?.text ?? "");
	/* Refs MIRROR the two dictation-target fields ("nothing gets lost"
	 * round, owner 2026-10-01): the run's flush lands via setState, which
	 * a closure waiting through `await finishDictation()` cannot observe
	 * in time — submit reads these, kept current at every write site. */
	const thinkingTextRef = useRef(initialDraft?.thinking ?? "");
	const answerTextRef = useRef(initialDraft?.text ?? "");
	// The "How sure?" answer (owner, 2026-10-27) is picked in the popup under
	// the chosen option. While "Note a thought" is open, the note owns speech.
	const [noteOpen, setNoteOpen] = useState(false);
	const [whyOpen, setWhyOpen] = useState(!!initialDraft?.thinking);
	// The row the popup sits under: an option index, or optionCount for the multi-select Done row.
	const [asking, setAsking] = useState<number | null>(null);
	const selectMode: SelectMode = qd.mode === "multi-select" ? "multi-select" : "single-select";

	// The PRIMARY dictation input (owner, STT round 1): while a question
	// waits, dictated finals land HERE, never in the hidden composer — text
	// mode owns "Your answer", select modes own "Your thinking". The claim
	// is effect-scoped, so the question unmounting releases it and
	// dictation falls back to the composer automatically.
	useDictationTarget(
		useCallback(
			(t: string) => {
				// Ref-first (see the refs block above): the join is computed from
				// the mirror, then both mirrors agree with state — a submit
				// resuming post-finish reads the tail, never a stale closure.
				if (qd.mode === "text") {
					const v = joinDictation(answerTextRef.current, t);
					answerTextRef.current = v;
					setText(v);
				} else {
					const v = joinDictation(thinkingTextRef.current, t);
					thinkingTextRef.current = v;
					setThinking(v);
				}
			},
			[qd.mode],
		),
		dictationClaim && !noteOpen,
	);

	// `order`: the option indices in the order the learner tapped them.
	const isOrder = qd.format === "order";
	const [seq, setSeq] = useState<number[]>([]);
	const answerable = (s: DockSelection) =>
		isOrder
			? s.dontKnow || seq.length === qd.options.length
			: qd.mode === "text"
			? answerTextRef.current.trim().length > 0
			: s.dontKnow || (s.otherSelected && other.trim().length > 0) || s.selected.size > 0;
	const canSubmit = qd.mode === "text" ? text.trim().length > 0 : answerable(sel);

	type SendOver = { sel?: DockSelection; level?: number };
	const submit = (over: SendOver = {}) => {
		if (compactionRunning || !answerable(over.sel ?? sel)) return;
		/* FINISH DICTATION FIRST (owner, 2026-10-01): Enter may arrive while
		 * a run is live with reasoning still in Deepgram's hands. Stop the
		 * run, let the last finals land in the target field, and only then
		 * build the answer — the spoken reasoning is never lost to a
		 * forgotten stop. The field values below come from the REF mirrors
		 * because the flush lands via setState after an await. */
		if (!isDictationActive()) {
			doSubmit(over);
			return;
		}
		void finishDictation().then(() => doSubmit(over));
	};
	const doSubmit = ({ sel: s = sel, level = SURE_LABELS.length - 1 }: SendOver) => {
		if (!answerable(s)) return;
		const confIdx = CONFIDENCE_STOPS.indexOf(SURE_STOPS[level]!);
		const req: AnswerRequest = {
			dontKnow: s.dontKnow,
			values: (isOrder && !s.dontKnow ? seq : [...s.selected]).map((i) => qd.options[i]!.value),
			other: s.otherSelected ? other : undefined,
			text: qd.mode === "text" ? answerTextRef.current : undefined,
			thinking: qd.mode !== "text" ? thinkingTextRef.current.trim() || undefined : undefined,
			// buildAnswer drops it on "I don't know".
			confidence: kind === "quiz" ? SURE_STOPS[level] : undefined,
		};
		// Snapshot before optimistic submission unmounts the form. Ref values
		// include the dictation finals that just landed, unlike stale closures.
		onSaveDraft?.({
			selection: { ...s, selected: new Set(s.selected) },
			thinking: thinkingTextRef.current,
			other,
			text: answerTextRef.current,
			confidenceIndex: confIdx,
		});
		onSubmit(buildAnswer(qd, req, toolName));
	};

	const [kbdIdx, setKbdIdx] = useState<number | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const otherInputRef = useRef<HTMLInputElement>(null);
	// One row past the options is the trailing row: quiz → don't-know,
	// ask → Other (a question never has both). Text mode (ask/explain)
	// has no rows — the composer IS the answer surface.
	const optionCount = qd.mode === "text" ? 0 : qd.options.length;
	const rowCount = qd.mode === "text" ? 0 : optionCount + 1;

	/* ONE TAP (owner, 2026-10-27): a quiz option opens "How sure?" under it
	 * and the level picked there sends the answer; an ask option sends at
	 * once; multi-select toggles and its Done (quiz) or Send (ask) sends.
	 * "I don't know" sends at once. */
	const pickOption = (idx: number) => {
		if (isOrder) {
			// Tap places the line next; tapping a placed line takes it back.
			setSeq((q) => (q.includes(idx) ? q.filter((i) => i !== idx) : [...q, idx]));
			return setAsking(null);
		}
		const next = toggleOption(selectMode, sel, idx);
		setSel(next);
		if (selectMode === "multi-select") return setAsking(null);
		if (kind === "quiz") setAsking(idx);
		else submit({ sel: next });
	};
	const pickDontKnow = () => submit({ sel: { selected: new Set(), otherSelected: false, dontKnow: true } });
	const askSure = () => {
		if (kind !== "quiz" || (isOrder ? seq.length < optionCount : sel.selected.size === 0)) return false;
		setAsking(selectMode === "multi-select" || isOrder ? optionCount : [...sel.selected][0]!);
		return true;
	};

	/* ENTER FROM ANYWHERE (owner round 6, 2026-10-05): dictated answers rarely
	 * focus a field. A quiz with a choice opens "How sure?"; otherwise Enter
	 * sends. The popup's own Enter picks its level (a dialog keeps native Enter). */
	useEnterSubmits(() => {
		if (asking === null && !askSure()) submit();
	});

	// Selecting Other never clears the thinking field — two channels, the
	// answer and the reasoning behind it, side by side.
	const selectOther = () => setSel(toggleOther(selectMode, sel));

	/* ── The keyboard machine (shortcut wave B, owner rounds 2026-09-17) ──
	   ↑/↓ walk EVERY answerable row in order — options first, then the
	   quiz's "I don't know" or the ask's "Other…" (whichever exists) —
	   CLAMPED at the ends, no wrap. Space acts on the walked row exactly
	   like a click. Tab moves focus into the rows. Keys from a TYPING
	   SURFACE keep their meaning, modifier combos are never ours, and the
	   open "How sure?" popup owns every key while it is up. */
	const kbdAct = (idx: number) => {
		if (idx < optionCount) pickOption(idx);
		else if (kind === "quiz") pickDontKnow();
		else {
			// Space on the ask's Other row (owner refinement round,
			// 2026-09-24): SELECTING it focuses the input for typing, but
			// the Space that DESELECTS an already-selected Other must never
			// drop the user back into the typing field.
			if (sel.otherSelected) setSel((prev) => ({ ...prev, otherSelected: false, dontKnow: false }));
			else {
				otherInputRef.current?.focus();
				selectOther();
			}
		}
	};

	// Focus the walked row's focusable element — the Other row is a div,
	// so its inline input is the focus target there.
	const focusRow = (idx: number) => {
		const row = rootRef.current?.querySelector(`[data-kbdrow="${idx}"]`) as HTMLElement | null;
		if (!row) return;
		const el = (row.querySelector("input") as HTMLElement | null) ?? row;
		el.focus();
	};

	useEffect(() => {
		if (!active || rowCount === 0 || asking !== null) return;
		const onKeyDown = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
			// Alt/Cmd/Ctrl combos are never ours (Alt+arrows cycle sessions
			// globally — they must not ALSO walk the question rows).
			const modded = e.altKey || e.metaKey || e.ctrlKey;
			// Plain Tab moves focus into the rows; Shift+Tab falls through
			// (the global thinking-level cycle owns it).
			if (e.key === "Tab" && !e.shiftKey && !modded) {
				e.preventDefault();
				e.stopPropagation();
				const idx = kbdIdx ?? 0;
				setKbdIdx(idx);
				focusRow(idx);
				return;
			}
			if (typing || modded) return;
			if (e.key === "ArrowDown") {
				e.preventDefault();
				const next = Math.min((kbdIdx ?? -1) + 1, rowCount - 1);
				setKbdIdx(next);
				// Focus follows the walk while the user is IN the rows (Tab
				// put them there) so focused and walked never diverge.
				if (t?.closest?.("[data-kbdrow]")) focusRow(next);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				const next = Math.max((kbdIdx ?? rowCount) - 1, 0);
				setKbdIdx(next);
				if (t?.closest?.("[data-kbdrow]")) focusRow(next);
			} else if (e.key === " ") {
				if (kbdIdx === null) return; // plain Space keeps scrolling the page
				e.preventDefault();
				kbdAct(kbdIdx);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	});

	// Keep the walked row visible (the question area scrolls internally).
	useEffect(() => {
		if (kbdIdx === null) return;
		rootRef.current
			?.querySelector(`[data-kbdrow="${kbdIdx}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [kbdIdx]);

	const surePopup = (
		<SurePopup onPick={(level) => submit({ level })} onClose={() => setAsking(null)}>
			{whyOpen ? (
				<textarea
					autoFocus={!thinking}
					value={thinking}
					onChange={(e) => {
						thinkingTextRef.current = e.target.value;
						setThinking(e.target.value);
					}}
					aria-label="Why this answer"
					placeholder="Why this answer? Enter sends it with the level picked."
					rows={2}
					className="field-sizing-content lh-input max-h-40 w-full resize-none rounded-xl border-2 border-[var(--lh-edge)] bg-card px-3 py-2 outline-none placeholder:text-muted-foreground"
				/>
			) : (
				<button type="button" onClick={() => setWhyOpen(true)} className="self-start text-sm font-extrabold text-[var(--lh-blue)] hover:underline">
					+ Add why
				</button>
			)}
		</SurePopup>
	);

	const tile = (selected: boolean, walked: boolean) =>
		cn(
			"lh-prose flex w-full items-start gap-3 rounded-2xl border-2 border-b-4 px-4 py-3 text-left outline-none transition-colors",
			selected ? "border-[var(--lh-blue)] bg-[var(--lh-blue-tint)]" : "border-[var(--lh-edge)] bg-card hover:bg-muted",
			walked && !selected && "ring-2 ring-[var(--lh-blue)]/40",
		);
	// Code renders as monospaced lines; everything else as lesson prose (maths included).
	const piece = (text: string) =>
		qd.language ? <code className="block whitespace-pre font-mono text-[0.9em] leading-relaxed">{text}</code> : <ToolContentResponse>{text}</ToolContentResponse>;
	const chosen = qd.format === "next_step" || qd.format === "fill_blank" ? qd.options[[...sel.selected][0] ?? -1] : undefined;
	const label =
		toolName === "probe"
			? "Probe"
			: toolName === "recall"
				? "Recall"
				: kind === "quiz"
					? qd.questionType === "predict"
						? "Prediction"
						: "Check"
					: kind === "explain"
						? "Explain"
						: "Question";
	const sendButton = (disabled: boolean) => (
		<button type="submit" disabled={disabled || compactionRunning} className="lh-btn lh-btn-primary">
			{compactionRunning ? "Compacting…" : "Send"}
		</button>
	);

	return (
		<div ref={rootRef} data-testid="question-dock">
			{/* Question area — scrolls internally if very tall. Capped by the
			    measured column (--dock-max-h; owner round, 2026-10-05). */}
			<div data-session-find-root="" className="max-h-[var(--dock-max-h,55dvh)] overflow-y-auto px-4 pb-3 pt-3">
				<div className="mb-1 flex items-center gap-2">
					<span className="text-sm font-black text-[var(--lh-green)]">
						{label}
						{qd.mode === "multi-select" && <span className="font-bold text-muted-foreground"> · pick all that apply</span>}
						{qd.format && FORMAT_HINT[qd.format] && <span className="font-bold text-muted-foreground"> · {FORMAT_HINT[qd.format]}</span>}
					</span>
					{note && (
						<NoteThought
							value={note.value}
							onChange={note.onChange}
							open={noteOpen}
							onOpenChange={setNoteOpen}
							onEscape={onEscape}
						/>
					)}
				</div>
				<div className="lh-prose mb-3 font-bold">
					<ToolContentResponse>{qd.question}</ToolContentResponse>
				</div>
				{qd.context && (
					<div className="lh-prose mb-3 text-muted-foreground">
						<ToolContentResponse>{qd.context}</ToolContentResponse>
					</div>
				)}

				{qd.format && (
					<div data-testid={`format-${qd.format}`} className="lh-prose mb-3 flex flex-col gap-1 overflow-x-auto rounded-2xl border-2 border-[var(--lh-edge)] bg-muted px-4 py-3">
						{qd.format !== "spot_error" &&
							qd.lines?.map((line, i) => (
								<div key={i}>{piece(qd.format === "fill_blank" ? fillBlankLine(line, chosen?.label, qd.language) : line)}</div>
							))}
						{qd.format === "next_step" && (
							<div data-testid="next-step-slot" className={cn("rounded-lg border-2 border-dashed px-2 py-1", chosen ? "border-[var(--lh-blue)] bg-[var(--lh-blue-tint)]" : "border-[var(--lh-edge)] text-muted-foreground")}>
								{chosen ? piece(chosen.label) : "?"}
							</div>
						)}
						{isOrder && (
							<ol className="m-0 flex list-none flex-col gap-1 p-0!" aria-label="Your order">
								{seq.map((i, k) => (
									<li key={qd.options[i]!.value}>
										<button type="button" onClick={() => pickOption(i)} className="flex w-full items-start gap-2 rounded-lg bg-[var(--lh-blue-tint)] px-2 py-1 text-left" aria-label={`Step ${k + 1}, tap to take back`}>
											<span className="font-black text-[var(--lh-blue)]">{k + 1}</span>
											<span className="min-w-0">{piece(qd.options[i]!.label)}</span>
										</button>
									</li>
								))}
								{qd.options.slice(seq.length).map((o, k) => (
									<li key={`empty-${o.value}`} aria-hidden className="rounded-lg border-2 border-dashed border-[var(--lh-edge)] px-2 py-1 text-muted-foreground">
										{seq.length + k + 1}
									</li>
								))}
							</ol>
						)}
						{qd.format === "spot_error" &&
							qd.options.map((opt, i) => {
								const isSel = sel.selected.has(i);
								return (
									<div key={opt.value}>
										<button
											type="button"
											role="radio"
											aria-checked={isSel}
											data-kbdrow={i}
											onClick={() => pickOption(i)}
											className={cn(
												"w-full rounded-lg px-2 py-1 text-left outline-none transition-colors hover:bg-card",
												isSel && "bg-[var(--lh-coral-tint)] ring-2 ring-[var(--lh-orange)]",
												i === kbdIdx && !isSel && "ring-2 ring-[var(--lh-blue)]/40",
											)}
										>
											{piece(opt.label)}
										</button>
										{asking === i && surePopup}
									</div>
								);
							})}
					</div>
				)}

				{qd.mode !== "text" && (
					<div className="flex flex-col gap-2" role={qd.mode === "multi-select" ? "group" : "radiogroup"}>
						{qd.format !== "spot_error" && qd.options.map((opt, i) => {
							const isSel = sel.selected.has(i);
							if (isOrder && seq.includes(i)) return null;
							return (
								<div key={opt.value}>
									<button
										type="button"
										role={qd.mode === "multi-select" ? "checkbox" : "radio"}
										aria-checked={isSel}
										data-kbdrow={i}
										onClick={() => pickOption(i)}
										className={tile(isSel, i === kbdIdx)}
									>
										{qd.mode === "multi-select" && (
											<span
												aria-hidden
												className={cn(
													"mt-1 flex size-4 shrink-0 items-center justify-center rounded-sm border-2 text-xs leading-none",
													isSel ? "border-[var(--lh-blue)] bg-[var(--lh-blue)] text-white" : "border-[var(--lh-edge)]",
												)}
											>
												{isSel && "✓"}
											</span>
										)}
										<span className="min-w-0">
											{piece(opt.label)}
											{kind !== "quiz" && opt.description && (
												<ToolContentResponse className="block text-sm text-muted-foreground">
													{opt.description}
												</ToolContentResponse>
											)}
										</span>
									</button>
									{asking === i && surePopup}
								</div>
							);
						})}

						{kind === "quiz" && (
							<button
								type="button"
								onClick={pickDontKnow}
								data-kbdrow={optionCount}
								className={cn(
									"rounded-2xl border-2 border-dashed border-[var(--lh-edge)] px-4 py-2.5 text-left font-bold text-muted-foreground outline-none transition-colors hover:bg-muted",
									kbdIdx === optionCount && "ring-2 ring-[var(--lh-blue)]/40",
								)}
							>
								I don't know
							</button>
						)}

						{kind === "ask" && (
							<div
								role={qd.mode === "multi-select" ? "checkbox" : "radio"}
								aria-checked={sel.otherSelected}
								data-testid="other-option"
								data-kbdrow={optionCount}
								onClick={selectOther}
								className={cn(tile(sel.otherSelected, kbdIdx === optionCount), !sel.otherSelected && "border-dashed")}
							>
								<input
									ref={otherInputRef}
									value={other}
									onChange={(e) => {
										setOther(e.target.value);
										setSel((prev) => (prev.otherSelected ? prev : toggleOther(selectMode, prev)));
									}}
									onKeyDown={(e) => {
										if (e.key === "Escape") {
											e.preventDefault();
											e.stopPropagation();
											e.currentTarget.blur();
											setKbdIdx(optionCount);
										}
										if (e.key === "Enter") {
											e.preventDefault();
											submit();
										}
									}}
									placeholder="Type your own answer, Enter sends"
									className="lh-input w-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
									onClick={(e) => e.stopPropagation()}
								/>
							</div>
						)}

						{(qd.mode === "multi-select" || isOrder) && (
							<div>
								{kind === "quiz" ? (
									<button type="button" disabled={isOrder ? seq.length < optionCount : sel.selected.size === 0} onClick={askSure} className="lh-btn lh-btn-primary">
										Done
									</button>
								) : (
									<form onSubmit={(e) => { e.preventDefault(); submit(); }}>{sendButton(!canSubmit)}</form>
								)}
								{asking === optionCount && surePopup}
							</div>
						)}
					</div>
				)}

				{qd.mode === "text" && (
					<form
						data-testid="answer-field"
						className="flex items-end gap-2 rounded-2xl border-2 border-[var(--lh-edge)] bg-card p-1.5 transition-colors focus-within:border-[var(--lh-blue)]"
						onSubmit={(e) => {
							e.preventDefault();
							submit();
						}}
					>
						<textarea
							value={text}
							aria-label="Your answer"
							onChange={(e) => {
								answerTextRef.current = e.target.value;
								setText(e.target.value);
							}}
							onKeyDown={(e) => {
								if (e.key === "Escape" && onEscape) {
									e.preventDefault();
									e.stopPropagation();
									onEscape();
									return;
								}
								// Chat convention: Enter sends, Shift+Enter is a newline.
								if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
									e.preventDefault();
									submit();
								}
							}}
							placeholder="Type your answer…"
							rows={1}
							className="field-sizing-content lh-input lh-prose max-h-48 min-h-10 flex-1 resize-none bg-transparent px-2.5 py-2 outline-none placeholder:text-muted-foreground"
						/>
						{sendButton(!canSubmit)}
					</form>
				)}
			</div>
		</div>
	);
}

/** "Note a thought" (owner, 2026-10-27): the reading-thinking channel as a
 *  popup on the check — a thought noted while reading rides the answer as
 *  `readingThinking`. While open, the note owns dictated speech. */
function NoteThought({
	value,
	onChange,
	open,
	onOpenChange,
	onEscape,
}: {
	value: string;
	onChange: (v: string) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onEscape?: () => void;
}) {
	useDictationTarget(
		useCallback((t: string) => onChange(joinDictation(value, t)), [value, onChange]),
		open,
	);
	return (
		<span className="relative ml-auto">
			<button
				type="button"
				aria-expanded={open}
				data-testid="note-thought"
				onClick={() => onOpenChange(!open)}
				className="text-sm font-extrabold text-[var(--lh-blue)] hover:underline"
			>
				{value.trim() ? "Your note ✓" : "Note a thought"}
			</button>
			{open && (
				<div
					role="dialog"
					aria-label="Note a thought"
					data-testid="reading-thinking-field"
					className="absolute right-0 top-full z-30 mt-1 w-80 rounded-2xl border-2 border-b-4 border-[var(--lh-edge)] bg-card p-2 shadow-xl"
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							e.preventDefault();
							e.stopPropagation();
							onEscape?.();
							onOpenChange(false);
						}
					}}
				>
					<textarea
						autoFocus
						value={value}
						onChange={(e) => onChange(e.target.value)}
						aria-label="A thought while reading"
						placeholder="Whatever comes to mind as you read. It goes with your answer."
						rows={3}
						className="field-sizing-content lh-input max-h-40 w-full resize-none bg-transparent px-1 py-0.5 outline-none placeholder:text-muted-foreground"
					/>
				</div>
			)}
		</span>
	);
}
