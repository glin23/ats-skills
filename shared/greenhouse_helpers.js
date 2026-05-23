/**
 * greenhouse_helpers.js — Pure JS helpers injected via `cdp.mjs eval` into a
 * Greenhouse application page. Exposes `globalThis.GH` with helpers for the
 * react-select v5 picker, intl-tel-input phone widget, text setter, resume
 * upload stub, submit lookup, and a `fillForm(profile)` entry point.
 *
 * Key facts (see feedback_ats_react_select_mousedown.md):
 *   - react-select v5 listens on `.select__control` mousedown (NOT click). Plain
 *     `el.click()` won't open the menu — must dispatch real MouseEvent series.
 *   - After each picker, dispatch Escape to close the menu, otherwise the next
 *     `querySelectorAll('.select__option')` returns stale options.
 *   - Greenhouse `#country` picker option text has a space: "United States +1".
 *     The intl-tel-input widget country listbox has no space: "Afghanistan+93".
 *   - Verify selected value via `.select__control.innerText`, NOT input.value
 *     (react-select stores the chosen label on the control, not the input).
 *   - Greenhouse text fields accept plain InputEvent dispatch — no `isTrusted`
 *     check (unlike Ashby's react-hook-form).
 *   - Resume upload cannot run from JS (no file-system access). Skill must call
 *     `cdp.mjs upload` after the form is otherwise filled.
 *
 * Never auto-submits. `findSubmit()` returns the button — caller decides.
 */

(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function dispatchMouseSeries(el) {
    if (!el) return false;
    ['mousedown', 'mouseup', 'click'].forEach((t) =>
      el.dispatchEvent(
        new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 })
      )
    );
    return true;
  }

  async function openPicker(fieldId) {
    const input = document.querySelector('#' + CSS.escape(fieldId));
    if (!input) return { ok: false, error: 'no input #' + fieldId };
    const ctl = input.closest('.select__control');
    if (!ctl) return { ok: false, error: 'no .select__control near #' + fieldId };
    // v0.2 fix #3: ensure picker is in viewport before opening.
    // React-select may not render `.select__option` if the control is
    // off-screen (observed on NiCE visa-sponsorship picker, 2026-05-23).
    try {
      ctl.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch (_) {
      ctl.scrollIntoView({ block: 'center' });
    }
    await sleep(200); // let layout settle before dispatching mousedown
    dispatchMouseSeries(ctl);
    // Poll for at least one .select__option to appear (extended to 3s in v0.2).
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (document.querySelector('.select__option')) return { ok: true };
      await sleep(50);
    }
    return { ok: false, error: 'menu did not open within 3000ms' };
  }

  async function pickOption(text) {
    if (text == null) return { ok: false, error: 'no text' };
    const target = String(text).trim().toLowerCase();
    // v0.2 fix #2: give React time to mount option list before polling, and
    // extend deadline from 1.5s -> 3s for slow renders (e.g. NiCE visa picker).
    await sleep(200);
    const deadline = Date.now() + 3000;
    let opts = [];
    while (Date.now() < deadline) {
      opts = Array.from(document.querySelectorAll('.select__option'));
      if (opts.length) break;
      await sleep(50);
    }
    if (!opts.length) return { ok: false, error: 'no .select__option visible' };
    // Prefer exact-trim match, fall back to substring.
    let match = opts.find((o) => (o.innerText || '').trim().toLowerCase() === target);
    if (!match) match = opts.find((o) => (o.innerText || '').trim().toLowerCase().includes(target));
    if (!match) {
      return {
        ok: false,
        error: 'no option matches "' + text + '"',
        available: opts.map((o) => o.innerText.trim()).slice(0, 12),
      };
    }
    dispatchMouseSeries(match);
    return { ok: true, picked: match.innerText.trim() };
  }

  function closeAllMenus() {
    const ev = () =>
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
      });
    if (document.activeElement && document.activeElement.dispatchEvent) {
      document.activeElement.dispatchEvent(ev());
    }
    document.body.dispatchEvent(ev());
    return true;
  }

  function verifyPicker(fieldId) {
    const input = document.querySelector('#' + CSS.escape(fieldId));
    if (!input) return null;
    const ctl = input.closest('.select__control');
    if (!ctl) return null;
    return (ctl.innerText || '').trim();
  }

  /**
   * prepareLocationCombobox(fieldId) — v0.3.
   *
   * Greenhouse `candidate-location` is NOT a normal react-select picker. It's a
   * Google Places API autocomplete wrapped in `.select__control` with an
   * `<input role="combobox">`. Dogfood (5/23 Twilio + EnergyHub) found:
   *   - JS setter + InputEvent: options never render (Google Places ignores it).
   *   - CDP Input.insertText (real keyboard): options STILL don't render on
   *     Greenhouse (works on Ashby's equivalent widget — TBD why).
   *
   * Since the working path requires real CDP `typetext` (which can't be invoked
   * from in-page JS), this helper just primes the input: scrolls it into view,
   * assigns a temp ID, focuses it, and returns a selector the caller can hand
   * to `node shared/cdp.mjs typetext <tab> <selector> <text>`.
   *
   * Caller flow:
   *   1) `GH.prepareLocationCombobox('candidate-location')` -> { ok, selector }
   *   2) `cdp typetext <tab> <selector> "<location text>"`
   *   3) sleep ~1.5s for Google Places debounce
   *   4) `GH.pickLocationOption("<location text>")` -> picks first matching option
   *      (or falls back to ArrowDown + Enter keyboard sim)
   */
  async function prepareLocationCombobox(fieldId) {
    const hidden = document.getElementById(fieldId);
    if (!hidden) return { ok: false, error: 'field not found: ' + fieldId };
    const ctl = hidden.closest('.select__control');
    if (!ctl) return { ok: false, error: 'no .select__control wrapper for ' + fieldId };
    const input = ctl.querySelector('input[role="combobox"]') || ctl.querySelector('input');
    if (!input) return { ok: false, error: 'no input inside .select__control' };
    try {
      ctl.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch (_) {
      ctl.scrollIntoView({ block: 'center' });
    }
    await sleep(300);
    // Assign a temp ID so caller can target it via CDP `typetext` regardless of
    // whatever ID react-select auto-generates (often `react-select-N-input`).
    const tempId = '__loc_' + Date.now();
    input.id = tempId;
    try {
      input.focus();
    } catch (_) {}
    // Also dispatch a mousedown on the control so react-select opens its
    // internal menu state — some Greenhouse builds require this before
    // accepting input.
    dispatchMouseSeries(ctl);
    await sleep(150);
    return {
      ok: true,
      selector: '#' + tempId,
      tempId,
      fieldId,
      instructions:
        'caller: 1) `cdp typetext <tab> #' +
        tempId +
        ' "<location text>"`; 2) wait ~1500ms; 3) `GH.pickLocationOption("<location text>")`',
    };
  }

  /**
   * pickLocationOption(text) — v0.3.
   *
   * Called AFTER caller has typed text via real CDP keyboard into the prepared
   * combobox. Polls for `.select__option` / `[role="option"]` up to 3s. If no
   * options appear, falls back to ArrowDown + Enter keyboard dispatch on the
   * active element (some Greenhouse builds keep the menu state but never paint
   * .select__option nodes — keyboard nav still commits the highlighted entry).
   *
   * Verifies success by reading `.select__single-value` (where react-select
   * writes the committed label after pick).
   */
  async function pickLocationOption(text) {
    const target = text == null ? '' : String(text).trim().toLowerCase();
    const tries = [];
    // Allow Google Places a moment to populate the menu after typing finished.
    await sleep(500);
    const deadline = Date.now() + 3000;
    let opts = [];
    while (Date.now() < deadline) {
      opts = Array.from(document.querySelectorAll('.select__option, [role="option"]'));
      if (opts.length) break;
      await sleep(100);
    }
    if (opts.length) {
      tries.push({ strategy: 'option-click', count: opts.length });
      let match = null;
      if (target) {
        match = opts.find((o) => (o.innerText || '').trim().toLowerCase() === target);
        if (!match) match = opts.find((o) => (o.innerText || '').trim().toLowerCase().includes(target));
      }
      if (!match) match = opts[0]; // Google Places: first option is usually best.
      dispatchMouseSeries(match);
      await sleep(400);
      const ctl = match.closest('.select__control') || document.activeElement?.closest('.select__control');
      const picked = ctl?.querySelector('.select__single-value')?.innerText?.trim();
      if (picked) {
        return { ok: true, picked, strategy: 'option-click', strategies_tried: tries };
      }
      // Pick didn't commit a single-value — fall through to keyboard fallback.
    } else {
      tries.push({ strategy: 'option-click', count: 0 });
    }

    // Fallback: ArrowDown + Enter on whatever element currently has focus.
    const focused = document.activeElement;
    if (focused) {
      const keyOpts = (key, keyCode) => ({
        key,
        code: key,
        keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true,
      });
      focused.dispatchEvent(new KeyboardEvent('keydown', keyOpts('ArrowDown', 40)));
      focused.dispatchEvent(new KeyboardEvent('keyup', keyOpts('ArrowDown', 40)));
      await sleep(300);
      focused.dispatchEvent(new KeyboardEvent('keydown', keyOpts('Enter', 13)));
      focused.dispatchEvent(new KeyboardEvent('keyup', keyOpts('Enter', 13)));
      await sleep(500);
      const ctl = focused.closest('.select__control');
      const picked = ctl?.querySelector('.select__single-value')?.innerText?.trim();
      tries.push({ strategy: 'keyboard-down-enter', picked: picked || null });
      if (picked) {
        return { ok: true, picked, strategy: 'keyboard-down-enter', strategies_tried: tries };
      }
    }

    return {
      ok: false,
      error: 'no options after 3s + keyboard fallback did not commit',
      strategies_tried: tries,
    };
  }

  function setText(fieldId, value) {
    const el = document.querySelector('#' + CSS.escape(fieldId));
    if (!el) return { ok: false, error: 'no #' + fieldId };
    const proto =
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, value == null ? '' : String(value));
    el.dispatchEvent(
      new InputEvent('input', { inputType: 'insertText', data: String(value ?? ''), bubbles: true })
    );
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: el.value };
  }

  async function setPhone(value, countryName) {
    // Greenhouse phone is intl-tel-input. Country picker is `.iti__selected-flag`.
    // iti listbox option text has NO space ("Afghanistan+93"), unlike Greenhouse's
    // own `#country` react-select (which uses "United States +1" with a space).
    if (countryName) {
      const flag = document.querySelector('.iti__selected-flag');
      if (flag) {
        flag.click();
        await sleep(150);
        const target = String(countryName).trim().toLowerCase();
        const opts = Array.from(document.querySelectorAll('.iti__country'));
        let match = opts.find((o) =>
          (o.innerText || '').trim().toLowerCase().startsWith(target)
        );
        if (!match) match = opts.find((o) => (o.innerText || '').trim().toLowerCase().includes(target));
        if (match) match.click();
        await sleep(100);
      }
    }
    const phoneInput =
      document.querySelector('input[type="tel"]') ||
      document.querySelector('#phone') ||
      document.querySelector('input[name*="phone" i]');
    if (!phoneInput) return { ok: false, error: 'no phone input' };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    phoneInput.focus();
    setter.call(phoneInput, value == null ? '' : String(value));
    phoneInput.dispatchEvent(
      new InputEvent('input', { inputType: 'insertText', data: String(value ?? ''), bubbles: true })
    );
    phoneInput.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: phoneInput.value };
  }

  function uploadResume(/* selector, filePath */) {
    // Resume upload requires file-system access. Caller must use
    // `node shared/cdp.mjs upload <tab> <selector> <filePath>` instead.
    return {
      ok: false,
      error:
        'uploadResume must be performed via cdp.mjs upload — JS cannot access the local filesystem',
    };
  }

  function findSubmit() {
    const candidates = [
      '#submit_app',
      'button#submit_app',
      'input[type="submit"][value*="Submit" i]',
      'button[type="submit"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        return { ok: true, selector: sel, text: (el.innerText || el.value || '').trim() };
      }
    }
    return { ok: false, error: 'no visible submit button' };
  }

  function checkSuccess() {
    const path = location.pathname || '';
    const body = document.body ? document.body.innerText || '' : '';
    const urlMatch = /confirmation/i.test(path);
    const textMatch = /thank you for applying|application has been submitted|application received/i.test(
      body
    );
    return { ok: urlMatch || textMatch, path, urlMatch, textMatch };
  }

  /**
   * normalizeProfile(raw) — v0.2.
   *
   * Takes the nested `profile.template.json` shape (raw.personal.first_name etc.)
   * and returns the flat shape `fillForm()` expects. v0.1 callers that already
   * pass a flat profile should still work — `fillForm` detects both shapes.
   *
   * Returns `null` if `raw` is falsy.
   */
  function normalizeProfile(raw) {
    if (!raw) return null;
    // If already flat (no nested `personal` block), pass through but add empty
    // custom_answers / picker_answers so downstream iteration is safe.
    if (!raw.personal && (raw.first_name || raw.email)) {
      return Object.assign(
        { custom_answers: {}, picker_answers: {} },
        raw,
        { _raw: raw }
      );
    }
    const personal = raw.personal || {};
    const auth = raw.work_authorization || {};
    return {
      first_name: personal.first_name,
      last_name: personal.last_name,
      email: personal.email,
      phone: personal.phone,
      phone_country: personal.phone_country_iti,
      linkedin_url: personal.linkedin,
      website_url: personal.portfolio,
      location_text: personal.city,
      // Greenhouse country picker uses "United States +1" with the space.
      country_label: personal.phone_country_greenhouse,
      // Per-company answers — skill orchestrator fills these.
      custom_answers: {},
      picker_answers: {},
      // Pass-through to original profile so callers (and Claude) can read
      // work_authorization, education, standard_qa, etc.
      _raw: raw,
    };
  }

  /**
   * findEmptyRequired() — v0.2.
   *
   * Returns every required-but-empty visible form field on the page, so a skill
   * orchestrator can hand the list to Claude for inference. Catches both:
   *   1) HTML `required` attribute on input/select/textarea
   *   2) Greenhouse's `<label>... *` asterisk convention (no `required` attr)
   *
   * For react-select v5 fields we report `type: 'react-select'` and the visible
   * placeholder. Enumerating the actual options requires opening the picker —
   * left to the caller.
   *
   * Returns: Array<{ id, label, type, required, currentValue, options }>
   */
  function findEmptyRequired() {
    const result = [];
    const seen = new Set();

    const pushReactSelect = (el, forId, labelText) => {
      const ctl = el.closest('.select__control');
      if (!ctl) return;
      const display = (ctl.innerText || '').trim();
      const empty = !display || display.toLowerCase().startsWith('select');
      if (!empty) return;
      // v0.3: detect Google Places autocomplete combobox (candidate-location and
      // similar). These need prepareLocationCombobox + cdp typetext, not the
      // normal openPicker / pickOption flow.
      const combo = ctl.querySelector('input[role="combobox"]');
      const isLocationCombobox =
        forId === 'candidate-location' ||
        (combo && (combo.getAttribute('aria-autocomplete') === 'list' ||
                   combo.getAttribute('autocomplete') === 'off')) ||
        (combo && !ctl.querySelector('.select__indicator'));
      result.push({
        id: forId,
        label: (labelText || '(no label)').replace(/\s*\*\s*$/, '').trim(),
        type: isLocationCombobox ? 'location-combobox' : 'react-select',
        required: true,
        currentValue: display,
        options: null,
      });
      seen.add(forId);
    };

    const pushTextLike = (el, forId, labelText) => {
      if (el.value) return;
      result.push({
        id: forId,
        label: (labelText || '(no label)').replace(/\s*\*\s*$/, '').trim(),
        type: el.type || el.tagName.toLowerCase(),
        required: true,
        currentValue: '',
        options: null,
      });
      seen.add(forId);
    };

    // 1) Standard `required` attribute sweep.
    const requiredEls = document.querySelectorAll(
      'input[required], select[required], textarea[required]'
    );
    for (const el of requiredEls) {
      if (el.type === 'hidden' && !el.closest('.select__control')) continue;
      if (!el.offsetParent && !el.closest('.select__control')) continue;
      const id = el.id;
      if (!id || seen.has(id)) continue;
      const labelEl = document.querySelector('label[for="' + id + '"]');
      const labelText = labelEl ? labelEl.innerText : '';
      if (el.closest('.select__control')) {
        pushReactSelect(el, id, labelText);
      } else {
        pushTextLike(el, id, labelText);
      }
    }

    // 2) Greenhouse asterisk-in-label convention. Many `question_NNNNN` fields
    //    are required but only signaled by a trailing '*' on the visible label.
    const labels = document.querySelectorAll('label');
    for (const lab of labels) {
      const labelText = lab.innerText || '';
      if (!labelText.includes('*')) continue;
      const forId = lab.getAttribute('for');
      if (!forId || seen.has(forId)) continue;
      const el = document.getElementById(forId);
      if (!el) continue;
      if (!el.offsetParent && !el.closest('.select__control')) continue;
      if (el.closest('.select__control')) {
        pushReactSelect(el, forId, labelText);
      } else {
        pushTextLike(el, forId, labelText);
      }
    }

    return result;
  }

  /**
   * fillForm(profile) — best-effort iteration over the form. The skill caller
   * should still inspect `pre_submit.png` and complement any field this misses
   * (Greenhouse forms vary by customer).
   *
   * profile shape (see profile.template.json):
   *   {
   *     first_name, last_name, email, phone, phone_country,
   *     linkedin_url, website_url, location_text,
   *     country_label,                            // e.g. "United States +1"
   *     custom_answers: { "<question substring>": "<answer text>" },
   *     picker_answers: { "<question substring>": "<option text>" }
   *   }
   *
   * v0.2: also accepts the nested `profile.template.json` shape — it is
   * auto-normalized via `normalizeProfile()` when `profile.personal` is present.
   */
  async function fillForm(profile) {
    if (!profile || typeof profile !== 'object') return { ok: false, error: 'profile required' };
    // v0.2: auto-normalize nested profiles. v0.1 flat profiles pass through untouched.
    if (profile.personal && !profile.first_name) {
      profile = normalizeProfile(profile);
    }
    const filled = [];
    const errors = [];

    // 1) Standard ID-based fields Greenhouse renders consistently.
    const idMap = {
      first_name: profile.first_name,
      last_name: profile.last_name,
      email: profile.email,
      job_application_answers_attributes_linkedin_profile: profile.linkedin_url,
      job_application_answers_attributes_website: profile.website_url,
    };
    for (const [id, val] of Object.entries(idMap)) {
      if (val == null) continue;
      const el = document.querySelector('#' + CSS.escape(id));
      if (!el) continue;
      const r = setText(id, val);
      if (r.ok) filled.push(id);
      else errors.push({ id, error: r.error });
    }

    // 2) Phone (intl-tel-input widget).
    if (profile.phone) {
      const r = await setPhone(profile.phone, profile.phone_country);
      if (r.ok) filled.push('phone');
      else errors.push({ id: 'phone', error: r.error });
    }

    // 3) Greenhouse `#country` picker (independent react-select with " +N" labels).
    if (profile.country_label) {
      const open = await openPicker('country');
      if (open.ok) {
        const picked = await pickOption(profile.country_label);
        if (picked.ok) filled.push('country=' + picked.picked);
        else errors.push({ id: 'country', error: picked.error, available: picked.available });
        closeAllMenus();
        await sleep(150);
      } else {
        errors.push({ id: 'country', error: open.error });
      }
    }

    // 4) Custom text questions — match by question label text.
    const labelEls = Array.from(document.querySelectorAll('label'));
    if (profile.custom_answers) {
      for (const [needle, answer] of Object.entries(profile.custom_answers)) {
        const n = needle.toLowerCase();
        const label = labelEls.find((l) => (l.innerText || '').toLowerCase().includes(n));
        if (!label) continue;
        const forId = label.getAttribute('for');
        if (!forId) continue;
        const el = document.getElementById(forId);
        if (!el) continue;
        // Skip react-select hidden inputs — picker_answers handles those.
        if (el.closest('.select__control')) continue;
        const r = setText(forId, answer);
        if (r.ok) filled.push('custom:' + needle);
        else errors.push({ id: forId, needle, error: r.error });
      }
    }

    // 5) Custom picker questions — match by question label, then open + pick.
    if (profile.picker_answers) {
      for (const [needle, optionText] of Object.entries(profile.picker_answers)) {
        const n = needle.toLowerCase();
        const label = labelEls.find((l) => (l.innerText || '').toLowerCase().includes(n));
        if (!label) continue;
        const forId = label.getAttribute('for');
        if (!forId) continue;
        const open = await openPicker(forId);
        if (!open.ok) {
          errors.push({ id: forId, needle, error: open.error });
          continue;
        }
        const picked = await pickOption(optionText);
        if (picked.ok) filled.push('picker:' + needle + '=' + picked.picked);
        else errors.push({ id: forId, needle, error: picked.error, available: picked.available });
        closeAllMenus();
        await sleep(150);
      }
    }

    return { ok: errors.length === 0, filled, errors };
  }

  globalThis.GH = {
    openPicker,
    pickOption,
    closeAllMenus,
    verifyPicker,
    setText,
    setPhone,
    uploadResume,
    findSubmit,
    fillForm,
    checkSuccess,
    // v0.2 additions
    normalizeProfile,
    findEmptyRequired,
    // v0.3 additions — Google Places candidate-location combobox
    prepareLocationCombobox,
    pickLocationOption,
  };

  return 'GH ready: ' + Object.keys(globalThis.GH).join(',');
})();
