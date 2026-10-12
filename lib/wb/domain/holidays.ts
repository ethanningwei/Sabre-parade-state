// Singapore public holidays, as published by MOM
// (mom.gov.sg/employment-practices/public-holidays, read 2026-10-12).
// Used only to pre-untick leave days: the trooper can tick them back.
//
// A holiday on a Sunday makes the Monday a holiday for anyone whose rest day
// is Sunday, so those Mondays are listed too, as "(in lieu)".
//
// 2028 isn't published yet (MOM publishes mid-year). Add it when it is; until
// then 2028 leave just starts with every day ticked.

export interface Holiday {
  /** YYYY-MM-DD */
  date: string;
  name: string;
}

export const PUBLIC_HOLIDAYS: readonly Holiday[] = [
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-02-17", name: "Chinese New Year" },
  { date: "2026-02-18", name: "Chinese New Year" },
  { date: "2026-03-21", name: "Hari Raya Puasa" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-05-01", name: "Labour Day" },
  { date: "2026-05-27", name: "Hari Raya Haji" },
  { date: "2026-05-31", name: "Vesak Day" },
  { date: "2026-06-01", name: "Vesak Day (in lieu)" },
  { date: "2026-08-09", name: "National Day" },
  { date: "2026-08-10", name: "National Day (in lieu)" },
  { date: "2026-11-08", name: "Deepavali" },
  { date: "2026-11-09", name: "Deepavali (in lieu)" },
  { date: "2026-12-25", name: "Christmas Day" },

  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-02-06", name: "Chinese New Year" },
  { date: "2027-02-07", name: "Chinese New Year" },
  { date: "2027-02-08", name: "Chinese New Year (in lieu)" },
  { date: "2027-03-10", name: "Hari Raya Puasa" },
  { date: "2027-03-26", name: "Good Friday" },
  { date: "2027-05-01", name: "Labour Day" },
  { date: "2027-05-17", name: "Hari Raya Haji" },
  { date: "2027-05-20", name: "Vesak Day" },
  { date: "2027-08-09", name: "National Day" },
  { date: "2027-10-28", name: "Deepavali" },
  { date: "2027-12-25", name: "Christmas Day" },
];

const BY_DATE = new Map(PUBLIC_HOLIDAYS.map((h) => [h.date, h.name]));

/** The holiday's name on that date, or null. */
export const holidayOn = (date: string): string | null => BY_DATE.get(date) ?? null;
