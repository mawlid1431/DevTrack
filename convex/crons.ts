import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Recycle bin retention: permanently remove items deleted more than 30 days ago.
crons.daily(
  "purge expired recycle bin items",
  { hourUTC: 3, minuteUTC: 0 },
  internal.trash.purgeExpired,
  {}
);

export default crons;
