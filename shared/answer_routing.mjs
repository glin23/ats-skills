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
  const out = new Set(
    (profile?.factual_gap_fields?.onsite_location_logistics?.confirmed_cities || [])
      .map((c) => String(c).toLowerCase())
  );
  const commitments = profile?.standard_qa?.work_location_commitments || {};
  for (const [place, ok] of Object.entries(commitments)) {
    if (ok === true) out.add(String(place).toLowerCase());
  }
  return [...out];
}

export function mentionsConfirmedCity(label = '', confirmedCities = []) {
  const ml = String(label).toLowerCase();
  return confirmedCities.some((c) => c && ml.includes(c));
}

const STATE_NAMES = {
  AL: 'alabama',
  AK: 'alaska',
  AZ: 'arizona',
  AR: 'arkansas',
  CA: 'california',
  CO: 'colorado',
  CT: 'connecticut',
  DC: 'district of columbia',
  DE: 'delaware',
  FL: 'florida',
  GA: 'georgia',
  HI: 'hawaii',
  IA: 'iowa',
  ID: 'idaho',
  IL: 'illinois',
  IN: 'indiana',
  KS: 'kansas',
  KY: 'kentucky',
  LA: 'louisiana',
  MA: 'massachusetts',
  MD: 'maryland',
  ME: 'maine',
  MI: 'michigan',
  MN: 'minnesota',
  MO: 'missouri',
  MS: 'mississippi',
  MT: 'montana',
  NC: 'north carolina',
  ND: 'north dakota',
  NE: 'nebraska',
  NH: 'new hampshire',
  NJ: 'new jersey',
  NM: 'new mexico',
  NV: 'nevada',
  NY: 'new york',
  OH: 'ohio',
  OK: 'oklahoma',
  OR: 'oregon',
  PA: 'pennsylvania',
  RI: 'rhode island',
  SC: 'south carolina',
  SD: 'south dakota',
  TN: 'tennessee',
  TX: 'texas',
  UT: 'utah',
  VA: 'virginia',
  VT: 'vermont',
  WA: 'washington',
  WI: 'wisconsin',
  WV: 'west virginia',
  WY: 'wyoming',
};

function wordIncludes(haystack, needle) {
  const clean = String(needle || '').trim().toLowerCase();
  if (!clean) return false;
  return new RegExp(`\\b${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(String(haystack || ''));
}

export function currentResidenceYesNoAnswer(label = '', profile = {}) {
  const text = String(label || '');
  const lt = text.toLowerCase();
  if (!/\b(?:do you|are you|currently|already)\b.{0,90}\b(?:live|living|reside|residing|located|based)\b.{0,90}\b(?:in|near|within|around)\b/i.test(text)) {
    return null;
  }
  if (/\b(?:willing|open to|relocat|able to work|can work|commute|transportation|travel)\b/i.test(text)) {
    return null;
  }

  const personal = profile?.personal || {};
  const addr = personal.address || {};
  const rawCity = personal.address_city || addr.city || personal.city || '';
  const city = String(rawCity || '').split(',')[0].trim();
  const stateRaw = String(personal.address_state || addr.state || '').trim();
  const stateUpper = stateRaw.toUpperCase();
  const stateName = STATE_NAMES[stateUpper] || stateRaw.toLowerCase();
  const country = String(personal.address_country || addr.country || '').toLowerCase();
  const livesInUnitedStates = /united states|usa|\bu\.?s\.?\b/.test(country);

  if (!city && !stateRaw && !country) {
    return { needs_user_answer: true, note: 'current_residence_required' };
  }

  const yesTokens = [
    city,
    stateName,
    stateUpper.length === 2 ? stateUpper : '',
    country,
    livesInUnitedStates ? 'united states' : '',
    livesInUnitedStates ? 'usa' : '',
  ].filter(Boolean);

  if ((livesInUnitedStates && /\b(?:US|U\.S\.|USA)\b/.test(text)) ||
      yesTokens.some((token) => wordIncludes(lt, token))) {
    return { value: 'Yes', note: 'current_residence_from_profile' };
  }

  const placeMatch = text.match(/\b(?:live|living|reside|residing|located|based)\b.{0,30}\b(?:in|near|within|around)\s+(?:the\s+)?(.+?)\??$/i);
  const askedPlace = String(placeMatch?.[1] || '').trim().replace(/[.?!]+$/, '');
  if (!askedPlace || /^(area|office|location|role|position|job)$/i.test(askedPlace)) return null;

  return { value: 'No', note: 'current_residence_not_matching_profile' };
}

// --- Work authorization answers ---------------------------------------------
// These two profile fields are FACTS ABOUT THE USER'S PERSON and are THREE-STATE:
//   true      -> the user told us yes
//   false     -> the user told us no
//   null/undef-> we never asked
// Reading them with a truthy check collapses "no" and "never asked" into the
// same branch. Before 2026-07-23 that branch fell back to the answer bank's
// yes_no_defaults, which shipped "Yes" for both — so a user who had explicitly
// said "I am NOT authorized to work in the US" still had "Yes" typed onto a
// real application form, and a US citizen was told to claim they need visa
// sponsorship. The bank is deliberately NOT consulted here any more: a shared
// default cannot know a personal fact. "Never asked" returns null and the
// caller must surface the row as a gap (see workAuthGapFor).
// F-1 honesty is unchanged: an OPT user is authorized NOW (Yes) and answers Yes
// to future sponsorship — never the false "I will not require sponsorship".
function threeStateYesNo(value, requiredNote, fromProfileNote) {
  if (value === true) return { value: 'Yes', needsUser: false, note: fromProfileNote };
  if (value === false) return { value: 'No', needsUser: false, note: fromProfileNote };
  return { value: null, needsUser: true, note: requiredNote };
}

export function deriveWorkAuthAnswers(profile = {}) {
  const auth = profile.work_authorization || {};
  const sponsor = threeStateYesNo(
    auth.requires_sponsorship_future,
    'sponsorship_future_required',
    'sponsorship_future_from_profile',
  );
  const authorized = threeStateYesNo(
    auth.authorized_to_work_us,
    'work_authorization_required',
    'work_authorization_from_profile',
  );
  return {
    sponsorAns: sponsor.value,
    authorizedAns: authorized.value,
    sponsorNeedsUser: sponsor.needsUser,
    authorizedNeedsUser: authorized.needsUser,
    sponsorNote: sponsor.note,
    authorizedNote: authorized.note,
  };
}

// Which form questions are answered FROM those two fields. Kept in sync with the
// consuming buckets in answer_buckets.mjs (`authorized to work` / sponsorship /
// `work auth|visa` / "maintain that authorization") and with the driver's own
// combobox branches, so no question that would be filled from a work-auth fact
// can slip past this guard.
const WORK_AUTH_LABEL_RE = /authorized to work|legally.{0,5}work|eligible to work|right to work|authorized.{0,40}work.{0,20}u\.?s|legally authorized.{0,40}u\.?s/i;
// `\bvisas?\b` and not a bare `visa`: measured 2026-07-25, the unbounded token
// also fired on "ad-VISA-ble", pulling unrelated questions into this guard.
const SPONSORSHIP_LABEL_RE = /sponsor|sponsorship|work auth|\bvisas?\b|(?:maintain|commence|continue|begin|support).{0,40}(?:authorization|immigration)|authorization.{0,15}to (?:work|employ|remain)|immigration case/i;
// "…authorized to work WITHOUT sponsorship" has its own explicit-false-only
// derivation in the drivers (authorizedWithoutSponsorship), so it is not routed
// through the two fields above and is left to that path.
const WITHOUT_SPONSORSHIP_LABEL_RE = /(?:authorized|eligible|right|legally).{0,80}work.{0,80}without.{0,50}sponsor|without.{0,50}sponsor.{0,80}(?:work|employment|authorization)|unrestricted.{0,50}(?:work|employment|authorization)/i;

// Q4 关卡 8: he was asked, once, what to do when a form asks the
// work-authorization question, and "don't answer for me" is the default. That
// instruction covers the whole question family (同族一起 defer). It is NOT the
// same thing as "never asked", and the two must never share a note: the correct
// follow-up to never-asked is to ask, the correct follow-up to deferred is to
// hand him the row and NEVER ask again (设计稿 §13.3.3 接缝硬规定 2).
export function workAuthPolicyDefers(profile = {}) {
  return profile.work_authorization?.form_answer_policy === 'defer_to_user';
}

// The right note for a blocked work-auth row: deferred by his own instruction
// (self-serve list, never re-ask) or the caller's never-asked note. Drivers'
// inline work-auth branches use this so a Q4-C profile is honoured everywhere,
// not only on the labels workAuthGapFor recognises.
export function workAuthBlockNote(profile = {}, neverAskedNote) {
  return workAuthPolicyDefers(profile) ? 'work_authorization_deferred_by_user' : neverAskedNote;
}

// "…authorized to work WITHOUT sponsorship / without restriction" — the fact
// is the two sponsorship booleans, read three-state (ADR-12 R2: the visa_status
// regexes both drivers used here turned free text — once the user's own Chinese
// sentence — into Yes/No claims). 'Yes' only when both are false (the citizen /
// green-card signature in the truth table); 'No' when either is true; null when
// unknowable, and the caller must block the row (关卡 2 ③: 无限制授权未知 →
// 阻塞问清楚再投 — 答错双向都伤). No default branch: that was the fabrication.
export function withoutSponsorshipAnswer(profile = {}) {
  const auth = profile.work_authorization || {};
  const now = auth.requires_sponsorship_now;
  const future = auth.requires_sponsorship_future;
  if (now === false && future === false) return 'Yes';
  if (now === true || future === true) return 'No';
  return null;
}

// Pure gap check: returns a blocking descriptor when the form asks about a
// work-authorization fact the profile cannot answer, else null. Mirrors the
// shape used by currentResidenceYesNoAnswer's blocking branch. `note` says
// WHY the cell is empty: never asked (ask him) vs deferred by his own
// instruction (self-serve list, do not ask).
export function workAuthGapFor(label = '', profile = {}) {
  const text = String(label || '');
  if (!text) return null;
  if (WITHOUT_SPONSORSHIP_LABEL_RE.test(text)) return null;
  const defers = workAuthPolicyDefers(profile);
  const { authorizedNeedsUser, sponsorNeedsUser } = deriveWorkAuthAnswers(profile);
  if (authorizedNeedsUser && WORK_AUTH_LABEL_RE.test(text)) {
    return { needs_user_answer: true, note: defers ? 'work_authorization_deferred_by_user' : 'work_authorization_required' };
  }
  if (sponsorNeedsUser && SPONSORSHIP_LABEL_RE.test(text)) {
    return { needs_user_answer: true, note: defers ? 'work_authorization_deferred_by_user' : 'sponsorship_future_required' };
  }
  return null;
}
