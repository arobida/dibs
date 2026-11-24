import { randomUUID } from "node:crypto";
import { readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const home = (path: string) => path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;

export function isAlive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch (error: any) { return error.code !== "ESRCH"; }
}

// A lock holds "<pid>:<token>"; it is stale when that pid is dead. tries * 25ms is the wait limit (~11s).
export async function withLock<T>(file: string, fn: () => T | Promise<T>, tries = 440): Promise<T> {
	const lock = `${file}.lock`;
	const mine = `${process.pid}:${randomUUID()}`;
	for (let i = 0; ; i++) {
		try { writeFileSync(lock, mine, { flag: "wx" }); break; }
		catch (error: any) {
			if (error.code !== "EEXIST") throw error;
			let seen: string, pid: number | undefined;
			try {
				seen = readFileSync(lock, "utf8");
				pid = /^(\d+):./.test(seen) ? Number(seen.split(":")[0]) : undefined;
				// an empty or malformed lock may be mid-write: stale only once it is 5s old.
				if (pid === undefined ? Date.now() - statSync(lock).mtimeMs > 5_000 : !isAlive(pid)) {
					// shortcut: a takeover holder dying between its read and unlink, plus a stale takeover, is not covered; use OS file locks if that shows up.
					const takeover = `${lock}.takeover`;
					try {
						writeFileSync(takeover, mine, { flag: "wx" });
						try { if (readFileSync(lock, "utf8") === seen) unlinkSync(lock); } catch {}
						finally { try { unlinkSync(takeover); } catch {} }
						continue;
					} catch (e: any) {
						if (e.code !== "EEXIST") throw e;
						if (Date.now() - statSync(takeover).mtimeMs > 5_000) { try { unlinkSync(takeover); } catch {} continue; }
					}
				}
			} catch {}
			if (i >= tries) throw Object.assign(new Error(`Task file is locked: ${lock} (held by pid ${pid ?? "unknown"}). If that pid is not a dibs process, delete the file.`), { code: "ELOCKED", lock });
			await new Promise((r) => setTimeout(r, 25));
		}
	}
	try { return await fn(); }
	finally { try { if (readFileSync(lock, "utf8") === mine) unlinkSync(lock); } catch {} }
}

// check validates each record and gives it its type; it throws on a bad record.
export function readJsonl<T>(path: string, check: (record: Record<string, unknown>) => T): T[] {
	let data: string;
	try { data = readFileSync(path, "utf8"); }
	catch (error: any) { if (error.code === "ENOENT") return []; throw new Error(`Cannot read ${path}: ${error.message}`); }
	const lines = data.split("\n").filter((line) => line.trim());
	return lines.flatMap((line, index) => {
		let record: any;
		try { record = JSON.parse(line); } catch {
			// A crash mid-append leaves an unterminated last line; drop it rather than refuse the whole file.
			if (index === lines.length - 1 && !data.endsWith("\n")) return [];
			throw new Error(`Invalid JSON on line ${index + 1} of ${path}`);
		}
		if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(`Invalid record on line ${index + 1} of ${path}`);
		try { return [check(record)]; } catch (error: any) { throw new Error(`Invalid record on line ${index + 1} of ${path}: ${error.message}`); }
	});
}
