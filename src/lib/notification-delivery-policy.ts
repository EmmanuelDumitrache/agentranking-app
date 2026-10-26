export function isRetryableNotificationHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function isTerminalNotificationHttpStatus(status: number): boolean {
  return status >= 400 && status < 500 && !isRetryableNotificationHttpStatus(status);
}
