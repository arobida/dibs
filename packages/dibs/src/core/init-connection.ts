import type { Ctx } from "./ctx.ts";
import type { Settings } from "./store.ts";
import { readThingsToken, saveThingsToken, thingsAdapter } from "./adapters/things/index.ts";
import { createInterface } from "node:readline";

const instruction = "Set DIBS_THINGS_TOKEN privately, then rerun dibs init --adapter things or dibs init --connect. Never put the token in chat or a CLI argument.";
export interface ConnectionResult {
	status: "disabled" | "pending" | "connected" | "error";
	credential?: "unknown" | "missing" | "invalid" | "shape-valid";
	read?: "not-tested" | "connected" | "failed";
	message: string;
}

async function confirmConnection(): Promise<string | undefined> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await new Promise((resolve) => {
			rl.once("close", () => resolve(undefined)); rl.once("SIGINT", () => resolve(undefined));
			rl.question("Connect/test Things read access now? [y/N] ", resolve);
		});
	} finally { rl.close(); }
}

// Raw input suppresses terminal echo, including pasted secrets.
export async function promptThingsToken(): Promise<string | undefined> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
	const input = process.stdin, wasRaw = input.isRaw;
	try {
		input.setRawMode(true); input.resume();
		return await new Promise((resolve) => {
			let value = "";
			const finish = (result: string | undefined) => { input.off("data", data); input.off("end", end); resolve(result); };
			const end = () => finish(undefined);
			const data = (chunk: Buffer) => {
				for (const c of chunk.toString()) {
					if (c === "\u0003" || c === "\u0004") { finish(undefined); return; }
					if (c === "\r" || c === "\n") { finish(value || undefined); return; }
					if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
					else value += c;
				}
			};
			input.on("data", data); input.once("end", end);
			try { process.stdout.write("Things token (hidden; Ctrl-C cancels): "); }
			catch (error) { input.off("data", data); input.off("end", end); throw error; }
		});
	} finally { input.setRawMode(wasRaw); input.pause(); process.stdout.write("\n"); }
}

export async function initConnection(ctx: Ctx, s: Settings, options: {
	consent?: boolean; interactive: boolean;
	confirm?: () => Promise<string | undefined>;
	promptToken?: () => Promise<string | undefined>;
}): Promise<ConnectionResult> {
	if (!s.adapters.things?.sync) return { status: "disabled", message: "Things sync disabled; connection not attempted." };
	const pending = (message: string, credential: ConnectionResult["credential"] = "unknown"): ConnectionResult => ({ status: "pending", credential, read: "not-tested", message });
	if (process.platform !== "darwin") return pending("Things requires macOS and Things 3. On a Mac, run dibs init --connect. No connection attempted.");
	try {
		if (!options.consent) {
			if (!options.interactive) return pending(instruction);
			const answer = (await (options.confirm ?? confirmConnection)())?.trim().toLowerCase();
			if (answer !== "y" && answer !== "yes") return pending(`Connection pending. Run dibs init --connect when ready. No connection attempted.`);
		}
		let token = readThingsToken();
		if (process.env.DIBS_THINGS_TOKEN && !/^[\w-]+$/.test(process.env.DIBS_THINGS_TOKEN)) return pending("Unset or fix DIBS_THINGS_TOKEN privately before entering a saved token; existing credentials unchanged.", "invalid");
		if (typeof token !== "string" || !/^[\w-]+$/.test(token)) {
			const credential = token === undefined ? "missing" : "invalid";
			if (!options.interactive) return pending(instruction, credential);
			token = await (options.promptToken ?? promptThingsToken)();
			if (token === undefined) return pending("Connection pending; token entry cancelled. Existing credentials unchanged. Run dibs init --connect when ready.", credential);
			if (typeof token !== "string" || !/^[\w-]+$/.test(token)) return pending(`Invalid credential shape; existing credentials unchanged. ${instruction}`, "invalid");
			saveThingsToken(token);
		}
		try { await thingsAdapter(ctx, s.name).list(); }
		catch { return { status: "error", credential: "shape-valid", read: "failed", message: "Things read connection failed. Check Things 3 and macOS System Settings > Privacy & Security > Automation, then run dibs init --connect. Credential shape valid, not authenticated. Storage initialization was saved; no rollback or sync performed." }; }
		return { status: "connected", credential: "shape-valid", read: "connected", message: "Things read connection verified. Credential shape valid, not authenticated: read access cannot authenticate the write token. No sync performed." };
	} catch {
		return { status: "error", credential: "unknown", read: "not-tested", message: "Things connection setup failed; check private credential file permissions and run dibs init --connect. Storage initialization was saved; no rollback or sync performed." };
	}
}
