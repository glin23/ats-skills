// Pure answer-routing helpers extracted from ashby_apply_driver.mjs so the
// safety-critical decisions can be unit-tested WITHOUT a live browser tab.
// Behavior here is verbatim with the driver's prior inline logic — these are
// extractions, not rewrites. The driver imports them and still performs the
// actual CDP fill/click; only the *decision* lives here.

// --- Specific-city LOGISTICS FACT detection ---------------------------------
// Matches questions that assert the user already RESIDES in / has physical
// TRANSPORT to a NAMED place — a personal fact the tool cannot know. A bare
// named city with no transport/residence verb is NOT caught, so general
// willingness phrasings still flow through to the policy path.
const TRANSPORT_FACT_RE = /reliable transportation|own transportation|have transportation|access to (?:reliable )?transportation|means of transportation|commute (?:to|into)/i;
const RESIDENCE_FACT_RE = /currently (?:live|living|reside|residing|located|based)|do you (?:live|reside)|already (?:live|living|reside|based)/i;

export function isSpecificCityLogisticsFact(label = '') {
  const s = String(label);
  return TRANSPORT_FACT_RE.test(s) || RESIDENCE_FACT_RE.test(s);
}

// Open-ended residence prompts ask the user to STATE where they live, with no
// named metro and no yes/no framing — e.g. "Where do you currently live?",
// "Where do you reside?", "Current city". The answer is the user's real city
// from their profile (a known fact, NOT something the tool cannot know), so
// these are answerable and should bypass the specific-city-fact guard. A NAMED
// yes/no question ("Are you currently located in the Bay Area?") does NOT match
// here and stays guarded.
const OPEN_ENDED_RESIDENCE_RE = /\bwhere (?:do|are) you\b[^?]{0,40}\b(?:live|living|reside|residing|located|based)\b|\bwhat (?:city|town)\b[^?]{0,30}\b(?:live|reside|based|from)\b|\bcurrent (?:city|residence|home (?:city|address))\b|\bcity of residence\b/i;

export function isOpenEndedResidenceQuestion(label = '') {
  return OPEN_ENDED_RESIDENCE_RE.test(String(label));
}

// --- Relocation policy ------------------------------------------------------
// True only when the user explicitly opted into relocating anywhere legally
// workable. Accepts either the whole search_intent.json object or the inner
// geographic_preference object.
export function relocationPolicyOpen(searchIntent = {}) {
  const geo = searchIntent?.search_intent?.geographic_preference
    || searchIntent?.geographic_preference
    || {};
  return geo.relocation_policy === 'anywhere_legal_work'
    && geo.willing_to_relocate_for_internship === true;
}

// Cities the user has explicitly confirmed living-in / having logistics for.
// Empty by default so unknown cities always ask-or-skip.
export function confirmedCitiesFrom(profile = {}) {
  return (profile?.factual_gap_fields?.onsite_location_logistics?.confirmed_cities || [])
    .map((c) => String(c).toLowerCase());
}

export function mentionsConfirmedCity(label = '', confirmedCities = []) {
  const ml = String(label).toLowerCase();
  return confirmedCities.some((c) => c && ml.includes(c));
}

// --- Work authorization answers ---------------------------------------------
// F-1 honesty: an OPT user is authorized NOW (Yes) and "Yes" to future
// sponsorship — never the false "I will not require sponsorship". Profile
// overrides the answer-bank defaults where present.
export function deriveWorkAuthAnswers(profile = {}, bank = {}) {
  const auth = profile.work_authorization || {};
  const sponsorAns = auth.requires_sponsorship_future
    ? 'Yes'
    : (bank.yes_no_defaults?.sponsorship_future || 'Yes');
  const authorizedAns = auth.authorized_to_work_us
    ? 'Yes'
    : (bank.yes_no_defaults?.work_authorization || 'Yes');
  return { sponsorAns, authorizedAns };
}
