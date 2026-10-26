export class AgentLaunchError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "AgentLaunchError";
    this.code = code;
    this.status = status;
  }
}