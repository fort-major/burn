export function getTimeUntilNextSunday15UTC(): { days: number; hours: number; minutes: number } {
  const now = new Date();
  const currentDay = now.getUTCDay(); // Sunday is 0, Monday is 1, ..., Saturday is 6
  const currentHour = now.getUTCHours();

  // Calculate days until next Sunday
  let daysUntilSunday = (7 - currentDay) % 7; // if today is Sunday, set daysUntilSunday to 0
  if (daysUntilSunday === 0 && currentHour >= 15) {
    // If it's already Sunday and past 15:00 UTC, set the next Sunday
    daysUntilSunday = 7;
  }

  // Set next Sunday at 15:00 UTC
  const nextSunday = new Date(now);
  nextSunday.setUTCDate(now.getUTCDate() + daysUntilSunday);
  nextSunday.setUTCHours(15, 0, 0, 0); // 15:00 UTC

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
