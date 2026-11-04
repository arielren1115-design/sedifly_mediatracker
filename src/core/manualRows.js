// A row typed into Coverage by hand gets its ID and the script owned defaults on the next run (BUILD_SPEC 6.1).
import { normalizeUrl } from './normalizeUrl.js';

const blank = (v) => v === '' || v === null || v === undefined;

/** A row counts as typed by hand when it has no Coverage ID but has a link, a title or an outlet. */
export const needsId = (v) => blank(v['Coverage ID']) && ['URL', 'Title', 'Outlet'].some((h) => !blank(v[h]));

/**
 * The cells the script fills on a hand typed row. Only blank cells are ever filled, never anything a person wrote.
 * @param {Object<string, any>} values the row by header name
 * @param {{coverageId: string, now: Date}} ctx
 * @returns {Object<string, any>} header to value
 */
export function manualRowDefaults(values, { coverageId, now }) {
  const fill = {};
  const set = (h, v) => { if (blank(values[h]) && !blank(v)) fill[h] = v; };
  set('Coverage ID', coverageId);
  set('Detected at', now);
  set('Normalised URL', normalizeUrl(values.URL));
  set('Found in', 'Manual');
  set('Source route', 'Manual');
  set('Archive status', 'Pending');
  set('Verification', 'Needs verification');
  set('Last updated', now);
  return fill;
}

/** Headers the script may fill on a hand typed row. */
export const MANUAL_FILLABLE = ['Coverage ID', 'Detected at', 'Normalised URL', 'Found in', 'Source route', 'Archive status', 'Verification', 'Last updated'];
