/**
 * handshake_helpers.js — Handshake ATS form helpers
 *
 * ⚠️  v0.6 DISCLAIMER — BEST-GUESS NOT DOGFOOD-VERIFIED
 *
 * 用户 has NOT yet successfully run a real Handshake submission with these
 * helpers. Selectors and field semantics below are inferred from:
 *   - Handshake Help Center docs (joinhandshake.com/hc/en-us)
 *   - Pernell43/HandShake-QuickApply-Bot (ASU-fork open source, last touched
 *     pre-2026 — DOM may have drifted)
 *   - Pattern transfer from Ashby (react-hook-form) and Greenhouse
 *     (react-select v5), since Handshake is a React SPA on app.joinhandshake.com
 *
 * Every selector marked `// TODO-verify` MUST be confirmed against the live
 * DOM on first real submission and adjusted in place. Until then this file is
 * a structural scaffold, not a known-working helper set.
 *
 * Architectural assumptions (verify on first dogfood):
 *   1. Handshake is a React SPA — likely uses event-based input validation
 *      similar to Ashby. Treat text fields as `isTrusted`-required by default
 *      (i.e. prefer CDP `Input.insertText` via `cdp.mjs typetext`).
 *   2. Two apply modes exist:
 *        a. Internal "Quick Apply" / "Apply" → single page on
 *           app.joinhandshake.com, document picker + maybe a few questions.
 *        b. "Apply Externally" → opens new tab to employer's ATS
 *           (Greenhouse / Workday / Ashby / iCIMS / company careers site).
 *           Estimated ~40-60% of jobs based on Handshake's docs noting
 *           Greenhouse and Workday as the only first-party ATS integrations.
 *   3. Resume picker is a document-selection widget (dropdown / radio list
 *      of pre-uploaded resumes), NOT a file upload input. User must have
 *      uploaded resume to their Handshake Documents store in advance.
 *   4. URL form: `https://app.joinhandshake.com/jobs/<id>` (student view)
 *      or `https://app.joinhandshake.com/emp/jobs/<id>` (canonical, also
 *      accessible to students per Handshake support).
 *   5. Login required — Handshake gates all job pages behind student SSO.
 *      Helper assumes the user's Chrome session is already authenticated;
 *      detectLoginRequired() will signal otherwise.
 *
 * v0.6 react-mousedown pattern carryover: any `<select>`-like dropdown is
 * assumed to be react-select v5 (same as Greenhouse/Ashby) and needs the
 * MouseEvent('mousedown') trio. Plain `.click()` will NOT open the menu.
 *
 * Never auto-submits. `findSubmit()` returns the button — caller decides.
 */

(function () {
  const Handshake = {};

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function $(sel) {
    return document.querySelector(sel);
  }

  function getNativeSetter(el) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    return Object.getOwnPropertyDescriptor(proto, 'value').set;
  }

  function dispatchMouseSeries(el) {
    if (!el) return false;
    ['mousedown', 'mouseup', 'click'].forEach((t) =>
      el.dispatchEvent(
        new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 })
      )
    );
    return true;
  }

  // ---------- login / redirect detection ----------

  /**
   * Handshake.detectLoginRequired()
   *
   * Best-effort login check. Handshake's login page lives at
   * `https://app.joinhandshake.com/login` (or school-specific SSO). If we land
   * there OR see a "Sign in" CTA in the top nav, we're not authenticated.
   *
   * TODO-verify: check actual login-page URL + DOM markers. Below is a guess.
   */
  Handshake.detectLoginRequired = function () {
    const path = location.pathname || '';
    if (/\/login|\/sign[_-]?in|\/saml/i.test(path)) {
      return { loginRequired: true, signal: 'url-path', path };
    }
    // Logged-out users typically see a "Sign in" / "Log in" anchor; logged-in
    // users see their avatar / school name in the top right.
    const bodyText = document.body ? document.body.innerText || '' : '';
    if (/^|\s(Sign in|Log in)\s/i.test(bodyText.slice(0, 2000))) {
      return { loginRequired: true, signal: 'sign-in-cta' };
    }
    // If we can see an "Apply" button, we're probably logged in.
    const applyBtn = Array.from(document.querySelectorAll('button, a')).find((el) =>
      /^(Apply|Quick Apply|Apply Externally)$/i.test((el.innerText || '').trim())
    );
    if (applyBtn) {
      return { loginRequired: false, signal: 'apply-button-visible' };
    }
    return { loginRequired: null, signal: 'unknown' };
  };

  /**
   * Handshake.detectRedirectToExternalATS()
   *
   * If user clicked "Apply Externally", Handshake opens a NEW TAB pointed at
   * the employer's ATS. This function inspects current URL and returns a hint
   * for the orchestrator to dispatch to ats-greenhouse / ats-ashby / etc.
   *
   * Heuristic: if location.hostname is NOT app.joinhandshake.com, we're on the
   * external ATS already.
   *
   * Returns: { redirected, target_url, target_ats }
   *   target_ats ∈ 'greenhouse' | 'ashby' | 'workday' | 'lever' | 'icims' | 'unknown'
   */
  Handshake.detectRedirectToExternalATS = function () {
    const host = location.hostname || '';
    const url = location.href || '';
    if (/joinhandshake\.com$/i.test(host)) {
      return { redirected: false, target_url: url, target_ats: null };
    }
    let target_ats = 'unknown';
    if (/greenhouse\.io$/i.test(host) || /\.greenhouse\.io/i.test(host)) {
      target_ats = 'greenhouse';
    } else if (/ashbyhq\.com$/i.test(host) || /jobs\.ashbyhq\.com/i.test(host)) {
      target_ats = 'ashby';
    } else if (/myworkdayjobs\.com$/i.test(host) || /workday/i.test(host)) {
      target_ats = 'workday';
    } else if (/lever\.co$/i.test(host) || /jobs\.lever\.co/i.test(host)) {
      target_ats = 'lever';
    } else if (/icims\.com$/i.test(host)) {
      target_ats = 'icims';
    }
    return { redirected: true, target_url: url, target_ats };
  };

  // ---------- text fields ----------

  /**
   * Handshake.setVal(fieldId, value)
   *
   * Best-effort JS fallback for text/email/phone inputs and textareas.
   * Same caveat as Ashby — Handshake is React, so isTrusted matters.
   * PREFER `cdp.mjs typetext` for required fields.
   */
  Handshake.setVal = function (fieldId, value) {
    const el = $('#' + CSS.escape(fieldId));
    if (!el) return { ok: false, selector: '#' + fieldId, note: 'not_found' };
    try {
      el.focus();
      const setter = getNativeSetter(el);
      setter.call(el, value == null ? '' : String(value));
      el.dispatchEvent(
        new InputEvent('input', {
          inputType: 'insertText',
          data: String(value ?? ''),
          bubbles: true,
        })
      );
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return {
        ok: el.value === String(value ?? ''),
        selector: '#' + fieldId,
        note: 'use_typetext', // caller should prefer CDP typetext
      };
    } catch (e) {
      return { ok: false, selector: '#' + fieldId, note: 'error:' + e.message };
    }
  };

  // ---------- document picker (Handshake-specific) ----------

  /**
   * Handshake.pickDocument(documentName, documentType)
   *
   * Handshake's apply flow shows a document picker — list/dropdown of resumes
   * (and cover letters / transcripts if required) the user has pre-uploaded.
   * The most recent resume is pre-selected by default.
   *
   * documentType ∈ 'resume' | 'cover_letter' | 'transcript' | 'other'
   *
   * TODO-verify: actual selector for the document picker. Best guess:
   *   - radio buttons inside `[data-hook="document-picker"]` (Handshake uses
   *     `data-hook` attrs heavily based on the QuickApply-Bot reference)
   *   - OR a react-select with placeholder "Choose a resume"
   *
   * Caller usually doesn't need this — default selected resume is already
   * the most recent one. Use only if the user wants to pick a specific
   * older resume.
   */
  Handshake.pickDocument = async function (documentName, documentType) {
    documentType = documentType || 'resume';
    // TODO-verify: confirm selectors against live DOM
    const containerSelectors = [
      `[data-hook="document-picker-${documentType}"]`,
      `[data-hook="${documentType}-picker"]`,
      `[aria-label*="${documentType}" i]`,
    ];
    let container = null;
    for (const sel of containerSelectors) {
      container = document.querySelector(sel);
      if (container) break;
    }
    if (!container) {
      return {
        ok: false,
        note: 'document_picker_not_found',
        hint: 'TODO-verify: update selectors after first dogfood',
      };
    }
    // Try radio first (simpler), then dropdown
    const radios = container.querySelectorAll('input[type=radio]');
    for (const r of radios) {
      const labelEl = document.querySelector('label[for="' + r.id + '"]');
      const labelText = labelEl ? labelEl.innerText : '';
      if (
        labelText.toLowerCase().includes(String(documentName || '').toLowerCase())
      ) {
        r.click();
        await sleep(150);
        return { ok: true, picked: labelText.trim(), strategy: 'radio' };
      }
    }
    // Fall through to react-select pattern
    const ctl = container.querySelector('.select__control');
    if (ctl) {
      dispatchMouseSeries(ctl);
      await sleep(300);
      const opts = Array.from(document.querySelectorAll('.select__option'));
      const target = String(documentName || '').toLowerCase();
      const match =
        opts.find((o) => (o.innerText || '').toLowerCase().includes(target)) ||
        opts[0];
      if (match) {
        dispatchMouseSeries(match);
        await sleep(200);
        return { ok: true, picked: match.innerText.trim(), strategy: 'react-select' };
      }
    }
    return { ok: false, note: 'no_matching_document' };
  };

  // ---------- react-select v5 picker (carryover) ----------

  /**
   * Handshake.pickSelect(fieldId, optionText)
   *
   * Same react-select v5 mechanics as Greenhouse/Ashby. Use mousedown trio.
   */
  Handshake.pickSelect = async function (fieldId, optionText) {
    const input = $('#' + CSS.escape(fieldId));
    if (!input) return { ok: false, note: 'field_not_found' };
    const control = input.closest('.select__control');
    if (!control) return { ok: false, note: 'no_select_control' };

    try {
      control.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch (_) {
      control.scrollIntoView({ block: 'center' });
    }
    await sleep(200);
    dispatchMouseSeries(control);
    await sleep(200);

    const wanted = String(optionText).trim().toLowerCase();
    let target = null;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !target) {
      const opts = document.querySelectorAll('.select__option');
      for (const o of opts) {
        if ((o.innerText || '').trim().toLowerCase() === wanted) {
          target = o;
          break;
        }
      }
      if (!target) await sleep(100);
    }
    if (!target) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { ok: false, note: 'option_not_found:' + optionText };
    }
    dispatchMouseSeries(target);
    await sleep(150);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const shown = (control.innerText || '').trim();
    return { ok: shown.toLowerCase().includes(wanted), shown };
  };

  // ---------- normalize / inventory ----------

  /**
   * Handshake.normalizeProfile(raw)
   *
   * Same shape as Ashby — full_name combined, plus document_preferences for
   * the Handshake document picker.
   */
  Handshake.normalizeProfile = function (raw) {
    if (!raw) return null;
    if (!raw.personal && (raw.name || raw.email)) {
      return Object.assign(
        { custom_answers: {}, picker_answers: {}, document_preferences: {} },
        raw,
        { _raw: raw }
      );
    }
    const personal = raw.personal || {};
    const fullName =
      personal.full_name ||
      [personal.first_name, personal.last_name].filter(Boolean).join(' ').trim() ||
      undefined;
    return {
      name: fullName,
      full_name: fullName,
      email: personal.email,
      phone: personal.phone,
      linkedin: personal.linkedin,
      website: personal.portfolio,
      // Handshake-specific: which uploaded doc to use (caller may override
      // per-application; default is most-recent resume which Handshake
      // pre-selects automatically).
      document_preferences: raw.document_preferences || {
        resume: 'most_recent',
        cover_letter: null,
      },
      custom_answers: {},
      picker_answers: {},
      standard_answers: raw.standard_answers || {},
      _raw: raw,
    };
  };

  /**
   * Handshake.findEmptyRequired()
   *
   * TODO-verify: Handshake's actual required-field markers. Guesses:
   *   - `aria-required="true"` (common React pattern, used by Ashby)
   *   - HTML `required` attribute
   *   - Asterisk in label (same as Greenhouse)
   *
   * Returns: Array<{ id, label, type, required, currentValue, options }>
   */
  Handshake.findEmptyRequired = function () {
    const result = [];
    const seen = new Set();

    const push = (entry) => {
      if (!entry || seen.has(entry.id || entry.element)) return;
      if (entry.id) seen.add(entry.id);
      result.push(entry);
    };

    // 1) aria-required + HTML required
    const required = document.querySelectorAll(
      '[aria-required="true"], input[required], select[required], textarea[required]'
    );
    for (const el of required) {
      if (!el.id) continue;
      if (!el.offsetParent && !el.closest('.select__control')) continue;
      const labelEl = document.querySelector('label[for="' + el.id + '"]');
      const label = labelEl ? labelEl.innerText : '';
      if (el.closest('.select__control')) {
        const ctl = el.closest('.select__control');
        const display = (ctl.innerText || '').trim();
        if (!display || /^select/i.test(display)) {
          push({
            id: el.id,
            label: label.replace(/\s*\*\s*$/, '').trim() || '(no label)',
            type: 'react-select',
            required: true,
            currentValue: display,
            options: null,
          });
        }
      } else if (!el.value) {
        push({
          id: el.id,
          label: label.replace(/\s*\*\s*$/, '').trim() || '(no label)',
          type: el.type || el.tagName.toLowerCase(),
          required: true,
          currentValue: '',
          options: null,
        });
      }
    }

    // 2) Document picker — caller should always check this since Handshake's
    //    most-recent-resume default may not be the user's preferred resume.
    // TODO-verify: actual selector
    const docPickers = document.querySelectorAll(
      '[data-hook*="document-picker"], [aria-label*="resume" i]'
    );
    for (const dp of docPickers) {
      const checked = dp.querySelector('input[type=radio]:checked');
      if (!checked) {
        push({
          id: dp.id || ('doc-picker-' + Math.random().toString(36).slice(2, 8)),
          element: dp,
          label: dp.getAttribute('aria-label') || 'Document picker',
          type: 'handshake-document-picker',
          required: true,
          currentValue: '',
          options: null,
          note: 'caller: use Handshake.pickDocument(name, type)',
        });
      }
    }

    return result;
  };

  // ---------- fillForm entry ----------

  /**
   * Handshake.fillForm(profile)
   *
   * Returns plan array, same shape as Ashby.fillForm. Each item:
   *   { action, selector|fieldId, value, label }
   *
   * action ∈ 'typetext' | 'select' | 'pick_document' | 'yesno'
   *
   * v0.6 caveat: actual Handshake apply form likely simpler than Ashby
   * (most fields are pulled from student profile automatically — the apply
   * dialog is often just "pick resume + click Submit"). Plan may be short.
   */
  Handshake.fillForm = function (profile) {
    profile = profile || {};
    if (profile.personal && !profile.full_name && !profile.name) {
      profile = Handshake.normalizeProfile(profile);
    }
    const plan = [];

    // Document picker — usually only field that needs action
    if (profile.document_preferences && profile.document_preferences.resume) {
      plan.push({
        action: 'pick_document',
        documentType: 'resume',
        value:
          profile.document_preferences.resume === 'most_recent'
            ? null // null = accept default selection
            : profile.document_preferences.resume,
        label: 'Resume',
        note:
          profile.document_preferences.resume === 'most_recent'
            ? 'verify_default_selection'
            : 'pick_specific',
      });
    }

    // Custom questions — Handshake may attach a few free-text or radio fields
    // beyond the document picker for certain employers. TODO-verify selectors.
    const textInputs = document.querySelectorAll(
      'input[type=text], input[type=email], input[type=tel], textarea'
    );
    for (const inp of textInputs) {
      if (!inp.id) continue;
      if (inp.value) continue;
      const labelEl = document.querySelector('label[for="' + inp.id + '"]');
      const labelText = labelEl ? (labelEl.innerText || '').toLowerCase() : '';
      if (!labelText) continue;
      // Match a few common patterns
      if (labelText.includes('why') || labelText.includes('cover')) {
        plan.push({
          action: 'typetext',
          selector: '#' + inp.id,
          value: null,
          label: labelText,
          note: 'needs_manual_answer',
        });
      }
    }

    // Yes/No or radio questions — TODO-verify Handshake DOM. For now flag as unknown.
    // ...placeholder until first dogfood reveals actual structure

    return { ok: true, plan, _disclaimer: 'v0.6 best-guess — verify on dogfood' };
  };

  // ---------- submit / success ----------

  /**
   * Handshake.findSubmit()
   *
   * Handshake's apply dialog has a "Submit Application" button. Selectors are
   * best guesses — verify on first dogfood.
   */
  Handshake.findSubmit = function () {
    const candidates = [
      'button[data-hook="apply-modal-submit"]', // TODO-verify
      'button[data-hook="submit-application"]', // TODO-verify
      'button[type=submit]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        return { ok: true, selector: sel, text: (el.innerText || '').trim() };
      }
    }
    // last resort — any button with "Submit Application" / "Apply" text
    const buttons = document.querySelectorAll('button');
    for (const b of buttons) {
      const txt = (b.innerText || '').trim().toLowerCase();
      if (
        (txt === 'submit application' || txt === 'submit' || txt === 'apply') &&
        b.offsetParent !== null
      ) {
        return { ok: true, selector: 'button', text: b.innerText.trim() };
      }
    }
    return { ok: false, note: 'submit_button_not_found' };
  };

  /**
   * Handshake.checkSuccess()
   *
   * Per Handshake's help center, successful submission shows an in-app
   * confirmation AND sends a "Application Submitted" email. The in-app
   * confirmation is most likely a modal / banner with text like
   * "Application submitted" or "You've applied to <company>".
   *
   * TODO-verify exact confirmation copy.
   */
  Handshake.checkSuccess = function () {
    const txt = document.body ? document.body.innerText || '' : '';
    const patterns = [
      /application\s+submitted/i,
      /you'?ve\s+applied/i,
      /thanks\s+for\s+applying/i,
      /your\s+application\s+has\s+been\s+(submitted|sent)/i,
    ];
    for (const p of patterns) {
      if (p.test(txt)) {
        return { ok: true, snippet: txt.slice(0, 300), matched: String(p) };
      }
    }
    return { ok: false, snippet: txt.slice(0, 300) };
  };

  // expose
  window.Handshake = Handshake;
  globalThis.Handshake = Handshake;
  return 'Handshake ready (v0.6 best-guess): ' + Object.keys(Handshake).join(',');
})();
