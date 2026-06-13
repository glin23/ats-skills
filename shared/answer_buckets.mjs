// Pure answer-bucket matching extracted from ashby_apply_driver.mjs's
// answerMissing(). The DECISION — "which keyword bucket matches a given field
// label, and what concrete value/choice should be filled" — is pure and now
// lives here so it can be unit-tested WITHOUT a live browser tab. The driver
// still performs the actual CDP eval/click/fill on the returned descriptor.
//
// Behavior here is VERBATIM with the driver's prior inline `buckets` array and
// `buckets.find(b => b.match.test(ml))` — every regex, action, value, choice,
// fallback, and the `relocationCommitment` flag are moved unchanged. The bucket
// values that referenced driver-scope variables (linkedin, cityFull,
// compensationExpectation, sponsorAns, authorizedAns, rtoAns, PNA, genderAns,
// raceAns, veteranAns, disabilityAns, profile fields) are now supplied via the
// `ctx` object the driver builds from PROFILE/BANK/SEARCH_INTENT.

export const PNA = 'I prefer not to answer';

// Build the keyword → descriptor bucket list. `missingLabel` is the original
// (non-lowercased) field label; it is embedded into each descriptor's `q` so
// the driver's CDP handlers can scope to the right question container exactly
// as before. `ctx` carries the driver-resolved values.
export function buildAnswerBuckets(missingLabel, ctx = {}) {
  const {
    PROFILE = {},
    authorizedAns,
    sponsorAns,
    rtoAns,
    genderAns,
    raceAns,
    veteranAns,
    disabilityAns,
    cityFull,
    compensationExpectation,
    earliestStartDate,
    linkedin,
    pna = PNA,
  } = ctx;
  const personal = PROFILE.personal || {};
  const education = PROFILE.education || {};
  const workAuth = PROFILE.work_authorization || {};
  const visaStatus = String(workAuth.visa_status || '').toLowerCase();
  const authorizedWithoutSponsorship =
    workAuth.requires_sponsorship_now === false &&
    workAuth.requires_sponsorship_future === false &&
    !/f-?1|opt|cpt|h-?1b|j-?1|visa|sponsor/.test(visaStatus);
  const withoutSponsorshipAns = authorizedWithoutSponsorship ? 'Yes' : 'No';

  return [
    { match: /phone|mobile|telephone|cell ?phone/i, action: 'fill_phone', q: missingLabel },
    { match: /^resume$|upload.{0,10}resume/i, action: 'upload_resume' },
    { match: /start date|earliest start|when can you start|when could you start/i, action: 'fill_text_in_question', q: missingLabel, value: earliestStartDate || PROFILE.standard_qa?.earliest_start_date || '06/01/2026' },
    { match: /marketing funnel|email marketing|a\/b testing|ab testing|heard of.{0,20}testing/i, action: 'click_radio_in_question', q: missingLabel, choice: 'Yes', fallback: '' },
    { match: /freshman|sophomore/i, action: 'click_radio_in_question', q: missingLabel, choice: 'No', fallback: '' },
    { match: /graduate.{0,15}2025|2025.{0,15}earlier/i, action: 'click_radio_in_question', q: missingLabel, choice: 'No', fallback: '' },
    { match: /graduate.{0,15}2026|2026.{0,15}later/i, action: 'click_radio_in_question', q: missingLabel, choice: 'Yes', fallback: '' },
    { match: /confirm.{0,20}acknowledge.{0,30}internship details|hours and pay align/i, action: 'click_single_radio_in_question', q: missingLabel },
    { match: /authorized.{0,30}canada|legally.{0,15}work.{0,15}canada|reside.{0,20}canada|residency.{0,10}canada/i, action: 'click_radio_in_question', q: missingLabel, choice: 'No', fallback: '' },
    { match: /(?:authorized|eligible|right|legally).{0,80}work.{0,80}without.{0,50}sponsor|without.{0,50}sponsor.{0,80}(?:work|employment|authorization)|unrestricted.{0,50}(?:work|employment|authorization)/i, action: 'click_radio_in_question', q: missingLabel, choice: withoutSponsorshipAns, fallback: pna },
    // Authorization separate from sponsorship: "Are you authorized to work" → Yes (F-1 OPT)
    { match: /authorized to work|legally.{0,5}work|eligible to work|right to work/i, action: 'click_radio_in_question', q: missingLabel, choice: authorizedAns, fallback: pna },
    { match: /do you need.{0,40}sponsor.{0,40}work authorization|sponsor your work authorization/i, action: 'click_radio_in_question', q: missingLabel, choice: sponsorAns, fallback: pna },
    { match: /require.{0,5}sponsor|need.{0,5}sponsor|sponsorship/i, action: 'click_radio_in_question', q: missingLabel, choice: sponsorAns, fallback: pna },
    { match: /work auth|visa/i, action: 'click_radio_in_question', q: missingLabel, choice: sponsorAns, fallback: pna },
    // Non-standard sponsorship phrasings, e.g. "require the support of X to maintain
    // that authorization" / "commence an immigration case". Answer follows sponsorAns.
    { match: /(maintain|commence|continue|begin|support|sponsor).{0,40}(authorization|immigration)|authorization.{0,15}to (work|employ|remain)|immigration case/i, action: 'click_radio_in_question', q: missingLabel, choice: sponsorAns, fallback: pna },
    // Remote-comfort questions ("Are you comfortable working remote?") — the user
    // is remote-acceptable, so answer Yes. Kept narrow to remote-positive phrasings
    // so it never collides with onsite/RTO willingness questions below.
    { match: /comfortable.{0,25}(working )?remote|able to work.{0,15}remote|work(ing)?.{0,10}(fully )?remote|fully remote|remote work|work from home/i, action: 'click_radio_in_question', q: missingLabel, choice: 'Yes', fallback: pna },
    {
      match: /currently located.{0,40}(san francisco|sf bay|bay area)|sf bay area/i,
      action: 'click_radio_in_question',
      q: missingLabel,
      choices: [
        'Yes, I am open to relocation',
        "Yes, I'm open to relocation",
        'Yes, I am open to relocating',
        "No, but I'm open to relocating to the Bay Area",
        'No, but I am open to relocating to the Bay Area',
        'Open to relocation',
        'Willing to relocate',
        'No'
      ]
    },
    // Work-style / work-arrangement preference ("Which work style(s) are you open
    // to?") — the user is open to any mode (remote-acceptable + relocate-anywhere),
    // so prefer Remote but accept hybrid/onsite/flexible options the form offers.
    { match: /work style|working style|work arrangement|work setting|work mode|preferred.{0,15}work (location|environment)/i, action: 'click_radio_in_question', q: missingLabel, choices: ['Remote', 'Hybrid', 'Flexible', 'No preference', 'On-site', 'Onsite', 'In-person', 'In office', 'Open to all'] },
    // RTO / onsite-commitment / relocation-willingness phrasings.
    // These assert a WILLINGNESS (covered by relocation_policy) rather than a
    // residence/transport fact (those are intercepted by the specific-city-fact
    // guard above). They are tagged `relocationCommitment` so they only auto-Yes
    // when the user's policy permits; otherwise they fall through to pending.
    { match: /requires working.{0,120}offices?.{0,80}(days?|week)|offices?.{0,80}(three|3)\s+days?.{0,40}week/i, action: 'click_radio_in_question', q: missingLabel, choice: rtoAns, fallback: pna, relocationCommitment: true },
    { match: /available to work.{0,80}\d+\s*days?.{0,80}(headquarters|hq|office|on[- ]?site|onsite)|headquarters/i, action: 'click_radio_in_question', q: missingLabel, choice: rtoAns, fallback: pna, relocationCommitment: true },
    { match: /prepared to work.{0,25}\d\+?.{0,25}days.{0,40}office|san francisco office/i, action: 'click_radio_in_question', q: missingLabel, choice: 'Yes', fallback: pna, relocationCommitment: true },
    { match: /rto|return to office|office.{0,5}\d+.{0,5}day|in[- ]office|in.{0,5}person|hybrid|on[- ]site|onsite|based in.{0,15}(office|nyc|sf)|relocate|willing.{0,15}move|currently.{0,5}reside/i, action: 'click_radio_in_question', q: missingLabel, choice: rtoAns, fallback: pna, relocationCommitment: true },
    { match: /gender/i, action: 'click_radio_in_question', q: missingLabel, choice: genderAns, fallback: 'Decline to self-identify' },
    { match: /race|ethnic/i, action: 'click_radio_in_question', q: missingLabel, choice: raceAns, fallback: 'Decline to self-identify' },
    { match: /sexual orientation/i, action: 'click_checkbox_in_question', q: missingLabel, choice: pna },
    { match: /veteran/i, action: 'click_radio_in_question', q: missingLabel, choice: veteranAns, fallback: pna },
    { match: /disab/i, action: 'click_radio_in_question', q: missingLabel, choice: disabilityAns, fallback: pna },
    { match: /current location|^location$|^city$|where are you located|where are you currently based|currently based|where.*based|where (do|are) you.{0,40}(live|living|reside|residing)|where do you reside|current (city|residence)|city of residence/i, action: 'fill_location_combobox', q: missingLabel, value: cityFull },
    // Work-location plan ("From which city/state are you planning to work?") — NOT a
    // residence/transport fact (isSpecificCityLogisticsFact lets it through), so answer
    // with the user's base city. fill_location_combobox falls back to a text fill.
    { match: /which (city|state).{0,40}(work|plan)|city\s*\/\s*state.{0,25}(work|plan|based)|city and state.{0,25}(work|plan|based)|where.{0,20}plan.{0,15}work/i, action: 'fill_location_combobox', q: missingLabel, value: cityFull },
    { match: /compensation|salary|pay expectation|expected pay|expected compensation/i, action: 'fill_text_in_question', q: missingLabel, value: compensationExpectation },
    { match: /linkedin/i, action: 'fill_text_in_question', q: missingLabel, value: linkedin },
    { match: /portfolio|website/i, action: 'fill_text_in_question', q: missingLabel, value: personal.portfolio || linkedin },
    // Major / field of study — tested BEFORE university/school so "major" wins.
    { match: /\bmajor\b|field of study|area of study|course of study|what.{0,15}studying/i, action: 'fill_text_in_question', q: missingLabel, value: education.minor && education.major ? `${education.major} (minor: ${education.minor})` : (education.major || '') },
    { match: /university|school/i, action: 'fill_text_in_question', q: missingLabel, value: education.school || '' },
    { match: /^degree|degree$/i, action: 'fill_text_in_question', q: missingLabel, value: education.degree || '' },
    { match: /graduation date|when do you expect to graduate|expected graduation|graduation (month|year)|anticipated graduation/i, action: 'fill_text_in_question', q: missingLabel, value: ctx.graduationDate || 'May 2027' },
    // Name fields — extremely common on Ashby; resolve from profile, never pending.
    // Order matters: "preferred"/"legal" qualifiers must be tested before the plain forms.
    { match: /preferred first name/i, action: 'fill_text_in_question', q: missingLabel, value: personal.preferred_name || personal.first_name },
    { match: /preferred last name/i, action: 'fill_text_in_question', q: missingLabel, value: personal.last_name },
    { match: /preferred name/i, action: 'fill_text_in_question', q: missingLabel, value: personal.preferred_name || personal.first_name },
    { match: /(legal )?(first|given) name/i, action: 'fill_text_in_question', q: missingLabel, value: personal.first_name },
    { match: /(legal )?(last|family) name|surname/i, action: 'fill_text_in_question', q: missingLabel, value: personal.last_name },
    { match: /(legal|full) name/i, action: 'fill_text_in_question', q: missingLabel, value: personal.full_name },
  ];
}

// Pure decision: return the matched bucket descriptor for `label` (action +
// resolved value/choice + flags), or null when no bucket matches. The driver
// then executes the returned action exactly as before. Mirrors the prior
// inline `const bucket = buckets.find((b) => b.match.test(ml))`.
export function matchAnswerBucket(label = '', ctx = {}) {
  const ml = String(label).toLowerCase();
  const buckets = buildAnswerBuckets(label, ctx);
  return buckets.find((b) => b.match.test(ml)) || null;
}
