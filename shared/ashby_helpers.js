/**
 * ashby_helpers.js — Ashby ATS form helpers
 *
 * Injected into the page via `node shared/cdp.mjs eval $TAB "$(cat ashby_helpers.js)"`.
 * After eval, the global `Ashby` object exposes the helpers below.
 *
 * CRITICAL — Ashby uses react-hook-form which checks `event.isTrusted` on input events.
 *   JS-dispatched InputEvents have `isTrusted: false` and get IGNORED on most forms.
 *   For text fields, the caller MUST go through `node shared/cdp.mjs typetext <tab> <sel> <val>`
 *   which uses CDP `Input.insertText` to synthesize real keyboard events (isTrusted=true).
 *
 *   `Ashby.setVal()` provides a JS fallback (setter + InputEvent) for cases where it does
 *   happen to work (e.g. Uplane), but treat it as best-effort only. Prefer typetext.
 *
 * Reference: feedback_ats_react_select_mousedown.md (Ashby section, 2026-05-18)
 */
(function () {
  const Ashby = {};

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

  // ---------- text fields ----------

  /**
   * Ashby.setVal(fieldId, value)
   *
   * Best-effort JS fallback for text/email/phone inputs and textareas.
   *
   * **STRONGLY RECOMMENDED**: don't call this for required fields. Instead exit JS,
   * have the caller run `node shared/cdp.mjs typetext $TAB "#<fieldId>" "<value>"`.
   * react-hook-form on many Ashby orgs (Matterworks, Polymarket, Injective) silently
   * drops dispatchEvent-fed input because isTrusted=false.
   *
   * Returns: { ok: bool, selector: string, note: string }
   *   - `selector` is the CSS selector the caller should hand to cdp.mjs typetext.
   *   - `note` is "use_typetext" when the caller should prefer real keyboard.
   */
  Ashby.setVal = function (fieldId, value) {
    const el = $('#' + CSS.escape(fieldId));
    if (!el) {
      return { ok: false, selector: '#' + fieldId, note: 'not_found' };
    }
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
        selector: '#' + fieldId,
        note: 'use_typetext', // caller should prefer CDP typetext for reliability
      };
    } catch (e) {
      return { ok: false, selector: '#' + fieldId, note: 'error:' + e.message };
    }
  };

  // ---------- Yes/No widget ----------

  /**
   * Ashby.clickYesNo(question_uuid, answer)
   *
   * Ashby Yes/No questions render as <button>Yes</button> <button>No</button>
   * plus a hidden <input type=checkbox name=<uuid>>. A SINGLE `btn.click()` toggles
   * the button into `_active_` class state and flips the hidden checkbox.
   *
   * DO NOT dispatch mousedown — Ashby treats mousedown+click as a toggle and
   * will deselect the answer if you fire both.
   *
   * DO NOT verify hidden checkbox.checked — React internal state can desync from
   * the DOM attribute. Trust the button's `_active_` class.
   *
   * @param {string} question_uuid — the `name` of the hidden checkbox
   * @param {"Yes"|"No"} answer
   */
  Ashby.clickYesNo = async function (question_uuid, answer) {
    if (answer !== 'Yes' && answer !== 'No') {
      return { ok: false, note: 'bad_answer:' + answer };
    }
    // hidden checkbox identifies the question container
    const cb = document.querySelector(
      'input[type=checkbox][name="' + question_uuid + '"]'
    );
    if (!cb) return { ok: false, note: 'uuid_not_found' };

    // walk up to find the buttons (usually within a fieldset / div wrapper)
    let container = cb.parentElement;
    let buttons = [];
    for (let i = 0; i < 6 && container; i++) {
      buttons = container.querySelectorAll('button');
      if (buttons.length >= 2) break;
      container = container.parentElement;
    }
    if (buttons.length < 2) return { ok: false, note: 'buttons_not_found' };

    let target = null;
    for (const b of buttons) {
      if (b.innerText.trim() === answer) {
        target = b;
        break;
      }
    }
    if (!target) return { ok: false, note: 'answer_button_not_found' };

    // already active? skip — clicking again would toggle off
    if (/(^|\s)_active_/.test(target.className)) {
      return { ok: true, note: 'already_active' };
    }
    target.click(); // single click. NOT mousedown.

    // v0.3 fix: react-hook-form state can lag the DOM update by a frame.
    // Wait 250ms before checking the button's `_active_` class. DO NOT check
    // `cb.checked` — React's internal state can desync from the DOM attribute.
    await sleep(250);
    if (/(^|\s)_active_/.test(target.className)) {
      return { ok: true, picked: answer, note: 'activated' };
    }

    // Retry once — some Ashby orgs need a second click after slow hydration.
    target.click();
    await sleep(300);
    if (/(^|\s)_active_/.test(target.className)) {
      return { ok: true, picked: answer, note: 'activated_after_retry', retried: true };
    }

    return { ok: false, note: 'click_did_not_activate_after_retry' };
  };

  // ---------- react-select v5 picker ----------

  /**
   * Ashby.pickSelect(fieldId, optionText)
   *
   * Same react-select v5 mechanics as Greenhouse — dispatch real MouseEvent series
   * (mousedown -> mouseup -> click) to `.select__control`. JS `.click()` alone does
   * not open the menu because react-select listens to onMouseDown, not onClick.
   *
   * @param {string} fieldId — hidden input id (the control wraps it)
   * @param {string} optionText — exact text to match (case-insensitive trim)
   */
  Ashby.pickSelect = async function (fieldId, optionText) {
    const input = $('#' + CSS.escape(fieldId));
    if (!input) return { ok: false, note: 'field_not_found' };
    const control = input.closest('.select__control');
    if (!control) return { ok: false, note: 'no_select_control' };

    // v0.2 fix #3: ensure picker is in viewport before opening. Same react-select
    // off-screen-doesn't-render-options bug observed on NiCE (Greenhouse) — Ashby
    // forms with long question lists exhibit the same behavior.
    try {
      control.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch (_) {
      control.scrollIntoView({ block: 'center' });
    }
    await sleep(200); // let layout settle

    // open menu via mousedown trio
    ['mousedown', 'mouseup', 'click'].forEach((t) =>
      control.dispatchEvent(
        new MouseEvent(t, {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
        })
      )
    );

    // v0.2 fix #2: poll for options up to 3s (was 1.5s) and give React an initial
    // mount window. NiCE-style slow renders need >600ms.
    await sleep(200);
    const wanted = optionText.trim().toLowerCase();
    let target = null;
    for (let i = 0; i < 30 && !target; i++) {
      await sleep(100);
      const opts = document.querySelectorAll('.select__option');
      for (const o of opts) {
        if (o.innerText.trim().toLowerCase() === wanted) {
          target = o;
          break;
        }
      }
    }
    if (!target) {
      // close menu before giving up so next picker isn't polluted
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
      return { ok: false, note: 'option_not_found:' + optionText };
    }

    ['mousedown', 'mouseup', 'click'].forEach((t) =>
      target.dispatchEvent(
        new MouseEvent(t, {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
        })
      )
    );

    // close residual menu so the next picker starts clean
    await sleep(150);
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );

    const shown = control.innerText.trim();
    return { ok: shown.toLowerCase().includes(wanted), shown };
  };

  // ---------- date picker (react-datepicker) ----------

  /**
   * Ashby.setDate(fieldId, mmddyyyy)
   *
   * Ashby uses react-datepicker with placeholder "Pick date...". Setter + InputEvent
   * is enough — don't open the calendar UI. Format string is "MM/DD/YYYY".
   *
   * @param {string} fieldId
   * @param {string} mmddyyyy — e.g. "06/15/2026"
   */
  Ashby.setDate = function (fieldId, mmddyyyy) {
    const el = $('#' + CSS.escape(fieldId));
    if (!el) return { ok: false, note: 'not_found' };
    try {
      const setter = getNativeSetter(el);
      el.focus();
      setter.call(el, mmddyyyy);
      el.dispatchEvent(
        new InputEvent('input', {
          inputType: 'insertText',
          data: mmddyyyy,
          bubbles: true,
        })
      );
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return { ok: el.value === mmddyyyy, value: el.value };
    } catch (e) {
      return { ok: false, note: 'error:' + e.message };
    }
  };

  // ---------- _systemfield helpers ----------

  /**
   * Ashby.setSystemField(name)
   *
   * `#_systemfield_name` is a SINGLE combined name field — pass the full "Jane Doe",
   * not first/last separately.
   *
   * Returns selector info; caller should run cdp.mjs typetext for real keyboard.
   */
  Ashby.setSystemField = function (name) {
    const el = $('#_systemfield_name');
    if (!el) return { ok: false, note: 'systemfield_name_not_found' };
    return {
      ok: true,
      selector: '#_systemfield_name',
      value: name,
      note: 'use_typetext',
    };
  };

  /**
   * Ashby.uploadResume()
   *
   * STUB — the actual file upload must go through CDP `DOM.setFileInputFiles`.
   * Caller should run: `node shared/cdp.mjs upload $TAB "#_systemfield_resume" $RESUME_PATH`
   */
  Ashby.uploadResume = function () {
    const el = $('#_systemfield_resume');
    return {
      ok: !!el,
      selector: '#_systemfield_resume',
      note: 'use cdp.mjs upload — DOM.setFileInputFiles, not JS',
    };
  };

  // ---------- location combobox (v0.3) ----------

  /**
   * Ashby.prepareLocationCombobox(elementOrId)
   *
   * Ashby "Current Location" is a `<input role="combobox">` with no stable id.
   * findEmptyRequired() returns an `element` reference; pass it here (or pass
   * an existing id string) to scroll it into view, assign a temp id, and focus.
   * Then the caller must run `node shared/cdp.mjs typetext $TAB <selector> <text>`
   * to type with real keyboard events, then call Ashby.pickLocationOption() to
   * commit the autocomplete selection.
   *
   * @param {Element|string} elementOrId — DOM element OR existing id string
   * @returns {{ ok: boolean, selector?: string, error?: string }}
   */
  Ashby.prepareLocationCombobox = async function (elementOrId) {
    const el =
      typeof elementOrId === 'string'
        ? document.getElementById(elementOrId)
        : elementOrId;
    if (!el) return { ok: false, error: 'no element' };

    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch (_) {
      el.scrollIntoView({ block: 'center' });
    }
    await sleep(300);
    if (!el.id) el.id = '__ashby_loc_' + Date.now();
    el.focus();
    return { ok: true, selector: '#' + el.id };
  };

  /**
   * Ashby.pickLocationOption(text)
   *
   * After the caller has used cdp.mjs typetext to enter location text into the
   * combobox prepared by prepareLocationCombobox(), call this to wait for the
   * Ashby autocomplete options and click the matching one (or the first if no
   * exact match). Uses MouseEvent trio (mousedown/mouseup/click) on `[role="option"]`.
   *
   * @param {string} text — text to match (case-insensitive substring)
   */
  Ashby.pickLocationOption = async function (text) {
    // Ashby debounces autocomplete ~600-800ms after the last keystroke.
    await sleep(800);
    const deadline = Date.now() + 3000;
    let opts = [];
    while (Date.now() < deadline) {
      opts = Array.from(document.querySelectorAll('[role="option"]'));
      if (opts.length > 0) break;
      await sleep(100);
    }
    if (!opts.length) return { ok: false, error: 'no options after 3s' };

    const target = String(text).trim().toLowerCase();
    let match = opts.find((o) =>
      (o.innerText || '').toLowerCase().includes(target)
    );
    if (!match) match = opts[0]; // fallback to first option

    ['mousedown', 'mouseup', 'click'].forEach((t) =>
      match.dispatchEvent(
        new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 })
      )
    );
    await sleep(300);
    return { ok: true, picked: (match.innerText || '').trim() };
  };

  // ---------- submit / success ----------

  /**
   * Ashby.findSubmit()
   *
   * Locate the submit button. DOES NOT click it — 用户 must explicitly authorize
   * the submit per harness classifier rules (feedback_ats_auto_apply_strategy_2026).
   */
  Ashby.findSubmit = function () {
    // Ashby typically uses <button type=submit> at end of form
    const candidates = [
      'button[type=submit]',
      'form button._systemfield-submit',
      'button._systemfield-submit',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        return { ok: true, selector: sel, text: el.innerText.trim() };
      }
    }
    // last resort — any visible button whose text is "Submit application" or "Submit"
    const buttons = document.querySelectorAll('button');
    for (const b of buttons) {
      const txt = b.innerText.trim().toLowerCase();
      if (
        (txt === 'submit' || txt === 'submit application') &&
        b.offsetParent !== null
      ) {
        return { ok: true, selector: 'button', text: b.innerText.trim() };
      }
    }
    return { ok: false, note: 'submit_button_not_found' };
  };

  /**
   * Ashby.checkSuccess()
   *
   * Ashby success: form is replaced in-place with a green "Your application was
   * successfully submitted." panel. URL DOES NOT change to /confirmation
   * (unlike Greenhouse). Check body text.
   */
  Ashby.checkSuccess = function () {
    const txt = document.body.innerText || '';
    return {
      ok: txt.includes('successfully submitted'),
      snippet: txt.slice(0, 200),
    };
  };

  // ---------- v0.2 additions ----------

  /**
   * Ashby.normalizeProfile(raw)
   *
   * Convert the nested `profile.template.json` shape into the flat shape
   * `Ashby.fillForm()` expects. v0.1 callers passing a flat profile still work —
   * `fillForm` detects both shapes and auto-normalizes.
   *
   * Ashby uses `_systemfield_name` as a SINGLE combined field, so we build
   * `full_name` from `personal.full_name` (preferred) or first + last.
   *
   * Returns null when raw is falsy.
   */
  Ashby.normalizeProfile = function (raw) {
    if (!raw) return null;
    // Already-flat profile (v0.1) — pass through with safe defaults.
    if (!raw.personal && (raw.name || raw.email)) {
      return Object.assign(
        {
          custom_answers: {},
          picker_answers: {},
          yesno_answers: {},
        },
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
      name: fullName, // for orchestrator readability
      full_name: fullName, // fillForm() field reference
      email: personal.email,
      phone: personal.phone,
      linkedin: personal.linkedin,
      github: personal.github,
      website: personal.portfolio,
      resume_path: raw.resume_path,
      // Buckets for orchestrator-supplied answers
      custom_answers: {},
      picker_answers: {},
      yesno_answers: {},
      // Pass through original work_authorization / demographics / standard_qa
      // so the existing guessYesNo / guessSelectAnswer heuristics keep working.
      standard_answers: raw.standard_answers || {},
      _raw: raw,
    };
  };

  /**
   * Ashby.findEmptyRequired()
   *
   * Returns every required-but-empty visible form field on the page. Ashby uses:
   *   - `_systemfield_*` ids for required core fields (name, email, resume)
   *   - `aria-required="true"` on react-hook-form fields (not HTML `required`)
   *   - Yes/No widgets where the buttons lack `_active_` class until clicked
   *
   * Returns: Array<{ id, label, type, required, currentValue, options }>
   */
  Ashby.findEmptyRequired = function () {
    const result = [];
    const seen = new Set();

    const push = (entry) => {
      if (!entry || !entry.id || seen.has(entry.id)) return;
      seen.add(entry.id);
      result.push(entry);
    };

    const isEmptySelectDisplay = (display) => {
      const d = (display || '').trim().toLowerCase();
      return !d || d === 'select…' || d === 'select...' || d.startsWith('select');
    };

    // 1) `_systemfield_*` required core fields (name, email, resume).
    const systemFields = document.querySelectorAll(
      '[id^="_systemfield_"]'
    );
    for (const el of systemFields) {
      if (!el.id) continue;
      if (!el.offsetParent && el.type !== 'file') continue;
      // file inputs may be visually hidden but still required
      const labelEl = document.querySelector('label[for="' + el.id + '"]');
      const label =
        (labelEl ? labelEl.innerText : labelTextFor(el)) || el.id.replace('_systemfield_', '');
      if (el.type === 'file') {
        push({
          id: el.id,
          label: label.replace(/\s*\*\s*$/, '').trim(),
          type: 'file',
          required: true,
          currentValue: el.files && el.files.length ? '[uploaded]' : '',
          options: null,
        });
        continue;
      }
      if (!el.value) {
        push({
          id: el.id,
          label: label.replace(/\s*\*\s*$/, '').trim(),
          type: el.type || el.tagName.toLowerCase(),
          required: true,
          currentValue: '',
          options: null,
        });
      }
    }

    // 2) `aria-required="true"` (react-hook-form).
    const ariaRequired = document.querySelectorAll('[aria-required="true"]');
    for (const el of ariaRequired) {
      if (!el.id || seen.has(el.id)) continue;
      if (!el.offsetParent && !el.closest('.select__control')) continue;
      const labelEl = document.querySelector('label[for="' + el.id + '"]');
      const labelText = (labelEl ? labelEl.innerText : labelTextFor(el)) || '(no label)';
      // react-select?
      if (el.closest('.select__control')) {
        const ctl = el.closest('.select__control');
        const display = (ctl.innerText || '').trim();
        if (isEmptySelectDisplay(display)) {
          push({
            id: el.id,
            label: labelText.replace(/\s*\*\s*$/, '').trim(),
            type: 'react-select',
            required: true,
            currentValue: display,
            options: null,
          });
        }
      } else if (!el.value) {
        push({
          id: el.id,
          label: labelText.replace(/\s*\*\s*$/, '').trim(),
          type: el.type || el.tagName.toLowerCase(),
          required: true,
          currentValue: '',
          options: null,
        });
      }
    }

    // 3) Yes/No widgets — hidden checkboxes with sibling Yes/No buttons.
    const checkboxes = document.querySelectorAll('input[type=checkbox][name]');
    for (const cb of checkboxes) {
      if (!cb.name || seen.has(cb.name)) continue;
      let container = cb.parentElement;
      let yesBtn = null;
      let noBtn = null;
      for (let i = 0; i < 6 && container && !(yesBtn && noBtn); i++) {
        const btns = container.querySelectorAll('button');
        for (const b of btns) {
          const t = (b.innerText || '').trim();
          if (t === 'Yes') yesBtn = b;
          if (t === 'No') noBtn = b;
        }
        container = container.parentElement;
      }
      if (!yesBtn || !noBtn) continue;
      const yesActive = /(^|\s)_active_/.test(yesBtn.className);
      const noActive = /(^|\s)_active_/.test(noBtn.className);
      if (yesActive || noActive) continue; // already answered
      const label = labelTextFor(cb);
      push({
        id: cb.name,
        label: (label || '(yesno)').replace(/\s*\*\s*$/, '').trim(),
        type: 'yesno',
        required: true,
        currentValue: '',
        options: ['Yes', 'No'],
      });
    }

    // 4) Empty react-select controls not already captured via aria-required.
    const controls = document.querySelectorAll('.select__control');
    for (const ctl of controls) {
      const hidden = ctl.querySelector('input[id]');
      if (!hidden || !hidden.id || seen.has(hidden.id)) continue;
      const display = (ctl.innerText || '').trim();
      if (!isEmptySelectDisplay(display)) continue;
      const label = labelTextFor(hidden);
      // Best signal we can get without aria-required: an asterisk in the label
      // OR proximity to a `_systemfield`-style required region. We err on the
      // side of inclusion since the orchestrator can ignore non-required entries.
      const looksRequired = /\*/.test(label || '');
      if (!looksRequired) continue;
      push({
        id: hidden.id,
        label: (label || '(no label)').replace(/\s*\*\s*$/, '').trim(),
        type: 'react-select',
        required: true,
        currentValue: display,
        options: null,
      });
    }

    // 5) v0.3 fix: Ashby "Current Location" combobox.
    // Ashby renders location autocomplete as <input role="combobox"
    // class="_input_v5ami_28" placeholder="Start typing...">. No id, no
    // `required`, no `aria-required`. Caller must assign a temp id, focus,
    // run cdp.mjs typetext, then Ashby.pickLocationOption() to commit.
    //
    // Surfaced 2026-05-23 by Crusoe submission failure: "Missing entry for
    // required field: Current Location".
    const locInputs = document.querySelectorAll(
      'input[role="combobox"][placeholder*="ype here" i], input[role="combobox"][placeholder*="tart typing" i], input[role="combobox"][placeholder*="ocation" i]'
    );
    for (const inp of locInputs) {
      if (inp.value && inp.value.trim()) continue; // already filled
      if (inp.id && seen.has(inp.id)) continue;
      if (result.some((r) => r.element === inp)) continue;

      // Walk up looking for a label-like element (Ashby uses div._title_*
      // for the field label; explicit <label> is rare for comboboxes).
      let labelText = '(unlabeled combobox)';
      let walker = inp;
      for (let i = 0; i < 5; i++) {
        walker = walker.parentElement;
        if (!walker) break;
        const lab = walker.querySelector(
          'label, div[class*="_title_"], div[class*="label" i]'
        );
        if (lab && lab.innerText && lab.innerText.trim().length > 0 && lab.innerText.trim().length < 80) {
          labelText = lab.innerText.trim();
          break;
        }
      }

      const entry = {
        id: inp.id || null,
        element: inp, // element ref since the input has no stable id
        label: labelText.replace(/\s*\*\s*$/, '').trim(),
        type: 'ashby-location-combobox',
        required: true,
        currentValue: inp.value || '',
        options: null,
        note:
          'caller: assign temp id, focus, use cdp typetext, then Ashby.pickLocationOption() to commit',
      };
      // Bypass the `push()` id-gate — element-only entries are still useful.
      if (entry.id && !seen.has(entry.id)) {
        seen.add(entry.id);
        result.push(entry);
      } else if (!entry.id) {
        result.push(entry);
      }
    }

    return result;
  };

  // ---------- main entry ----------

  /**
   * Ashby.fillForm(profile)
   *
   * Inventory the form fields and report what needs filling. Does NOT do the actual
   * typing for text fields — returns a `plan` array of {action, selector, value}
   * so the caller can choose between JS setVal (this file) and CDP typetext.
   *
   * The caller (Claude in SKILL.md) should iterate the plan:
   *   - action == "typetext" → run `node shared/cdp.mjs typetext $TAB <selector> <value>`
   *   - action == "yesno"    → run `Ashby.clickYesNo(uuid, answer)`
   *   - action == "select"   → run `await Ashby.pickSelect(fieldId, optionText)`
   *   - action == "date"     → run `Ashby.setDate(fieldId, mmddyyyy)`
   *   - action == "upload"   → run `node shared/cdp.mjs upload $TAB <selector> <path>`
   *
   * v0.2: also accepts the nested `profile.template.json` shape — auto-normalized
   * via `Ashby.normalizeProfile()` when `profile.personal` is present.
   */
  Ashby.fillForm = function (profile) {
    profile = profile || {};
    // v0.2: auto-normalize nested profiles. v0.1 flat profiles untouched.
    if (profile.personal && !profile.full_name && !profile.name) {
      profile = Ashby.normalizeProfile(profile);
    }
    const plan = [];

    // Name (combined)
    if ($('#_systemfield_name') && profile.full_name) {
      plan.push({
        action: 'typetext',
        selector: '#_systemfield_name',
        value: profile.full_name,
        label: 'Full Name',
      });
    }

    // Email
    if ($('#_systemfield_email') && profile.email) {
      plan.push({
        action: 'typetext',
        selector: '#_systemfield_email',
        value: profile.email,
        label: 'Email',
      });
    }

    // Resume upload
    if ($('#_systemfield_resume') && profile.resume_path) {
      plan.push({
        action: 'upload',
        selector: '#_systemfield_resume',
        value: profile.resume_path,
        label: 'Resume',
      });
    }

    // LinkedIn / website / phone — match by label heuristics (Ashby uses random ids per question)
    const textInputs = document.querySelectorAll(
      'input[type=text], input[type=email], input[type=tel], input[type=url], textarea'
    );
    for (const inp of textInputs) {
      if (!inp.id || inp.id.startsWith('_systemfield_')) continue;
      const label = labelTextFor(inp).toLowerCase();
      if (!label) continue;
      if (label.includes('linkedin') && profile.linkedin) {
        plan.push({
          action: 'typetext',
          selector: '#' + inp.id,
          value: profile.linkedin,
          label: 'LinkedIn',
        });
      } else if (
        (label.includes('phone') || label.includes('mobile')) &&
        profile.phone
      ) {
        plan.push({
          action: 'typetext',
          selector: '#' + inp.id,
          value: profile.phone,
          label: 'Phone',
        });
      } else if (
        (label.includes('website') || label.includes('portfolio')) &&
        profile.website
      ) {
        plan.push({
          action: 'typetext',
          selector: '#' + inp.id,
          value: profile.website,
          label: label,
        });
      } else if (label.includes('github') && profile.github) {
        plan.push({
          action: 'typetext',
          selector: '#' + inp.id,
          value: profile.github,
          label: 'GitHub',
        });
      }
    }

    // Yes/No questions — discover hidden checkboxes
    const yesNoCheckboxes = document.querySelectorAll(
      'input[type=checkbox][name]'
    );
    for (const cb of yesNoCheckboxes) {
      // a heuristic: yes/no widgets have a sibling/ancestor with two <button>Yes</button><button>No</button>
      let container = cb.parentElement;
      let yesBtn = null,
        noBtn = null;
      for (let i = 0; i < 6 && container && !yesBtn; i++) {
        const btns = container.querySelectorAll('button');
        for (const b of btns) {
          const t = b.innerText.trim();
          if (t === 'Yes') yesBtn = b;
          if (t === 'No') noBtn = b;
        }
        if (!yesBtn || !noBtn) container = container.parentElement;
      }
      if (yesBtn && noBtn) {
        const label = labelTextFor(cb).toLowerCase();
        const answer = guessYesNo(label, profile);
        if (answer) {
          plan.push({
            action: 'yesno',
            uuid: cb.name,
            value: answer,
            label: label || '(yesno)',
          });
        } else {
          plan.push({
            action: 'yesno',
            uuid: cb.name,
            value: null,
            label: label || '(yesno)',
            note: 'needs_manual_answer',
          });
        }
      }
    }

    // react-select pickers
    const controls = document.querySelectorAll('.select__control');
    for (const ctl of controls) {
      const hidden = ctl.querySelector('input[id]');
      if (!hidden) continue;
      const label = labelTextFor(hidden).toLowerCase();
      const answer = guessSelectAnswer(label, profile);
      if (answer) {
        plan.push({
          action: 'select',
          fieldId: hidden.id,
          value: answer,
          label: label,
        });
      } else {
        plan.push({
          action: 'select',
          fieldId: hidden.id,
          value: null,
          label: label,
          note: 'needs_manual_answer',
        });
      }
    }

    return { ok: true, plan };
  };

  // ---------- label / question heuristics ----------

  function labelTextFor(el) {
    if (!el) return '';
    if (el.id) {
      const lbl = document.querySelector('label[for="' + el.id + '"]');
      if (lbl) return lbl.innerText.trim();
    }
    // walk up to fieldset/div with legend or aria-label
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

  function guessYesNo(label, profile) {
    if (!label) return null;
    const p = profile.standard_answers || {};
    if (label.includes('visa') || label.includes('sponsorship'))
      return p.needs_visa_sponsorship || null;
    if (label.includes('authoriz')) return p.work_authorized || null;
    if (label.includes('18 years') || label.includes('age of 18'))
      return p.over_18 || 'Yes';
    if (label.includes('relocat')) return p.willing_to_relocate || null;
    if (label.includes('background check')) return p.background_check || 'Yes';
    return null;
  }

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
    return null;
  }

  // expose
  window.Ashby = Ashby;
  return Ashby;
})();
