export interface Ctx {
	cwd: string;
	trusted(): boolean;
	sessionId(): string;
	exec(cmd: string, args: string[], opts?: { cwd?: string; signal?: AbortSignal }): Promise<{ stdout: string; stderr: string; code: number }>;
}
