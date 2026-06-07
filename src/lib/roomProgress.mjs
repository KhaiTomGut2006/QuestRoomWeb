function romanStep(number) {
  const numerals = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  const value = Math.max(0, Number(number) || 0);
  return numerals[value] || String(value);
}

function isChallengeSubroom(level) {
  return Boolean(level?.isSubroom || level?.kind === "challenge-subroom" || Number(level?.failureCount) > 0);
}

export function roomProgressStepLabel(levels, index) {
  const level = Array.isArray(levels) ? levels[index] : null;
  if (!level) return "";
  if (isChallengeSubroom(level)) return romanStep(level.failureCount);
  return String(
    levels
      .slice(0, index + 1)
      .filter((item) => !isChallengeSubroom(item))
      .length
  );
}
