/**
 * jobvite_helpers.js — JobVite ATS form helpers (v0.8 ALPHA, best-guess scaffold)
 *
 * ⚠️  v0.8 ALPHA DISCLAIMER — NOT DOGFOOD-VERIFIED.
 *
 * Lee has NOT yet successfully run a real JobVite submission with these helpers.
 * Selectors / field semantics below are inferred from:
 *   - JobVite's documented `.jv-*` class naming conventions (career portal templates)
 *   - Sampling of live apply pages on `jobs.jobvite.com/{tenant}/job/{id}`
 *   - Pattern transfer from Ashby (react-hook-form) and Greenhouse helpers
 *     — JobVite is a React SPA + may also use react-hook-form on newer tenants
 *
 * Every selector marked `// TODO-verify` MUST be confirmed against the live
 * DOM on first real submission and adjusted in place.
 *
 * Architectural assumptions (verify on first dogfood):
 *   1. JobVite apply page is a React SPA (`.jv-careersite` mount point).
 *      Newer tenants likely use react-hook-form — treat text fields as
 *      `isTrusted`-required (prefer CDP `Input.insertText` via cdp.mjs typetext).
 *      Older tenants used plain Angular — JS setVal + change event works.
 *   2. Apply mode is INLINE on the detail page (no separate modal). Form
 *      appears under "Application" / "Apply" section. NO account required for
 *      guest apply on most tenants (different from iCIMS).
 *   3. Resume upload is a real `<input type=file>` — use CDP setFileInputFiles.
 *      May ALSO offer LinkedIn / Indeed import as alternatives (TODO-verify
 *      buttons + skip flow).
 *   4. Single-page form by default (no wizard), but custom employer questions
 *      can extend it significantly. EEOC self-disclosure also appears as inline
 *      questions, NOT a separate page (unlike iCIMS).
 *   5. URL form: `https://jobs.jobvite.com/{tenant}/job/{jvId}` (single page,
 *      anchor #apply-form scrolls to form section).
 *
 * Standard JobVite field IDs (per JobVite Career Portal docs — best-guess):
 *   - #jv-field-first-name (or #firstName on legacy)
 *   - #jv-field-last-name
 *   - #jv-field-email
 *   - #jv-field-phone
 *   - #jv-field-resume (file input)
 *   - #jv-field-cover-letter
 *   - #jv-field-linkedin
 *   - #jv-field-website
 * NOTE: some tenants strip the `jv-field-` prefix → fall back to bare
 * `#firstName` etc.
 *
 * Never auto-submits. `findSubmit()` returns the button — caller decides.
 */

(function () {
  const JobVite = {};

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function $(sel) {
    return document.querySelector(sel);
  }

  function $1(...selectors) {
    // Return first element matching any selector
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
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

  // ---------- detection ----------

  /**
   * JobVite.detectApplyForm()
   *
   * JobVite usually inlines apply form on the detail page, but the form
   * may be collapsed behind an "Apply Now" button. Returns whether form
   * is rendered + visible.
   */
  JobVite.detectApplyForm = function () {
    const formSelectors = [
      '#jv-apply-form', // TODO-verify modern
      '.jv-apply-form',
      'form[id*="apply" i]',
      'form[name*="apply" i]',
    ];
    for (const sel of formSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        return { ok: true, selector: sel, visible: true };
      }
    }
    // Check if there's an "Apply Now" trigger button
    const triggers = Array.from(document.querySelectorAll('button, a')).filter((el) =>
      /^(apply\s+now|apply\s+for\s+this|apply)$/i.test((el.innerText || '').trim())
    );
    if (triggers.length) {
      return {
        ok: false,
        visible: false,
        note: 'form_collapsed_click_apply_button_first',
        trigger_text: triggers[0].innerText.trim(),
      };
    }
    return { ok: false, visible: false, note: 'apply_form_not_found' };
  };

  /**
   * JobVite.detectExternalRedirect()
   *
   * Some JobVite jobs link out to an external ATS (rare — mostly company-
   * specific career sites that aren't really JobVite). If hostname is not
   * `jobs.jobvite.com`, signal a redirect.
   */
  JobVite.detectExternalRedirect = function () {
    const host = location.hostname || '';
    if (/jobvite\.com$/i.test(host)) {
      return { redirected: false, target_url: location.href, target_ats: null };
    }
    return {
      redirected: true,
      target_url: location.href,
      target_ats: 'unknown',
      note: 'caller_should_route_via_orchestrator',
    };
  };

  // ---------- text fields ----------

  /**
   * JobVite.setVal(fieldId, value)
   *
   * Best-effort JS fallback for text/email/phone inputs and textareas.
   * For React tenants (most modern JobVite), prefer `cdp.mjs typetext`.
   *
   * Tries fieldId first; falls back to `jv-field-{fieldId}` prefix variant.
   */
  JobVite.setVal = function (fieldId, value) {
    const el =
      $('#' + CSS.escape(fieldId)) ||
      $('#' + CSS.escape('jv-field-' + fieldId));
    if (!el) {
      return { ok: false, selector: '#' + fieldId, note: 'not_found' };
    }
    const finalSel = '#' + el.id;
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
        selector: finalSel,
        note: 'use_typetext', // caller should prefer CDP typetext
      };
    } catch (e) {
      return { ok: false, selector: finalSel, note: 'error:' + e.message };
    }
  };

  // ---------- select (mixed native + react-select) ----------

  /**
   * JobVite.pickSelect(fieldId, optionText)
   *
   * JobVite has both native <select> (legacy) and react-select v5 (newer
   * tenants) — try react first, fall back to native.
   */
  JobVite.pickSelect = async function (fieldId, optionText) {
    const variants = [
      '#' + CSS.escape(fieldId),
      '#' + CSS.escape('jv-field-' + fieldId),
    ];
    let input = null;
    for (const v of variants) {
      input = document.querySelector(v);
      if (input) break;
    }
    if (!input) return { ok: false, note: 'field_not_found' };

    // Try react-select v5 first
    const control = input.closest('.select__control') ||
      input.closest('[class*="select"][class*="control"]');
    if (control) {
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
        return { ok: false, note: 'option_not_found:' + optionText, strategy: 'react-select' };
      }
      dispatchMouseSeries(target);
      await sleep(150);
      return { ok: true, picked: target.innerText.trim(), strategy: 'react-select' };
    }

    // Native <select>
    if (input.tagName === 'SELECT') {
      const wanted = String(optionText).trim().toLowerCase();
      const opts = Array.from(input.options || []);
      const match = opts.find((o) => (o.text || '').trim().toLowerCase() === wanted)
        || opts.find((o) => (o.text || '').trim().toLowerCase().includes(wanted));
      if (!match) return { ok: false, note: 'option_not_found:' + optionText, strategy: 'native' };
      input.value = match.value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: input.value === match.value, picked: match.text, strategy: 'native' };
    }

    return { ok: false, note: 'unknown_select_widget' };
  };

  // ---------- yes/no & radio ----------

  /**
   * JobVite.clickRadio(name, optionText)
   *
   * Many EEOC questions render as radio groups. Find input[name=name] with
   * label text matching optionText (case-insensitive contains).
   */
  JobVite.clickRadio = function (name, optionText) {
    const radios = document.querySelectorAll(`input[type=radio][name="${name}"]`);
    if (!radios.length) return { ok: false, note: 'no_radios_for_name' };
    const wanted = String(optionText).trim().toLowerCase();
    for (const r of radios) {
      const lab = document.querySelector('label[for="' + r.id + '"]');
      const labText = lab ? (lab.innerText || '').trim().toLowerCase() : '';
      if (labText.includes(wanted)) {
        r.click();
        return { ok: true, picked: labText, value: r.value };
      }
    }
    return { ok: false, note: 'option_not_found:' + optionText };
  };

  // ---------- file upload (resume) ----------

  /**
   * JobVite.findResumeInput()
   *
   * Returns selector for resume file input. Caller drives upload via
   * CDP `DOM.setFileInputFiles`.
   *
   * Classic: #jv-field-resume / #resume / input[name="resume"]
   * TODO-verify on tenants that use a third-party upload widget (Dropbox /
   * Google Drive integration).
   */
  JobVite.findResumeInput = function () {
    const candidates = [
      '#jv-field-resume',
      '#resume',
      '#resumeFile',
      'input[type=file][name="resume" i]',
      'input[type=file][id*="resume" i]',
      'input[type=file][aria-label*="resume" i]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return { ok: true, selector: sel };
    }
    const anyFile = document.querySelector('input[type=file]');
    if (anyFile) {
      return { ok: true, selector: 'input[type=file]', note: 'fallback_first_file_input' };
    }
    return { ok: false, note: 'resume_input_not_found' };
  };

  // ---------- normalize / inventory ----------

  /**
   * JobVite.normalizeProfile(raw)
   *
   * Maps Lee's profile.json shape to JobVite standard field IDs (sans
   * `jv-field-` prefix — setVal tries both variants).
   */
  JobVite.normalizeProfile = function (raw) {
    if (!raw) return null;
    if (!raw.personal && (raw['first-name'] || raw.email)) {
      return Object.assign({ custom_answers: {}, picker_answers: {} }, raw, { _raw: raw });
    }
    const personal = raw.personal || {};
    return {
      'first-name': personal.first_name,
      'last-name': personal.last_name,
      email: personal.email,
      phone: personal.phone,
      linkedin: personal.linkedin,
      website: personal.portfolio,
      resume_path: raw.resume_path,
      custom_answers: raw.custom_answers || {},
      picker_answers: raw.picker_answers || {},
      standard_answers: raw.standard_answers || {},
      _raw: raw,
    };
  };

  /**
   * JobVite.findEmptyRequired()
   *
   * Required field markers (best-guess):
   *   - `required` attribute
   *   - `aria-required="true"`
   *   - Label ending in `*` or with `.jv-required` sibling
   *
   * Returns: Array<{ id, label, type, required, currentValue, options }>
   */
  JobVite.findEmptyRequired = function () {
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
      } else if (el.type === 'radio') {
        // Group required — check if any radio in same name group is checked
        const name = el.name;
        if (!name) continue;
        const anyChecked = document.querySelector(`input[type=radio][name="${name}"]:checked`);
        if (!anyChecked) {
          push({
            id: el.id,
            label: label.replace(/\s*\*\s*$/, '').trim() || '(no label)',
            type: 'radio-group',
            required: true,
            currentValue: '',
            options: Array.from(document.querySelectorAll(`input[type=radio][name="${name}"]`))
              .map((r) => {
                const lab = document.querySelector('label[for="' + r.id + '"]');
                return lab ? (lab.innerText || '').trim() : r.value;
              }),
            group_name: name,
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

    // Resume file check
    const resume = JobVite.findResumeInput();
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
   * JobVite.fillForm(profile)
   *
   * Walks standard JobVite fields + returns plan array.
   * Each plan item: { action, selector|fieldId, value, label, note }
   * action ∈ 'typetext' | 'select' | 'radio' | 'file_upload' | 'manual'
   */
  JobVite.fillForm = function (profile) {
    profile = profile || {};
    if (profile.personal && !profile['first-name']) {
      profile = JobVite.normalizeProfile(profile);
    }
    const plan = [];

    // Try both prefixed and bare variants for each standard field
    const standardFields = [
      ['first-name', profile['first-name']],
      ['last-name', profile['last-name']],
      ['email', profile.email],
      ['phone', profile.phone],
      ['linkedin', profile.linkedin],
      ['website', profile.website],
    ];
    for (const [fieldKey, value] of standardFields) {
      if (value == null) continue;
      const el = $1('#' + CSS.escape(fieldKey), '#' + CSS.escape('jv-field-' + fieldKey));
      if (!el) continue;
      if (el.value) continue; // already filled
      plan.push({
        action: 'typetext',
        selector: '#' + el.id,
        value: String(value),
        label: fieldKey,
      });
    }

    // Resume upload
    if (profile.resume_path) {
      const resumeFind = JobVite.findResumeInput();
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

    // Flag remaining empty required fields as manual
    const planned = new Set(plan.map((p) => p.selector));
    const empty = JobVite.findEmptyRequired();
    for (const e of empty) {
      const sel = '#' + e.id;
      if (planned.has(sel)) continue;
      plan.push({
        action: 'manual',
        selector: sel,
        value: null,
        label: e.label,
        type: e.type,
        options: e.options,
        group_name: e.group_name,
        note: 'needs_manual_or_profile_extension',
      });
    }

    return {
      ok: true,
      plan,
      _disclaimer: 'v0.8 alpha — best-guess; verify each field on first dogfood',
    };
  };

  // ---------- submit / success ----------

  /**
   * JobVite.findSubmit()
   *
   * Standard JobVite submit selectors. TODO-verify exact button text.
   */
  JobVite.findSubmit = function () {
    const candidates = [
      'button#jv-apply-submit', // TODO-verify
      'button[data-test*="submit" i]',
      '.jv-button-primary[type=submit]',
      'button[type=submit]',
      'input[type=submit]',
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
    // Last resort — any button with "Submit" / "Submit Application" / "Apply"
    const buttons = document.querySelectorAll('button, input[type=submit]');
    for (const b of buttons) {
      const txt = (b.value || b.innerText || '').trim().toLowerCase();
      if (
        (txt === 'submit' || txt === 'submit application' || txt === 'apply') &&
        b.offsetParent !== null
      ) {
        return { ok: true, selector: b.tagName.toLowerCase(), text: txt };
      }
    }
    return { ok: false, note: 'submit_button_not_found' };
  };

  /**
   * JobVite.checkSuccess()
   *
   * JobVite success page typically shows in-page confirmation banner with
   * "Thank you" / "Application Submitted" text. May also redirect to
   * `/job/{id}/applied` or similar.
   *
   * TODO-verify exact copy on real submission.
   */
  JobVite.checkSuccess = function () {
    const url = location.href || '';
    if (/\/applied|\/thank|\/confirmation/i.test(url)) {
      return { ok: true, signal: 'url-redirect', url };
    }
    const txt = document.body ? document.body.innerText || '' : '';
    const patterns = [
      /thank\s+you\s+for\s+(applying|your\s+application|your\s+interest)/i,
      /application\s+(has\s+been\s+)?(submitted|received|sent)/i,
      /we'?ve\s+received\s+your\s+application/i,
      /your\s+application\s+(is\s+complete|was\s+successful)/i,
    ];
    for (const p of patterns) {
      if (p.test(txt)) {
        return { ok: true, snippet: txt.slice(0, 400), matched: String(p) };
      }
    }
    return { ok: false, snippet: txt.slice(0, 400) };
  };

  // expose
  window.JobVite = JobVite;
  globalThis.JobVite = JobVite;
  return 'JobVite ready (v0.8 alpha best-guess): ' + Object.keys(JobVite).join(',');
})();
