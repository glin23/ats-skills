/**
 * icims_helpers.js — iCIMS ATS form helpers (v0.8 ALPHA, best-guess scaffold)
 *
 * ⚠️  v0.8 ALPHA DISCLAIMER — NOT LIVE-VERIFIED.
 *
 * 用户 has NOT yet successfully run a real iCIMS submission with these helpers.
 * Selectors / field semantics below are inferred from:
 *   - iCIMS Career Connector official documentation (form template field names)
 *   - Open-source iCIMS scrapers + reverse-engineering snippets on GitHub
 *   - Sampling of live `careers-*.icims.com` apply flows (Thermo Fisher,
 *     Cintas, Ross — note these are all classic-template, NOT Refresh)
 *   - Pattern transfer from Greenhouse / Ashby / Handshake helpers
 *
 * Every selector marked `// TODO-verify` MUST be confirmed against the live
 * DOM on first real submission and adjusted in place.
 *
 * Architectural assumptions (verify on first live verification):
 *   1. iCIMS classic template uses server-rendered HTML forms with traditional
 *      `<input id="firstName">` IDs — NOT React. Plain JS setVal + dispatch
 *      'change' event SHOULD work for most fields (unlike Ashby).
 *   2. Refresh template (newer tenants — Disney, Bayer) is a SPA-ish overlay
 *      on top of the classic form. Selectors may differ. Treat v0.8 as
 *      classic-template only.
 *   3. iCIMS REQUIRES account creation before applying. Apply flow is:
 *        a. Click "Apply for this job online" on the job detail page
 *        b. Login / sign-up wall (`/login` or `/apply`)
 *        c. Resume upload (file input, NOT pre-uploaded picker like Handshake)
 *        d. Auto-parsed fields → standard form review/edit
 *        e. Custom employer questions (multi-step possible)
 *        f. EEOC + voluntary disclosures
 *        g. Review + Submit
 *   4. File upload IS supported on iCIMS — `<input type=file id="resume">` or
 *      similar. CDP `Page.setDownloadBehavior` not needed; use CDP-level
 *      `setFileInput` via shared/cdp.mjs (TODO: add helper if not present).
 *   5. Some iCIMS tenants embed Workday-style multi-step wizards. If you see
 *      "Step 1 of 5" progress indicator, treat each step as its own page —
 *      call findEmptyRequired() + screenshot between steps.
 *
 * Standard iCIMS field IDs (per Career Connector docs):
 *   - #firstName / #lastName / #email / #phone / #address1 / #city / #state / #zip
 *   - #resume (file input) / #coverLetter (file or textarea, varies)
 *   - #linkedInProfile / #website
 *   - #howDidYouHear (select or text)
 *
 * v0.8 react-mousedown pattern carryover: classic iCIMS uses NATIVE <select>
 * (not react-select), so .change event works. BUT — Refresh template + some
 * recent tenants embed react-select v5 widgets for "Country" / "How did you
 * hear" — fall back to mousedown trio if `.select__control` is present.
 *
 * Never auto-submits. `findSubmit()` returns the button — caller decides.
 */

(function () {
  const ICIMS = {};

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

  // ---------- login / account-required detection ----------

  /**
   * ICIMS.detectLoginRequired()
   *
   * iCIMS apply flow ALWAYS requires an account. Detect:
   *   - URL contains `/login` or `/account` or `/connect`
   *   - "Sign in" / "Create account" CTA visible
   *   - "Returning candidate?" prompt (classic iCIMS sign-in dialog)
   *
   * TODO-verify with real tenant samples.
   */
  ICIMS.detectLoginRequired = function () {
    const path = location.pathname || '';
    const href = location.href || '';
    if (/\/login|\/account|\/connect|\/sign[_-]?in/i.test(path)) {
      return { loginRequired: true, signal: 'url-path', path };
    }
    if (/\/jobs\/\d+\/login/i.test(href)) {
      return { loginRequired: true, signal: 'job-login-redirect' };
    }
    const bodyText = (document.body ? document.body.innerText || '' : '').slice(0, 3000);
    if (/returning\s+candidate/i.test(bodyText) && /sign\s+in/i.test(bodyText)) {
      return { loginRequired: true, signal: 'returning-candidate-prompt' };
    }
    if (/create\s+(an\s+)?account/i.test(bodyText) && !/already\s+have/i.test(bodyText)) {
      return { loginRequired: true, signal: 'create-account-prompt' };
    }
    // If a "First Name" / "Last Name" field is rendered, we're past the gate.
    if ($('#firstName') || $('#lastName')) {
      return { loginRequired: false, signal: 'form-visible' };
    }
    return { loginRequired: null, signal: 'unknown' };
  };

  /**
   * ICIMS.detectStep()
   *
   * Many iCIMS tenants have multi-step wizards. Detect current step from
   * progress indicator (e.g. "Step 2 of 5" / breadcrumb / progress bar).
   *
   * TODO-verify selectors — classic iCIMS uses `.iCIMS_ProgressBar`, Refresh
   * uses `[role=progressbar]` / `.progress-steps`.
   *
   * Returns: { step: number|null, total: number|null, name: string|null }
   */
  ICIMS.detectStep = function () {
    const bodyText = (document.body ? document.body.innerText || '' : '').slice(0, 5000);
    const m = bodyText.match(/step\s+(\d+)\s+of\s+(\d+)/i);
    if (m) {
      return { step: parseInt(m[1], 10), total: parseInt(m[2], 10), name: null };
    }
    // Section heading fallback — iCIMS sections include "Personal Information",
    // "Education", "Work History", "Questions", "EEO", "Review".
    const headings = ['Personal Information', 'Resume', 'Education', 'Work History', 'Questions', 'EEO', 'Review'];
    for (const h of headings) {
      if (new RegExp('\\b' + h + '\\b', 'i').test(bodyText.slice(0, 1500))) {
        return { step: null, total: null, name: h };
      }
    }
    return { step: null, total: null, name: null };
  };

  // ---------- text fields ----------

  /**
   * ICIMS.setVal(fieldId, value)
   *
   * Classic iCIMS server-rendered forms accept JS-dispatched 'change' events
   * since they're plain `<input>` not React-controlled. Refresh template may
   * be react-controlled (use CDP typetext as fallback).
   *
   * Returns: { ok, selector, note }
   */
  ICIMS.setVal = function (fieldId, value) {
    const el = $('#' + CSS.escape(fieldId));
    if (!el) return { ok: false, selector: '#' + fieldId, note: 'not_found' };
    try {
      el.focus();
      const setter = getNativeSetter(el);
      setter.call(el, value == null ? '' : String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return {
        ok: el.value === String(value ?? ''),
        selector: '#' + fieldId,
        note: el.value === String(value ?? '') ? 'js_ok' : 'use_typetext',
      };
    } catch (e) {
      return { ok: false, selector: '#' + fieldId, note: 'error:' + e.message };
    }
  };

  // ---------- native select ----------

  /**
   * ICIMS.pickNativeSelect(fieldId, optionText)
   *
   * Classic iCIMS uses native <select>. Match option by visible text (case-
   * insensitive). For Refresh-template react-select, fall back to pickSelect().
   */
  ICIMS.pickNativeSelect = function (fieldId, optionText) {
    const sel = $('#' + CSS.escape(fieldId));
    if (!sel || sel.tagName !== 'SELECT') {
      return { ok: false, note: 'not_a_native_select', fallback: 'try_pickSelect' };
    }
    const wanted = String(optionText).trim().toLowerCase();
    const opts = Array.from(sel.options || []);
    const match = opts.find((o) => (o.text || '').trim().toLowerCase() === wanted)
      || opts.find((o) => (o.text || '').trim().toLowerCase().includes(wanted));
    if (!match) return { ok: false, note: 'option_not_found:' + optionText };
    sel.value = match.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: sel.value === match.value, selected: match.text };
  };

  // ---------- react-select fallback (Refresh template) ----------

  /**
   * ICIMS.pickSelect(fieldId, optionText)
   *
   * For Refresh-template tenants that swap native <select> for react-select v5.
   * Same mousedown trio as Greenhouse/Ashby/Handshake.
   */
  ICIMS.pickSelect = async function (fieldId, optionText) {
    const input = $('#' + CSS.escape(fieldId));
    if (!input) return { ok: false, note: 'field_not_found' };
    const control = input.closest('.select__control') || input.closest('[class*="select"][class*="control"]');
    if (!control) return { ok: false, note: 'no_select_control', fallback: 'try_pickNativeSelect' };

    try {
      control.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch (_) {
      control.scrollIntoView({ block: 'center' });
    }
    await sleep(200);
    dispatchMouseSeries(control);
    await sleep(250);

    const wanted = String(optionText).trim().toLowerCase();
    let target = null;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !target) {
      const opts = document.querySelectorAll('.select__option, [class*="select"][class*="option"]');
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
    return { ok: true, picked: target.innerText.trim() };
  };

  // ---------- file upload (resume) ----------

  /**
   * ICIMS.findResumeInput()
   *
   * Returns selector for the resume file input. Caller drives upload via
   * CDP `DOM.setFileInputFiles` (see shared/cdp.mjs).
   *
   * Classic IDs: #resume / #resumeUpload / input[name="resume"]
   * TODO-verify on Refresh-template tenants — may use shadowDOM uploader.
   */
  ICIMS.findResumeInput = function () {
    const candidates = [
      '#resume',
      '#resumeUpload',
      '#resume-file',
      'input[type=file][name="resume" i]',
      'input[type=file][id*="resume" i]',
      'input[type=file][aria-label*="resume" i]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return { ok: true, selector: sel };
    }
    // Last resort — first file input on page
    const anyFile = document.querySelector('input[type=file]');
    if (anyFile) {
      return { ok: true, selector: 'input[type=file]', note: 'fallback_first_file_input' };
    }
    return { ok: false, note: 'resume_input_not_found' };
  };

  // ---------- normalize / inventory ----------

  /**
   * ICIMS.normalizeProfile(raw)
   *
   * Maps the local profile.json shape to iCIMS standard fields.
   */
  ICIMS.normalizeProfile = function (raw) {
    if (!raw) return null;
    if (!raw.personal && (raw.firstName || raw.email)) {
      return Object.assign({ custom_answers: {}, picker_answers: {} }, raw, { _raw: raw });
    }
    const personal = raw.personal || {};
    return {
      firstName: personal.first_name,
      lastName: personal.last_name,
      email: personal.email,
      phone: personal.phone,
      address1: personal.address1,
      city: personal.city,
      state: personal.state,
      zip: personal.zip,
      linkedInProfile: personal.linkedin,
      website: personal.portfolio,
      resume_path: raw.resume_path,
      custom_answers: raw.custom_answers || {},
      picker_answers: raw.picker_answers || {},
      standard_answers: raw.standard_answers || {},
      _raw: raw,
    };
  };

  /**
   * ICIMS.findEmptyRequired()
   *
   * Standard iCIMS required-field markers (best-guess):
   *   - `required` HTML attribute
   *   - `aria-required="true"`
   *   - Label ending in `*` (classic template visual marker)
   *
   * Returns: Array<{ id, label, type, required, currentValue, options }>
   */
  ICIMS.findEmptyRequired = function () {
    const result = [];
    const seen = new Set();
    const push = (entry) => {
      if (!entry || seen.has(entry.id)) return;
      if (entry.id) seen.add(entry.id);
      result.push(entry);
    };

    const required = document.querySelectorAll(
      '[aria-required="true"], input[required], select[required], textarea[required]'
    );
    for (const el of required) {
      if (!el.id) continue;
      if (!el.offsetParent && !el.closest('.select__control')) continue;
      const labelEl = document.querySelector('label[for="' + el.id + '"]');
      const label = labelEl ? labelEl.innerText : '';
      if (el.tagName === 'SELECT') {
        if (!el.value || el.selectedIndex === 0) {
          push({
            id: el.id,
            label: label.replace(/\s*\*\s*$/, '').trim() || '(no label)',
            type: 'native-select',
            required: true,
            currentValue: el.value || '',
            options: Array.from(el.options || []).map((o) => o.text),
          });
        }
      } else if (el.type === 'file') {
        if (!el.files || el.files.length === 0) {
          push({
            id: el.id,
            label: label.replace(/\s*\*\s*$/, '').trim() || '(no label)',
            type: 'file',
            required: true,
            currentValue: '',
            options: null,
            note: 'caller: use CDP setFileInputFiles',
          });
        }
      } else if (el.closest('.select__control')) {
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

    // Resume file check (always required by iCIMS)
    const resume = ICIMS.findResumeInput();
    if (resume.ok) {
      const fileEl = document.querySelector(resume.selector);
      if (fileEl && (!fileEl.files || fileEl.files.length === 0)) {
        push({
          id: fileEl.id || 'resume-file',
          label: 'Resume',
          type: 'file',
          required: true,
          currentValue: '',
          options: null,
          note: 'caller: use CDP setFileInputFiles',
        });
      }
    }

    return result;
  };

  // ---------- fillForm entry ----------

  /**
   * ICIMS.fillForm(profile)
   *
   * Walks standard iCIMS fields + returns plan array.
   * Each plan item: { action, selector|fieldId, value, label, note }
   * action ∈ 'typetext' | 'native_select' | 'react_select' | 'file_upload' | 'manual'
   */
  ICIMS.fillForm = function (profile) {
    profile = profile || {};
    if (profile.personal && !profile.firstName) {
      profile = ICIMS.normalizeProfile(profile);
    }
    const plan = [];

    // Standard fields (use typetext for reliability — works whether classic or Refresh)
    const standardFields = [
      ['firstName', profile.firstName],
      ['lastName', profile.lastName],
      ['email', profile.email],
      ['phone', profile.phone],
      ['address1', profile.address1],
      ['city', profile.city],
      ['zip', profile.zip],
      ['linkedInProfile', profile.linkedInProfile],
      ['website', profile.website],
    ];
    for (const [fieldId, value] of standardFields) {
      if (value == null) continue;
      const el = $('#' + CSS.escape(fieldId));
      if (!el) continue;
      if (el.value) continue; // already filled
      plan.push({
        action: 'typetext',
        selector: '#' + fieldId,
        value: String(value),
        label: fieldId,
      });
    }

    // State (native select usually)
    if (profile.state) {
      const stateEl = $('#state');
      if (stateEl && stateEl.tagName === 'SELECT' && !stateEl.value) {
        plan.push({
          action: 'native_select',
          fieldId: 'state',
          value: profile.state,
          label: 'State',
        });
      }
    }

    // Resume upload
    if (profile.resume_path) {
      const resumeFind = ICIMS.findResumeInput();
      if (resumeFind.ok) {
        const fileEl = document.querySelector(resumeFind.selector);
        if (fileEl && (!fileEl.files || fileEl.files.length === 0)) {
          plan.push({
            action: 'file_upload',
            selector: resumeFind.selector,
            value: profile.resume_path,
            label: 'Resume',
            note: 'use CDP setFileInputFiles',
          });
        }
      }
    }

    // Custom employer questions — likely textarea / native-select. TODO-verify
    // structure on first live verification. For now flag any empty required field we
    // didn't already plan as 'manual'.
    const planned = new Set(plan.map((p) => p.selector || ('#' + p.fieldId)));
    const empty = ICIMS.findEmptyRequired();
    for (const e of empty) {
      const sel = '#' + e.id;
      if (planned.has(sel)) continue;
      plan.push({
        action: 'manual',
        selector: sel,
        value: null,
        label: e.label,
        type: e.type,
        note: 'needs_manual_or_profile_extension',
      });
    }

    return {
      ok: true,
      plan,
      _disclaimer: 'v0.8 alpha — best-guess; verify each field on first live verification',
    };
  };

  // ---------- submit / success ----------

  /**
   * ICIMS.findSubmit()
   *
   * Classic iCIMS submit button: `<input type=submit value="Submit Application">`
   * or `<button>Submit</button>`. Multi-step wizards have "Next" / "Continue"
   * buttons — caller should distinguish (final step submit vs intermediate Next).
   *
   * TODO-verify final-step button text + selector.
   */
  ICIMS.findSubmit = function () {
    const candidates = [
      'input[type=submit][value*="Submit Application" i]', // TODO-verify
      'button[type=submit][data-test*="submit" i]',
      'button[name="submitButton"]',
      'input[type=submit]',
      'button[type=submit]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        return {
          ok: true,
          selector: sel,
          text: (el.value || el.innerText || '').trim(),
        };
      }
    }
    // Last resort — any button with explicit Submit/Apply text
    const buttons = document.querySelectorAll('button, input[type=submit]');
    for (const b of buttons) {
      const txt = (b.value || b.innerText || '').trim().toLowerCase();
      if ((txt === 'submit application' || txt === 'submit' || txt === 'apply now') && b.offsetParent !== null) {
        return { ok: true, selector: b.tagName.toLowerCase(), text: txt };
      }
    }
    return { ok: false, note: 'submit_button_not_found' };
  };

  /**
   * ICIMS.findNextStep()
   *
   * Multi-step iCIMS shows "Next" / "Continue" between sections. Caller uses
   * this in the wizard loop (call between findEmptyRequired() passes).
   */
  ICIMS.findNextStep = function () {
    const buttons = document.querySelectorAll('button, input[type=submit], input[type=button]');
    for (const b of buttons) {
      const txt = (b.value || b.innerText || '').trim().toLowerCase();
      if ((txt === 'next' || txt === 'continue' || txt === 'save and continue') && b.offsetParent !== null) {
        return { ok: true, selector: b.tagName.toLowerCase(), text: txt };
      }
    }
    return { ok: false };
  };

  /**
   * ICIMS.checkSuccess()
   *
   * iCIMS success page typically shows "Thank you" / "Application Received" /
   * "Your application has been submitted" + a confirmation reference number.
   *
   * TODO-verify exact copy on real submission.
   */
  ICIMS.checkSuccess = function () {
    const txt = document.body ? document.body.innerText || '' : '';
    const patterns = [
      /application\s+(has\s+been\s+)?(submitted|received|sent)/i,
      /thank\s+you\s+for\s+(applying|your\s+application|your\s+interest)/i,
      /your\s+application\s+(is\s+complete|was\s+successful)/i,
      /confirmation\s+(number|code)\s*[:#]/i,
    ];
    for (const p of patterns) {
      if (p.test(txt)) {
        return { ok: true, snippet: txt.slice(0, 400), matched: String(p) };
      }
    }
    return { ok: false, snippet: txt.slice(0, 400) };
  };

  // expose
  window.ICIMS = ICIMS;
  globalThis.ICIMS = ICIMS;
  return 'ICIMS ready (v0.8 alpha best-guess): ' + Object.keys(ICIMS).join(',');
})();
