import { checkName } from "./todo.ts";

// Shared by the MCP server and the Pi extension: tool params -> runFile args for list/create/edit/status.
export async function toolArgs(action: string, params: Record<string, any>, o: { creator: string; claim: string; user: () => Promise<string | undefined> }): Promise<string[]> {
	const p = { ...params };
	// Models fill unused fields with "" or null; both mean not given. human "" is real: it clears the assignee.
	for (const k of Object.keys(p)) if (p[k] === null || (p[k] === "" && k !== "human")) delete p[k];
	const { id, name, description, parent, result, force, query } = p;
	const human = p.human === "me" ? await o.user() ?? "" : p.human;
	const blocked_by = Array.isArray(p.blocked_by) ? p.blocked_by.join(",") : p.blocked_by;
	if (action === "edit" && name === undefined && description === undefined && blocked_by === undefined && human === undefined) throw new Error("todo_edit needs at least one of name, description, blocked_by, human");
	if (name !== undefined) checkName(name);
	let args: string[];
	if (action === "list") args = [...(p.ready ? ["ready"] : ["list", ...(query?.trim() ? ["--query", query] : [])]), ...(human ? ["--human", human] : [])];
	else if (action === "create") args = ["create", name, ...(description !== undefined ? ["--description", description] : []), ...(parent ? ["--parent", parent] : []), ...(blocked_by !== undefined ? ["--blocked-by", blocked_by] : []), "--created-by", o.creator, "--claim", o.claim, "--human", await o.user() ?? ""];
	else if (action === "edit") args = ["edit", id, ...(name !== undefined ? ["--name", name] : []), ...(description !== undefined ? ["--description", description] : []), ...(blocked_by !== undefined ? ["--blocked-by", blocked_by] : []), ...(human !== undefined ? ["--human", human] : [])];
	else if (p.status === "completed") args = ["complete", id, "--result", result || "Completed", "--claim", o.claim];
	else if (result !== undefined) throw new Error("result is only for status completed");
	else args = ["start", id, "--claim", o.claim];
	if (force && action === "status") args.push("--force");
	return args;
}
