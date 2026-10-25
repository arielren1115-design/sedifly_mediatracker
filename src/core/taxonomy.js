// Classification vocabulary. Values come from the owners (Ben, 2026-10-25); the one line definitions are drawn from the
// Monitoring Rules and Monitored Entities sheets and are DRAFT until Ben confirms them.

export const CATEGORIES = [
  { value: 'General', definition: 'Education, EdTech or AI items with clear Sedifly, strategist or market relevance. Generic education or AI news with no Sedifly connection is not relevant.' },
  { value: 'Event', definition: 'Events and webinars, and coverage of partners and partnerships. Partnership coverage is classified as Event.' },
  { value: 'Brand', definition: 'A direct third party mention of Sedifly or its founder Joash Lee. Founder profile coverage is Brand unless Event applies.' },
  { value: 'Strategist', definition: 'Coverage of a current Sedifly strategist. It is in scope even when Sedifly is not mentioned.' },
];

export const PRIORITIES = [
  { value: 'Critical', definition: 'Reputationally damaging coverage, a material factual error about Sedifly, or a high impact item whose classification is uncertain. Triggers an instant alert (MR-001, MR-002, MR-005).' },
  { value: 'High', definition: 'Major or high reach coverage, or a time sensitive amplification opportunity. Instant alert the same day (MR-003, MR-004).' },
  { value: 'Standard', definition: 'Meaningful coverage that is not time sensitive. Goes into the daily digest (MR-006 to MR-009).' },
  { value: 'Low', definition: 'Archive only: duplicates, syndicated copies, low value listings, historical items and low relevance general material (MR-010 to MR-014).' },
];

/** DRAFT definitions: Ben still to confirm where Reddit, Hacker News and forum posts belong. */
export const SOURCE_TYPES = [
  { value: 'Media', definition: 'News and blog coverage published by a media outlet or publication.' },
  { value: 'Social Media', definition: 'A post or comment on a social platform such as LinkedIn, Instagram, X, TikTok, Facebook or YouTube.' },
  { value: 'Non-Media Listings', definition: 'A company directory or aggregator listing that is not editorial coverage.' },
];

export const SENTIMENTS = ['Positive', 'Neutral', 'Negative', 'Unclear'];

export const CHANNELS = ['News', 'Blog', 'Listing', 'Reddit', 'Hacker News', 'Forum', 'Social', 'Podcast', 'Other'];

/** The Priority value that means Critical (owner confirmed). */
export const CRITICAL_PRIORITY = 'Critical';
