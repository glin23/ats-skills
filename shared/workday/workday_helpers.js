/**
 * workday_helpers.js — Workday ATS form helpers (v0.7 stretch, config-driven)
 *
 * Injected into the page via `node shared/cdp.mjs eval $TAB "$(cat workday_helpers.js)"`.
 * After eval, the global `Workday` object exposes the helpers below.
 *
 * IMPORTANT — this is NOT a generic Workday solver. Workday tenant variants are too
 * many (coverage <60% with pure DOM heuristics, e.g. "How did you hear about us"
 * select options differ per tenant). Instead, every company has its own JSON config
 * under `shared/workday/companies/<slug>.json` describing each step's fields and
 * the profile path that fills them. Common selectors (Save/Continue, file upload,
 * demographic EEO) are shared via this file. See `_template.json` for the schema.
 *
 * Workday selector strategy:
 *   Workday's React UI tags nearly every interactive element with
 *   `data-automation-id="..."`. We treat that attribute as the primary selector.
 *   IDs and CSS classes are NOT stable across tenant releases.
 *
 * Multi-step wizard: each "Save and Continue" rerenders the page. Helpers should
 * be re-injected after every step transition — the orchestrator (SKILL.md) handles
 * the re-inject loop. detectStep() returns the current step so the orchestrator
 * can look up the right slice of the company config.
 *
 * v0.7 status: stretch / placeholder. Unit-shape sanity-checked, live verification pending.
 */
(function () {
  const Workday = {};

  // ---------- internals ----------

  function $(sel) {
    return document.querySelector(sel);
  }

  function $$(sel) {
    return Array.from(document.querySelectorAll(sel));
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function byAutoId(id) {
    // data-automation-id values can collide; first match wins.
    return document.querySelector('[data-automation-id="' + id + '"]');
  }

  function getNativeSetter(el) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    return Object.getOwnPropertyDescriptor(proto, 'value').set;
  }

  function getByProfilePath(profile, path) {
    if (!path) return undefined;
    return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), profile);
  }

  // ---------- step detection ----------

  /**
   * Workday.detectStep()
   *
   * Workday wizard steps render a wrapper div with `data-automation-id` like:
   *   contactInformationPage / myExperiencePage / voluntaryDisclosuresPage /
   *   selfIdentificationPage / reviewSubmitPage
   * plus a header text node with the step name.
   *
   * Returns: { step: 1-5+, stepName: string, knownStep: string|null }
   */
  Workday.detectStep = function () {
    const known = [
      { id: 'contactInformationPage', name: 'My Information', step: 1 },
      { id: 'myInformationPage', name: 'My Information', step: 1 },
      { id: 'myExperiencePage', name: 'My Experience', step: 2 },
      { id: 'applicationQuestionsPage', name: 'Application Questions', step: 3 },
      { id: 'voluntaryDisclosuresPage', name: 'Voluntary Disclosures', step: 4 },
      { id: 'selfIdentificationPage', name: 'Self Identify', step: 5 },
      { id: 'reviewSubmitPage', name: 'Review', step: 6 },
    ];
    for (const k of known) {
      if (byAutoId(k.id)) {
        return { ok: true, step: k.step, stepName: k.name, knownStep: k.id };
      }
    }
    // fallback — try the wizard progress indicator if present
    const progress = byAutoId('progressBarActiveStep');
    return {
      ok: false,
      step: null,
      stepName: progress ? (progress.innerText || '').trim() : '(unknown)',
      knownStep: null,
    };
  };

  // ---------- navigation ----------

  /**
   * Workday.clickContinue()
   *
   * The forward button. Variants observed across tenants:
   *   bottom-navigation-next-button   (most common)
   *   wizardNavigationNext            (older tenants)
   * Falls back to any visible button whose text matches Save and Continue / Continue / Next / Submit.
   */
  Workday.clickContinue = async function () {
    const candidates = [
      'bottom-navigation-next-button',
      'wizardNavigationNext',
      'pageFooterNextButton',
    ];
    for (const id of candidates) {
      const el = byAutoId(id);
      if (el && el.offsetParent !== null) {
        el.click();
        return { ok: true, via: 'automationId:' + id };
      }
    }
    // text-based fallback
    const wanted = ['save and continue', 'continue', 'next', 'review and submit'];
    for (const btn of $$('button')) {
      const t = (btn.innerText || '').trim().toLowerCase();
      if (wanted.includes(t) && btn.offsetParent !== null) {
        btn.click();
        return { ok: true, via: 'text:' + t };
      }
    }
    return { ok: false, note: 'continue_button_not_found' };
  };

  // ---------- field operations ----------

  /**
   * Workday.setTextByAutoId(autoId, value)
   *
   * Set value on input/textarea selected by data-automation-id. Like Ashby, Workday
   * uses React; some tenants do honor JS-dispatched InputEvents but others (typically
   * those with strict react-hook-form) require real keyboard. When `note=use_typetext`
   * the caller should run `node shared/cdp.mjs typetext $TAB "[data-automation-id='X']" "value"`.
   */
  Workday.setTextByAutoId = function (autoId, value) {
    const el = byAutoId(autoId);
    if (!el) return { ok: false, autoId, note: 'not_found' };
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
        })
      );
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return {
        ok: el.value === value,
        autoId,
        selector: '[data-automation-id="' + autoId + '"]',
        note: el.value === value ? 'set' : 'use_typetext',
      };
    } catch (e) {
      return { ok: false, autoId, note: 'error:' + e.message };
    }
  };

  /**
   * Workday.setSelectByAutoId(autoId, optionText)
   *
   * Workday selects are <button data-automation-id="X"> that open a popup listbox.
   * Open the popup, type the option text, press Enter. Mirrors apply.js pattern
   * from ubangura/Workday-Application-Automator.
   *
   * NOTE: actually opening and typing requires real keyboard for many tenants.
   * Returns selector info so the caller can run cdp.mjs typetext after clicking.
   */
  Workday.setSelectByAutoId = async function (autoId, optionText) {
    const btn = byAutoId(autoId);
    if (!btn) return { ok: false, autoId, note: 'not_found' };
    if (btn.offsetParent === null) return { ok: false, autoId, note: 'not_visible' };
    btn.click();
    await sleep(300);
    return {
      ok: true,
      autoId,
      selector: '[data-automation-id="' + autoId + '"]',
      optionText,
      note: 'opened_popup_use_typetext_then_enter',
    };
  };

  /**
   * Workday.clickButtonByAutoId(autoId)
   */
  Workday.clickButtonByAutoId = function (autoId) {
    const el = byAutoId(autoId);
    if (!el) return { ok: false, autoId, note: 'not_found' };
    el.click();
    return { ok: true, autoId };
  };

  // ---------- file upload ----------

  /**
   * Workday.uploadResume(autoId)
   *
   * Workday file inputs typically use:
   *   <input type="file" data-automation-id="file-upload-input-ref">
   * Some tenants name it differently (file-upload-input-ref-resume, fileAttachUploadButton).
   * The actual upload must go through CDP `DOM.setFileInputFiles`.
   * Caller should run: node shared/cdp.mjs upload $TAB "[data-automation-id='<autoId>']" <path>
   */
  Workday.uploadResume = function (autoId) {
    autoId = autoId || 'file-upload-input-ref';
    const el = byAutoId(autoId);
    return {
      ok: !!el,
      autoId,
      selector: '[data-automation-id="' + autoId + '"]',
      note: el
        ? 'use cdp.mjs upload — DOM.setFileInputFiles, not JS'
        : 'file_input_not_found',
    };
  };

  // ---------- demographic (EEO) ----------

  /**
   * Workday.fillDemographic(profile)
   *
   * Standard EEO fields render with consistent data-automation-id values across
   * nearly every Workday tenant (these are part of the Workday platform, not the
   * tenant's customization). Pulls from profile.standard_answers when present.
   *
   * Common ids:
   *   gender, ethnicity, hispanicOrLatino, veteranStatus, disabilityStatus
   * These are <button> dropdowns — caller must use typetext + Enter after opening.
   */
  Workday.fillDemographic = async function (profile) {
    const std = (profile && profile.standard_answers) || {};
    const plan = [];
    const map = [
      ['gender', std.gender],
      ['ethnicity', std.race || std.ethnicity],
      ['hispanicOrLatino', std.hispanic_or_latino],
      ['veteranStatus', std.veteran_status],
      ['disabilityStatus', std.disability_status],
    ];
    for (const [autoId, val] of map) {
      const btn = byAutoId(autoId);
      if (!btn || !val) continue;
      plan.push({
        action: 'select',
        autoId,
        selector: '[data-automation-id="' + autoId + '"]',
        value: val,
        note: 'open_then_typetext',
      });
    }
    return { ok: true, plan };
  };

  // ---------- find empty required ----------

  /**
   * Workday.findEmptyRequired()
   *
   * Walk the current step's container and surface every required-but-empty field.
   * Workday marks required fields with:
   *   - aria-required="true"
   *   - a sibling/label with "*" suffix
   *   - inline error nodes data-automation-id ending in "errorMessage"
   *
   * Returns: Array<{ autoId, label, type, currentValue }>
   */
  Workday.findEmptyRequired = function () {
    const result = [];
    const seen = new Set();

    const stepInfo = Workday.detectStep();
    const stepRoot = stepInfo.knownStep ? byAutoId(stepInfo.knownStep) : document;
    if (!stepRoot) return result;

    const candidates = stepRoot.querySelectorAll(
      '[aria-required="true"], [data-automation-id]'
    );
    for (const el of candidates) {
      const autoId = el.getAttribute('data-automation-id');
      if (!autoId || seen.has(autoId)) continue;
      if (el.offsetParent === null && el.type !== 'file') continue;
      const required =
        el.getAttribute('aria-required') === 'true' ||
        el.required ||
        /\*\s*$/.test(labelTextFor(el));
      if (!required) continue;

      const tag = el.tagName.toLowerCase();
      let type = el.type || tag;
      let currentValue = '';
      if (tag === 'input' || tag === 'textarea') {
        currentValue = el.value || '';
      } else if (tag === 'button') {
        // dropdown button — text content is the selected value
        currentValue = (el.innerText || '').trim();
        type = 'select';
      }
      if (currentValue && currentValue !== 'Select One') continue;

      seen.add(autoId);
      result.push({
        autoId,
        selector: '[data-automation-id="' + autoId + '"]',
        label: labelTextFor(el).replace(/\*\s*$/, '').trim(),
        type,
        required: true,
        currentValue,
      });
    }
    return result;
  };

  // ---------- config dispatcher ----------

  /**
   * Workday.applyCompanyConfig(config, profile)
   *
   * Walk the step_definitions for the CURRENT step and return a plan the
   * orchestrator can execute (typetext / select / file / button). Does NOT
   * actually type text — text goes through cdp.mjs typetext (real keyboard).
   *
   * @param {object} config — loaded from companies/<slug>.json
   * @param {object} profile — loaded from ~/.mrweirdo-jobs/profile.json
   * @returns {{ step: object, plan: Array }}
   */
  Workday.applyCompanyConfig = function (config, profile) {
    if (!config || !config.step_definitions) {
      return { ok: false, note: 'config_missing_step_definitions' };
    }
    const info = Workday.detectStep();
    const stepDef = config.step_definitions.find(
      (s) => s.step === info.step || s.name === info.stepName
    );
    if (!stepDef) {
      return {
        ok: false,
        detectedStep: info,
        note: 'no_matching_step_in_config',
      };
    }
    const plan = [];
    for (const field of stepDef.fields || []) {
      const val = getByProfilePath(profile, field.profile_path);
      if (val === undefined || val === null || val === '') {
        if (field.required) {
          plan.push({
            action: 'missing',
            autoId: field.automation_id,
            label: field.label || field.automation_id,
            profile_path: field.profile_path,
          });
        }
        continue;
      }
      const type = (field.type || 'text').toLowerCase();
      if (type === 'file') {
        plan.push({
          action: 'upload',
          selector: '[data-automation-id="' + field.automation_id + '"]',
          value: val,
          label: field.label || field.automation_id,
        });
      } else if (type === 'select') {
        // options_to_value_map: profile value -> Workday option text
        const mapped =
          (field.options_to_value_map && field.options_to_value_map[val]) || val;
        plan.push({
          action: 'select',
          autoId: field.automation_id,
          selector: '[data-automation-id="' + field.automation_id + '"]',
          value: mapped,
          label: field.label || field.automation_id,
        });
      } else if (type === 'button' || type === 'click') {
        plan.push({
          action: 'click',
          autoId: field.automation_id,
          label: field.label || field.automation_id,
        });
      } else {
        plan.push({
          action: 'typetext',
          selector: '[data-automation-id="' + field.automation_id + '"]',
          value: String(val),
          label: field.label || field.automation_id,
        });
      }
    }
    return { ok: true, step: stepDef, detectedStep: info, plan };
  };

  // ---------- submit check ----------

  /**
   * Workday.checkSuccess()
   *
   * Workday success: page renders an "applicationSubmittedPage" container OR
   * body text "Your application was submitted" / "Thank you for applying".
   */
  Workday.checkSuccess = function () {
    if (byAutoId('applicationSubmittedPage')) {
      return { ok: true, via: 'applicationSubmittedPage' };
    }
    const txt = (document.body.innerText || '').toLowerCase();
    const phrases = [
      'your application was submitted',
      'thank you for applying',
      'application submitted',
      "you've successfully submitted",
    ];
    for (const p of phrases) {
      if (txt.includes(p)) return { ok: true, via: 'body_text', phrase: p };
    }
    return { ok: false, snippet: (document.body.innerText || '').slice(0, 200) };
  };

  // ---------- normalize profile ----------

  /**
   * Workday.normalizeProfile(raw)
   *
   * Workday configs reference profile via dotted paths (personal.first_name etc),
   * so the nested template profile shape is the native shape — no flattening
   * needed. This helper just guarantees the expected top-level keys exist so
   * `getByProfilePath` never trips on undefined.
   */
  Workday.normalizeProfile = function (raw) {
    if (!raw) return null;
    return Object.assign(
      {
        personal: {},
        standard_answers: {},
        work_experience: [],
        education: [],
        resume_path: null,
      },
      raw
    );
  };

  // ---------- label heuristics ----------

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
      const lbl = cur.querySelector && cur.querySelector('label');
      if (lbl) return lbl.innerText.trim();
      cur = cur.parentElement;
    }
    return '';
  }

  // expose
  window.Workday = Workday;
  return Workday;
})();
