// XP curve. Picked something gently exponential so early levels feel fast and
// later levels demand serious grinding - similar shape to the classic RS curve
// without copying their exact numbers.

const BASE = 50;
const EXP = 1.7;

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(BASE * Math.pow(level, EXP));
}

// Given a total XP value, what level are we?
export function levelFromXp(xp: number): number {
  // Could solve this analytically with Math.pow but a small loop is fine
  // and easier to tweak if the curve changes.
  let lvl = 1;
  while (xpForLevel(lvl + 1) <= xp) lvl++;
  return lvl;
}

// Progress towards next level as a 0..1 fraction. Used by the progress bar.
export function progressInLevel(xp: number): number {
  const lvl = levelFromXp(xp);
  const here = xpForLevel(lvl);
  const next = xpForLevel(lvl + 1);
  if (next === here) return 1;
  return (xp - here) / (next - here);
}
