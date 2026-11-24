import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { readConfig, writeConfig, type Settings } from "./store.ts";

export const adapterInstruction = "Ask the user whether to enable Things sync for this project first, then rerun dibs init --adapter things or dibs init --adapter none after their answer.";
const connectInstruction = "Things sync enabled for this project. Requires macOS and Things 3. Run dibs init --connect for private DIBS_THINGS_TOKEN setup. No sync has been run.";

export async function promptThings(): Promise<string | undefined> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await new Promise<string | undefined>((resolve) => {
			rl.once("line", resolve);
			rl.once("close", () => resolve(undefined));
			rl.once("SIGINT", () => resolve(undefined));
			rl.setPrompt("Enable Things sync for this project? [y/N] ");
			rl.prompt();
		});
	} finally { rl.close(); }
}

export async function initAdapter(s: Settings, choice: "things" | "none" | undefined, interactive: boolean, prompt = promptThings): Promise<{ adapter: "things" | "none" | null; instruction?: string }> {
	if (choice === undefined && s.adapters.things?.sync !== undefined) return { adapter: s.adapters.things.sync ? "things" : "none" };
	if (choice === undefined) {
		if (!interactive) return { adapter: null, instruction: adapterInstruction };
		const answer = (await prompt())?.trim().toLowerCase();
		if (answer === "y" || answer === "yes") choice = "things";
		else if (answer === "" || answer === "n" || answer === "no") choice = "none";
		else return { adapter: null, instruction: adapterInstruction };
	}
	const config = readConfig(s.local);
	mkdirSync(s.local, { recursive: true });
	writeConfig(s.local, { ...config, adapters: { ...s.adapters, ...config.adapters, things: { ...s.adapters.things, ...config.adapters?.things, sync: choice === "things" } } });
	return { adapter: choice, instruction: choice === "things" ? connectInstruction : "Things sync disabled for this project." };
}
