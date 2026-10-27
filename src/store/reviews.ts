import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import type { ReviewStore } from "../core/ports.ts";
import type { ReviewCard, ReviewSet } from "../core/review.ts";

/** The fs adapter for spaced review (core/ports.ts ReviewStore): one JSON
 *  file of cards, one JSON file per review set (the exam store's idiom). */

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const cardsFile = () => path.join(PATHS.reviews, "cards.json");
const setFile = (id: string) => {
	if (!SAFE_ID.test(id)) throw new Error(`Invalid review id: ${id}`);
	return path.join(PATHS.reviews, "sets", `${id}.json`);
};

function readJson<T>(file: string): T | null {
	try { return JSON.parse(fs.readFileSync(file, "utf-8")) as T; } catch { return null; }
}

function writeJson(file: string, value: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(value, null, "\t"), "utf-8");
	fs.renameSync(tmp, file); // a crash mid-write must not lose the schedule
}

export const reviewStore: ReviewStore = {
	readCards: () => readJson<ReviewCard[]>(cardsFile()) ?? [],
	saveCards: (cards) => writeJson(cardsFile(), cards),
	listSets() {
		let files: string[];
		try { files = fs.readdirSync(path.join(PATHS.reviews, "sets")).filter((f) => f.endsWith(".json")); } catch { return []; }
		return files.flatMap((f) => { const s = readJson<ReviewSet>(path.join(PATHS.reviews, "sets", f)); return s ? [s] : []; })
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	},
	getSet: (id) => (SAFE_ID.test(id) ? readJson<ReviewSet>(setFile(id)) : null),
	saveSet: (set) => writeJson(setFile(set.id), set),
};
