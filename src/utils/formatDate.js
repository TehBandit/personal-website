export function formatDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return date;
  const [year, month, day] = date.split("-").map(Number);
  return `${month}/${day}/${year}`;
}
