/** Only literal, unambiguous dimensional constraints. GTA/driving/top-down are not explicit dimensions. */
export function explicitGameDimension(text: string): '2d' | '3d' | null {
  const two = /\b(?:2\s*-?\s*d|two\s*-?\s*dimensional)\b/i.test(text);
  const three = /\b(?:3\s*-?\s*d|three\s*-?\s*dimensional)\b/i.test(text);
  return two === three ? null : two ? '2d' : '3d';
}
export function gameDimensionConflict(original: string, milestone: string): boolean {
  const user = explicitGameDimension(original), plan = explicitGameDimension(milestone);
  return user !== null && plan !== null && user !== plan;
}
