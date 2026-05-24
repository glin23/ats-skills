/**
 * smartrecruiters_helpers.js — SmartRecruiters ATS form helpers (v0.8 BETA)
 *
 * ⚠️  v0.8 beta — needs dogfood ⚠️
 * SmartRecruiters is being migrated to SAP SuccessFactors. Selectors and form
 * mechanics described here are best-guess based on the current jobs.smartrecruiters.com
 * apply flow. They have NOT been verified against a live submit. Expect:
 *   - selectors to shift as SAP rolls out the unified careers experience
 *   - some orgs to already be redirected to SF careers (`career.sap.com/...`)
 *   - first ≤5 submissions/day to surface concrete failures
 *
 * Injected into the page via `node shared/cdp.mjs eval $TAB "$(cat smartrecruiters_helpers.js)"`.
 * After eval, the global `SmartRecruiters` object exposes the helpers below.
 *
 * Style mirrors ashby_helpers.js — same return shapes, same typetext-first
 * philosophy. SmartRecruiters appears to use a React form too, so text fields
 * should go through `node shared/cdp.mjs typetext` for real keyboard events
 * (isTrusted=true) instead of JS setVal.
 *
 * Reference: ashby_helpers.js (proven Ashby skill, same react-hook-form lineage)
 */
(function () {
  const SR = {};

  // ---------- internals ----------

  function $(sel) {
    return document.querySelector(sel);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function getNativeSetter(el) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    return Object.getOwnPropertyDescriptor(proto, 'value').set;
  }

  function labelTextFor(el) {
    if (!el) return '';
    if (el.id) {
      const lbl = document.querySelector('label[for="' + el.id + '"]');
      if (lbl) return lbl.innerText.trim();
    }
    let cur = el.parentElement;
    for (let i = 0; i < 6 && cur; i++) {
      const aria = cur.getAttribute && cur.getAttribute('aria-label');
      if (aria) return aria.trim();
      const legend = cur.querySelector && cur.querySelector('legend');
      if (legend) return legend.innerText.trim();
      const lbl = cur.querySelector && cur.querySelector('label');
      if (lbl) return lbl.innerText.trim();
      cur = cur.parentElement;
    }
    return '';
  }

  // ---------- profile normalization ----------

  /**
   * SR.normalizeProfile(raw)
   *
   * Accept the nested `profile.template.json` shape OR a flat profile.
   * SmartRecruiters uses split `firstName` / `lastName` fields (unlike Ashby's
   * combined _systemfield_name), so we expose both `first_name` / `last_name`
   * and a `full_name` fallback.
   */
  SR.normalizeProfile = function (raw) {
    if (!raw) return null;
    // Flat profile passthrough
    if (!raw.personal && (raw.first_name || raw.email)) {
      return Object.assign(
        {
          custom_answers: {},
          picker_answers: {},
          yesno_answers: {},
          standard_answers: {},
        },
        raw,
        { _raw: raw },
      );
    }
    const personal = raw.personal || {};
    const firstName =
      personal.first_name ||
      (personal.full_name ? personal.full_name.split(' ')[0] : '') ||
      '';
    const lastName =
      personal.last_name ||
      (personal.full_name
        ? personal.full_name.split(' ').slice(1).join(' ')
        : '') ||
      '';
    const fullName =
      personal.full_name || [firstName, lastName].filter(Boolean).join(' ');
    return {
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      email: personal.email,
      phone: personal.phone,
      linkedin: personal.linkedin,
      github: personal.github,
      website: personal.portfolio,
      resume_path: raw.resume_path,
      custom_answers: {},
      picker_answers: {},
      yesno_answers: {},
      standard_answers: raw.standard_answers || {},
      _raw: raw,
    };
  };

  // ---------- text fields ----------

  /**
   * SR.setVal(selector, value)
   *
   * Best-effort JS fallback. PREFER `node shared/cdp.mjs typetext` for any
   * required text field — same react-hook-form risk as Ashby (isTrusted check).
   */
  SR.setVal = function (selector, value) {
    const el = $(selector);
    if (!el) return { ok: false, selector, note: 'not_found' };
    try {
      el.focus();
      const setter = getNativeSetter(el);
      setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(el, value);
      el.dispatchEvent(
        new InputEvent('input', {
          inputType: 'insertText',
          data: value,
          bubbles: true,
        }),
      );
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return {
        ok: el.value === value,
        selector,
        note: 'use_typetext',
      };
    } catch (e) {
      return { ok: false, selector, note: 'error:' + e.message };
    }
  };

  // ---------- native <select> picker ----------

  /**
   * SR.pickSelect(selector, optionText)
   *
   * SmartRecruiters appears to use native <select> for most dropdowns (Country,
   * State, Employment type). For native <select>, setter + change event works.
   * If a v0.8 form uses a react-select instead, this will fail and we'll need
   * to add a mousedown trio variant (see ashby_helpers.pickSelect).
   */
  SR.pickSelect = function (selector, optionText) {
    const el = $(selector);
    if (!el) return { ok: false, note: 'field_not_found' };
    if (el.tagName !== 'SELECT') {
      return {
        ok: false,
        note: 'not_native_select — may need react-select handler',
        tagName: el.tagName,
      };
    }
    const wanted = String(optionText).trim().toLowerCase();
    let matched = null;
    for (const opt of el.options) {
      const t = (opt.text || '').trim().toLowerCase();
      const v = (opt.value || '').trim().toLowerCase();
      if (t === wanted || v === wanted) {
        matched = opt;
        break;
      }
    }
    if (!matched) {
      // substring fallback
      for (const opt of el.options) {
        const t = (opt.text || '').trim().toLowerCase();
        if (t.includes(wanted)) {
          matched = opt;
          break;
        }
      }
    }
    if (!matched) return { ok: false, note: 'option_not_found:' + optionText };

    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value',
    ).set;
    setter.call(el, matched.value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: el.value === matched.value, picked: matched.text };
  };

  // ---------- file upload ----------

  /**
   * SR.uploadResume()
   *
   * STUB — actual upload via CDP `DOM.setFileInputFiles`. Tries a few common
   * SmartRecruiters resume input selectors and returns the one that exists.
   */
  SR.uploadResume = function () {
    const candidates = [
      'input[type=file][name*="resume" i]',
      'input[type=file][name*="cv" i]',
      'input[type=file][id*="resume" i]',
      'input[type=file][id*="cv" i]',
      'input[type=file]', // fallback — first file input on page
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) {
        return {
          ok: true,
          selector: sel,
          note: 'use cdp.mjs upload — DOM.setFileInputFiles, not JS',
        };
      }
    }
    return { ok: false, note: 'no_file_input_found' };
  };

  // ---------- inventory: required + empty ----------

  /**
   * SR.findEmptyRequired()
   *
   * Walk visible required fields and return {id, selector, label, type, currentValue}
   * for each that is still empty. Best-effort; expect to refine after dogfood.
   *
   * Heuristics (in priority order):
   *   1. HTML `required` attribute
   *   2. `aria-required="true"`
   *   3. label text contains "*"
   */
  SR.findEmptyRequired = function () {
    const result = [];
    const seen = new Set();

    const push = (entry) => {
      const key = entry.selector || entry.id;
      if (!key || seen.has(key)) return;
      seen.add(key);
      result.push(entry);
    };

    const isVisible = (el) => {
      if (!el) return false;
      if (el.type === 'file') return true; // file inputs often visually hidden
      return el.offsetParent !== null;
    };

    const selectorFor = (el) => {
      if (el.id) return '#' + CSS.escape(el.id);
      if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
      return null;
    };

    // 1) Required text inputs / textareas / selects
    const fields = document.querySelectorAll(
      'input[required], textarea[required], select[required], ' +
        '[aria-required="true"]',
    );
    for (const el of fields) {
      if (!isVisible(el)) continue;
      const sel = selectorFor(el);
      if (!sel) continue;
      const label = labelTextFor(el) || el.placeholder || sel;
      const type =
        el.tagName === 'SELECT'
          ? 'select'
          : el.tagName === 'TEXTAREA'
            ? 'textarea'
            : el.type || 'text';
      const currentValue =
        type === 'file'
          ? el.files && el.files.length
            ? '[uploaded]'
            : ''
          : el.value || '';
      if (currentValue) continue;
      push({
        id: el.id || null,
        selector: sel,
        label: label.replace(/\s*\*\s*$/, '').trim(),
        type,
        required: true,
        currentValue: '',
        options:
          el.tagName === 'SELECT'
            ? Array.from(el.options)
                .map((o) => o.text)
                .filter(Boolean)
            : null,
      });
    }

    // 2) Labels with asterisk that point to non-required-attr fields
    const labels = document.querySelectorAll('label');
    for (const lbl of labels) {
      const txt = (lbl.innerText || '').trim();
      if (!/\*/.test(txt)) continue;
      const forId = lbl.getAttribute('for');
      if (!forId) continue;
      const el = document.getElementById(forId);
      if (!el || !isVisible(el)) continue;
      const sel = '#' + CSS.escape(forId);
      if (seen.has(sel)) continue;
      const type =
        el.tagName === 'SELECT'
          ? 'select'
          : el.tagName === 'TEXTAREA'
            ? 'textarea'
            : el.type || 'text';
      const currentValue =
        type === 'file'
          ? el.files && el.files.length
            ? '[uploaded]'
            : ''
          : el.value || '';
      if (currentValue) continue;
      push({
        id: forId,
        selector: sel,
        label: txt.replace(/\s*\*\s*$/, '').trim(),
        type,
        required: true,
        currentValue: '',
        options:
          el.tagName === 'SELECT'
            ? Array.from(el.options)
                .map((o) => o.text)
                .filter(Boolean)
            : null,
      });
    }

    return result;
  };

  // ---------- fillForm ----------

  /**
   * SR.fillForm(profile)
   *
   * Inventory + plan. Same plan-action contract as Ashby:
   *   - typetext (caller MUST use cdp.mjs typetext)
   *   - select   (native <select> via SR.pickSelect)
   *   - upload   (cdp.mjs upload)
   *
   * v0.8: no Yes/No or date widgets yet — add after first dogfood reveals what
   * the real form looks like.
   */
  SR.fillForm = function (profile) {
    profile = profile || {};
    if (profile.personal && !profile.first_name && !profile.full_name) {
      profile = SR.normalizeProfile(profile);
    }
    const plan = [];

    // SmartRecruiters typical field id/name patterns (best guess pre-dogfood):
    //   firstName / lastName / email / phone, resume input near top of form.
    const tryField = (selectors, value, label) => {
      if (!value) return;
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          plan.push({ action: 'typetext', selector: sel, value, label });
          return;
        }
      }
    };

    tryField(
      [
        'input[name="firstName"]',
        'input[id*="firstName" i]',
        'input[id*="first_name" i]',
        'input[name="first-name"]',
      ],
      profile.first_name,
      'First Name',
    );
    tryField(
      [
        'input[name="lastName"]',
        'input[id*="lastName" i]',
        'input[id*="last_name" i]',
        'input[name="last-name"]',
      ],
      profile.last_name,
      'Last Name',
    );
    tryField(
      ['input[type=email]', 'input[name="email"]', 'input[id*="email" i]'],
      profile.email,
      'Email',
    );
    tryField(
      ['input[type=tel]', 'input[name="phone"]', 'input[id*="phone" i]'],
      profile.phone,
      'Phone',
    );
    tryField(
      [
        'input[name*="linkedin" i]',
        'input[id*="linkedin" i]',
        'input[name*="linkedIn" ]',
      ],
      profile.linkedin,
      'LinkedIn',
    );
    tryField(
      ['input[name*="github" i]', 'input[id*="github" i]'],
      profile.github,
      'GitHub',
    );
    tryField(
      [
        'input[name*="website" i]',
        'input[name*="portfolio" i]',
        'input[id*="website" i]',
      ],
      profile.website,
      'Website',
    );

    // Resume upload — search for the most likely file input
    const fileSel = SR.uploadResume();
    if (fileSel.ok && profile.resume_path) {
      plan.push({
        action: 'upload',
        selector: fileSel.selector,
        value: profile.resume_path,
        label: 'Resume',
      });
    }

    // Native <select> dropdowns with asterisk-labeled requireds
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      if (!sel.id) continue;
      const label = labelTextFor(sel).toLowerCase();
      const answer = guessSelectAnswer(label, profile);
      const selector = '#' + CSS.escape(sel.id);
      if (answer) {
        plan.push({
          action: 'select',
          selector,
          value: answer,
          label,
        });
      }
    }

    return { ok: true, plan };
  };

  // ---------- submit / success ----------

  /**
   * SR.findSubmit()
   *
   * Locate the submit button. Does NOT click — 用户 authorizes per safety rules.
   */
  SR.findSubmit = function () {
    const candidates = [
      'button[type=submit]',
      'button[data-testid*="submit" i]',
      'button[data-test*="submit" i]',
      'button.submit',
      'input[type=submit]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        return { ok: true, selector: sel, text: (el.innerText || el.value || '').trim() };
      }
    }
    // Fallback — visible button labelled "Submit" / "Apply" / "Send application"
    const buttons = document.querySelectorAll('button');
    for (const b of buttons) {
      const txt = (b.innerText || '').trim().toLowerCase();
      if (b.offsetParent === null) continue;
      if (
        txt === 'submit' ||
        txt === 'submit application' ||
        txt === 'apply' ||
        txt === 'send application'
      ) {
        return { ok: true, selector: 'button', text: b.innerText.trim() };
      }
    }
    return { ok: false, note: 'submit_button_not_found' };
  };

  /**
   * SR.checkSuccess()
   *
   * SmartRecruiters appears to show a "Thank you" / "application has been
   * submitted" panel in-place. Check body text — also accept URL containing
   * `/thankyou` or `/confirmation` which a few orgs use.
   */
  SR.checkSuccess = function () {
    const txt = document.body.innerText || '';
    const url = location.href || '';
    const phrases = [
      'application has been submitted',
      'thank you for applying',
      'successfully submitted',
      'application received',
      'we have received your application',
    ];
    const textHit = phrases.some((p) =>
      txt.toLowerCase().includes(p.toLowerCase()),
    );
    const urlHit = /\/(thankyou|thank-you|confirmation|success)/i.test(url);
    return {
      ok: textHit || urlHit,
      url,
      snippet: txt.slice(0, 200),
      matched: textHit ? 'body_text' : urlHit ? 'url' : null,
    };
  };

  // ---------- guessSelectAnswer (shared heuristic) ----------

  function guessSelectAnswer(label, profile) {
    if (!label) return null;
    const p = profile.standard_answers || {};
    if (label.includes('pronoun')) return p.pronouns || null;
    if (label.includes('gender')) return p.gender || null;
    if (label.includes('race') || label.includes('ethnic')) return p.race || null;
    if (label.includes('veteran')) return p.veteran_status || null;
    if (label.includes('disabilit')) return p.disability_status || null;
    if (label.includes('how did you hear') || label.includes('source'))
      return p.source || null;
    if (label.includes('country')) return p.country || null;
    if (label.includes('state') || label.includes('region')) return p.state || null;
    return null;
  }

  // expose
  globalThis.SmartRecruiters = SR;
  return SR;
})();
