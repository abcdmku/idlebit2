const reported = new Set<string>();
/** Log a render failure once per place and message; the frame carries on. */
export function reportRenderError(where: string, error: unknown): void {
  const key = `${where}:${error instanceof Error ? error.message : String(error)}`;
  if (reported.has(key)) return;
  reported.add(key); console.error(`Render ${where} failed`, error);
}
