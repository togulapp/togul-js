export class TogulApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    const prefix = "@togul/sdk-next";
    const parts = [`${prefix}: api error ${statusCode}`];
    if (code) parts.push(code);
    if (message) parts.push(message);
    super(parts.join(" "));
    this.name = "TogulApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class TogulConfigError extends Error {
  constructor(message: string) {
    super(`@togul/sdk-next: ${message}`);
    this.name = "TogulConfigError";
  }
}
