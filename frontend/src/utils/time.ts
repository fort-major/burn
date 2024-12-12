export function getTimeUntilNextSunday15UTC(n: number = 15): { days: number; hours: number; minutes: number } {
  const now = new Date();
  const currentDay = now.getUTCDay(); // Sunday is 0, Monday is 1, ..., Saturday is 6
  const currentHour = now.getUTCHours();

  // Calculate days until next Sunday
  let daysUntilSunday = (7 - currentDay) % 7; // if today is Sunday, set daysUntilSunday to 0
  if (daysUntilSunday === 0 && currentHour >= n) {
    // If it's already Sunday and past 15:00 UTC, set the next Sunday
    daysUntilSunday = 7;
  }

  // Set next Sunday at N UTC
  const nextSunday = new Date(now);
  nextSunday.setUTCDate(now.getUTCDate() + daysUntilSunday);
  nextSunday.setUTCHours(n, 0, 0, 0); // N UTC

  // Get the difference in milliseconds
  const difference = nextSunday.getTime() - now.getTime();

  // Convert the difference to days, hours, and minutes
  const totalMinutes = Math.floor(difference / (1000 * 60));
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  return { days, hours, minutes };
}

export function dateToDateTimeStr(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are 0-indexed
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
