/**
 * lever_helpers.js — Pure JS helpers injected via `cdp.mjs eval` into a Lever
 * (`jobs.lever.co/<company>/<uuid>/apply`) application page. Exposes
 * `globalThis.Lever` with helpers for the Lever form quirks 用户 learned the
 * hard way on his 2026-05-13 Palantir submission attempt:
 *
 * KEY GOTCHAS (learned the hard way — first attempt FAILED):
 *
 *   1. `#selected-location` must be assigned a **JSON-encoded** string, not the
 *      plain location text. Setting `el.value = "Boston, MA, USA"` causes
 *      submit to throw `SyntaxError: Unexpected token B in JSON at position 0`.
 *      The correct value is `JSON.stringify({name: "Boston, MA, USA"})`.
 *
 *   2. After a failed submit, Lever **rolls back** the resume file AND the
 *      `#selected-location` value. You must re-upload + re-set BOTH before
 *      attempting submit again. Other text fields stay filled.
 *
 *   3. Resume upload completion is signaled by the hidden
 *      `input[name=resumeStorageId]` field gaining a non-empty value (the
 *      backend storage ID). This takes ~1-2s after the file lands in the
 *      hidden file input. Submitting before then = silent failure / rollback.
 *
 *   4. There's a hidden template
 *      `<div class="resume-upload-oversize">File exceeds the maximum upload
 *      size of 100MB...</div>` (plus a generic `.error-message`) baked into
 *      every Lever page. Its `.innerText` matches "File exceeds ... 100MB"
 *      even when no error occurred. The only reliable "is this error actually
 *      shown?" check is `offsetParent !== null`. `isErrorMessageVisible()`
 *      additionally suppresses any oversize/100MB text whenever the visible
 *      `resume-upload-success` state is present, because that combination is
 *      the benign template, not a real rejection (see GOTCHA #6).
 *
 *   5. Upload via CDP `DOM.setFileInputFiles` into the hidden
 *      `<input type="file" name="resume">` (`cdp.mjs upload`). This is the
 *      reliable path — CDP fires the native `change` event, Lever's handler
 *      runs, and the file uploads. Do NOT simulate `drop` events on the zone.
 *
 *   6. The upload is a TWO-STEP ASYNC flow and is SLOW. After the file lands
 *      in the input, Lever POSTs it to its backend and only then writes the
 *      `resumeStorageId`. Observed latency on live boards (ekimetrics,
 *      field-ai, pyka, 2026-05-28) is ~4–8 s, sometimes exceeding 5 s. The
 *      old 5 s default timeout for `waitForResumeStorageId` could fire BEFORE
 *      the storage ID landed; the caller then misread the hidden oversize
 *      template (GOTCHA #4) as a real "File exceeds 100MB" rejection and
 *      skipped a perfectly good row. There is no real size rejection on a
 *      ~116 KB PDF. The fix: wait generously (default now 15 s) and verify the
 *      upload by the VISIBLE success state via `verifyResumeUploaded()`, never
 *      by the presence of the hidden oversize template.
 *
 * Also shares the Greenhouse react-select v5 mousedown trio for any
 * `.select__control` pickers on the form (commitment / role-specific
 * questions). Same pattern as `greenhouse_helpers.js` — see that file for the
 * full discussion.
 *
 * Never auto-submits. `findSubmit()` returns the button; caller decides.
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

  /**
   * setText(fieldId, value) — standard text setter using prototype value setter
   * + InputEvent. Works for Lever's plain text/email/url inputs.
   */
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

  /**
   * setSelectedLocation(locationText) — GOTCHA #1.
   *
   * Lever's hidden `#selected-location` input expects a **JSON-encoded** object
   * of shape `{name: "<location>"}`. Setting the plain text directly causes
   * submit to throw `SyntaxError: Unexpected token B in JSON at position 0`.
   *
   * After a failed submit (GOTCHA #2), Lever wipes this field — call this
   * helper again before retrying.
   */
  function setSelectedLocation(locationText) {
    const el = document.querySelector('#selected-location');
    if (!el) return { ok: false, error: 'no #selected-location' };
    if (locationText == null || locationText === '') {
      return { ok: false, error: 'locationText required' };
    }
    const json = JSON.stringify({ name: String(locationText) });
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, json);
    el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: json, bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: el.value, parsed: { name: locationText } };
  }

  /**
   * waitForResumeStorageId(timeoutMs?) — GOTCHA #3.
   *
   * After `cdp.mjs upload` drops the file into Lever's hidden file input, the
   * backend asynchronously assigns a storage ID and writes it to a hidden
   * `<input name="resumeStorageId">`. Until that field is non-empty, submit
   * will silently roll back the upload (GOTCHA #2). Poll for it before
   * proceeding.
   *
   * Returns: { ok, storageId } | { ok: false, error, waited_ms }
   */
  async function waitForResumeStorageId(timeoutMs) {
    // Default 45 s: live Lever boards take ~4–8 s on a fast form but up to
    // ~35 s on a slow one (everbridge, measured 2026-05-28) to assign the
    // backend storage ID (GOTCHA #6). The previous 5 s default raced the
    // backend and produced spurious "100MB" skips; even 15 s was too short on
    // slow forms, so the default is now 45 s.
    const budget = timeoutMs ?? 45000;
    const deadline = Date.now() + budget;
    const started = Date.now();
    while (Date.now() < deadline) {
      const el = document.querySelector('input[name="resumeStorageId"]');
      if (el && el.value && el.value.trim() !== '') {
        return { ok: true, storageId: el.value, waited_ms: Date.now() - started };
      }
      await sleep(150);
    }
    return {
      ok: false,
      error: 'resumeStorageId did not populate within ' + budget + 'ms',
      waited_ms: Date.now() - started,
    };
  }

  /**
   * verifyResumeUploaded() — GOTCHA #6 helper. The AUTHORITATIVE upload check.
   *
   * Confirms the resume actually attached, using only signals Lever shows on a
   * real success — never the hidden oversize/100MB template (GOTCHA #4):
   *   - `input[name="resumeStorageId"]` has a non-empty backend value, AND/OR
   *   - the visible `.resume-upload-success` ("Success!") label is shown, AND
   *   - the upload button carries the `has-file` class (shows the filename).
   *
   * Returns: { ok, storageId, successVisible, hasFile, fileName }
   */
  function verifyResumeUploaded() {
    const storage = document.querySelector('input[name="resumeStorageId"]');
    const storageId = storage && storage.value ? storage.value.trim() : '';

    const successEl = document.querySelector('.resume-upload-success');
    const successVisible = !!(successEl && successEl.offsetParent !== null);

    const btn = document.querySelector('.visible-resume-upload, [class*="resume-upload"][class*="has-file"]');
    const hasFile = !!(
      (btn && /\bhas-file\b/.test(btn.className)) ||
      document.querySelector('.has-file')
    );

    const fileInput = document.querySelector('input[name="resume"][type="file"], #resume-upload-input');
    const fileName =
      fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0].name : null;

    // Authoritative: a backend storage ID, or the visible success + has-file
    // pair. Either alone is strong; both is conclusive.
    const ok = storageId !== '' || (successVisible && hasFile);
    return { ok, storageId: storageId || null, successVisible, hasFile, fileName };
  }

  /**
   * isErrorMessageVisible() — GOTCHA #4 helper.
   *
   * Every Lever page has a hidden `<div class="error-message">File exceeds
   * 100MB</div>` template. Text-match alone gives false positives. Only count
   * an error element as truly visible if its `offsetParent !== null` (i.e.
   * not display:none + not detached).
   *
   * Returns: { visible: bool, messages: string[] }
   */
  function isErrorMessageVisible() {
    // GOTCHA #6: when the resume upload succeeded, ignore any "File exceeds
    // ... 100MB" / oversize text. That string lives in a baked-in template
    // (`.resume-upload-oversize`) that is never display:none in some themes,
    // so it can read as "visible" even on a clean success. A ~116 KB PDF is
    // never a real size rejection, so treat that specific message as benign
    // whenever the visible success state is present.
    const uploadOk = verifyResumeUploaded().ok;
    const OVERSIZE_RE = /exceeds .*(maximum|100\s*mb)|100\s*mb/i;

    const els = Array.from(document.querySelectorAll('.error-message, .error, [class*="error" i]'));
    const messages = [];
    let visible = false;
    for (const el of els) {
      if (el.offsetParent === null) continue;
      const txt = (el.innerText || '').trim();
      if (!txt) continue;
      // Suppress the benign oversize/100MB template once the upload is good.
      const isOversize =
        OVERSIZE_RE.test(txt) || /\bresume-upload-oversize\b/.test(el.className);
      if (isOversize && uploadOk) continue;
      visible = true;
      messages.push(txt);
    }
    return { visible, messages };
  }

  // --- react-select v5 picker (same as Greenhouse) -------------------------

  async function openPicker(fieldId) {
    const input = document.querySelector('#' + CSS.escape(fieldId));
    if (!input) return { ok: false, error: 'no input #' + fieldId };
    const ctl = input.closest('.select__control');
    if (!ctl) return { ok: false, error: 'no .select__control near #' + fieldId };
    try {
      ctl.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch (_) {
      ctl.scrollIntoView({ block: 'center' });
    }
    await sleep(200);
    dispatchMouseSeries(ctl);
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
    await sleep(200);
    const deadline = Date.now() + 3000;
    let opts = [];
    while (Date.now() < deadline) {
      opts = Array.from(document.querySelectorAll('.select__option'));
      if (opts.length) break;
      await sleep(50);
    }
    if (!opts.length) return { ok: false, error: 'no .select__option visible' };
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

  /**
   * pickSelect(fieldId, optionText) — open + pick + close in one call.
   * Convenience for the most common picker pattern.
   */
  async function pickSelect(fieldId, optionText) {
    const open = await openPicker(fieldId);
    if (!open.ok) return open;
    const picked = await pickOption(optionText);
    closeAllMenus();
    await sleep(150);
    return picked;
  }

  // --- form discovery -----------------------------------------------------

  /**
   * findSubmit() — locate the visible submit button.
   *
   * Lever's standard markup is `<button data-qa="btn-submit">Submit application</button>`
   * but customers can theme the page; we try a few selectors.
   */
  function findSubmit() {
    const candidates = [
      'button[data-qa="btn-submit"]',
      'button#btn-submit',
      '#btn-submit',
      'button[type="submit"]',
      'input[type="submit"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        return { ok: true, selector: sel, text: (el.innerText || el.value || '').trim() };
      }
    }
    return { ok: false, error: 'no visible submit button' };
  }

  /**
   * findEmptyRequired() — return every required-but-empty visible form field.
   * Catches:
   *   1) HTML `required` attribute on input/select/textarea
   *   2) Lever's `<label>... ✱` / `*` asterisk convention
   *
   * For react-select v5 fields we report `type: 'react-select'`. Enumerating
   * the actual options requires opening the picker (left to caller).
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
      result.push({
        id: forId,
        label: (labelText || '(no label)').replace(/\s*[\*✱]\s*$/, '').trim(),
        type: 'react-select',
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
        label: (labelText || '(no label)').replace(/\s*[\*✱]\s*$/, '').trim(),
        type: el.type || el.tagName.toLowerCase(),
        required: true,
        currentValue: '',
        options: null,
      });
      seen.add(forId);
    };

    // 1) HTML `required` sweep.
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

    // 2) Asterisk convention sweep ('*' or '✱').
    const labels = document.querySelectorAll('label');
    for (const lab of labels) {
      const labelText = lab.innerText || '';
      if (!labelText.includes('*') && !labelText.includes('✱')) continue;
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

    // 3) Lever custom "card" questions (radios / native selects / text). These
    // use `name="cards[uuid][fieldN]"` and frequently have NO label[for=id]
    // association, so sweeps 1–2 miss them. Scan each `.application-question`
    // marked required (✱ / *) and report the first unfilled control with its
    // options so the caller can answer it. (This was the 2026-05-28 gap that
    // forced manual radio-filling on everbridge/ekimetrics.)
    for (const q of document.querySelectorAll('.application-question')) {
      if (!q.offsetParent) continue;
      const labEl = q.querySelector('.application-label, label');
      const labelText = (labEl && labEl.innerText) || '';
      if (!labelText.includes('*') && !labelText.includes('✱')) continue;
      const cleanLabel = labelText.replace(/\s*[\*✱]\s*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
      const radios = [...q.querySelectorAll('input[type=radio]')];
      const checkboxes = [...q.querySelectorAll('input[type=checkbox]')];
      const selects = [...q.querySelectorAll('select')];
      const texts = [...q.querySelectorAll('input[type=text], input[type=url], input[type=email], textarea')];
      const optLabel = (inp) => ((inp.closest('label') && inp.closest('label').innerText) || inp.value || '').replace(/\s+/g, ' ').trim();
      if (radios.length) {
        const name = radios[0].name;
        if (seen.has(name) || radios.some((r) => r.checked)) continue;
        result.push({ id: name, label: cleanLabel, type: 'radio', required: true, currentValue: '', options: radios.map((r) => ({ value: r.value, text: optLabel(r) })) });
        seen.add(name);
      } else if (selects.length) {
        const sel = selects[0];
        const cur = (sel.options[sel.selectedIndex] || {}).text || '';
        if (seen.has(sel.name || sel.id) || (sel.value && !/^(select|choose)/i.test(cur))) continue;
        result.push({ id: sel.name || sel.id, label: cleanLabel, type: 'select', required: true, currentValue: '', options: [...sel.options].map((o) => o.text) });
        seen.add(sel.name || sel.id);
      } else if (checkboxes.length) {
        const name = checkboxes[0].name;
        if (seen.has(name) || checkboxes.some((c) => c.checked)) continue;
        result.push({ id: name, label: cleanLabel, type: 'checkbox', required: true, currentValue: '', options: checkboxes.map((c) => ({ value: c.value, text: optLabel(c) })) });
        seen.add(name);
      } else if (texts.length) {
        const t = texts[0];
        if (seen.has(t.name || t.id) || (t.value || '').trim()) continue;
        result.push({ id: t.name || t.id, label: cleanLabel, type: t.tagName === 'TEXTAREA' ? 'textarea' : 'text', required: true, currentValue: '', options: null });
        seen.add(t.name || t.id);
      }
    }

    return result;
  }

  /**
   * checkSuccess() — Lever's standard success state is a redirect to
   * `/<company>/<uuid>/thanks` and a body containing "Thanks for applying"
   * / "Your application has been submitted".
   */
  function checkSuccess() {
    const path = location.pathname || '';
    const body = document.body ? document.body.innerText || '' : '';
    const urlMatch = /\/thanks(\/|$)/i.test(path) || /thank-you/i.test(path);
    const textMatch = /thanks for applying|application has been (submitted|received)|your application has been/i.test(
      body
    );
    return { ok: urlMatch || textMatch, path, urlMatch, textMatch };
  }

  /**
   * normalizeProfile(raw) — accept nested `profile.template.json` shape and
   * return the flat shape `fillForm()` expects. v0.1 callers that already pass
   * a flat profile pass through unchanged.
   */
  function normalizeProfile(raw) {
    if (!raw) return null;
    if (!raw.personal && (raw.first_name || raw.email)) {
      return Object.assign(
        { custom_answers: {}, picker_answers: {} },
        raw,
        { _raw: raw }
      );
    }
    const personal = raw.personal || {};
    return {
      first_name: personal.first_name,
      last_name: personal.last_name,
      full_name:
        personal.full_name ||
        [personal.first_name, personal.last_name].filter(Boolean).join(' '),
      email: personal.email,
      phone: personal.phone,
      linkedin_url: personal.linkedin,
      website_url: personal.portfolio,
      github_url: personal.github,
      location_text: personal.city,
      custom_answers: {},
      picker_answers: {},
      _raw: raw,
    };
  }

  /**
   * fillForm(profile) — best-effort iteration over the Lever form. The skill
   * caller should still inspect `pre_submit.png` and complement any field this
   * misses (Lever forms vary by customer).
   *
   * Returns: { ok, filled, errors, plan }
   *   - `plan` is the ordered sequence of actions taken (for debugging).
   */
  async function fillForm(profile) {
    if (!profile || typeof profile !== 'object') return { ok: false, error: 'profile required' };
    if (profile.personal && !profile.first_name && !profile.full_name) {
      profile = normalizeProfile(profile);
    }
    const filled = [];
    const errors = [];
    const plan = [];

    // 1) Standard Lever ID fields.
    // Lever uses `name` attrs but query convention is `#<name>`. We pass both
    // `full_name` (Lever's preferred single-field) and split first/last (used
    // by some custom Lever forms).
    const idMap = {
      // Lever's standard input names (which become IDs in their default theme):
      name: profile.full_name,
      email: profile.email,
      phone: profile.phone,
      org: profile.current_company,
      // URLs (Lever's three default link fields):
      urls__LinkedIn: profile.linkedin_url,
      urls__GitHub: profile.github_url,
      urls__Portfolio: profile.website_url,
      // Some customer themes also expose split first/last name fields.
      'first-name': profile.first_name,
      'last-name': profile.last_name,
    };
    for (const [id, val] of Object.entries(idMap)) {
      if (val == null) continue;
      const el = document.querySelector('#' + CSS.escape(id));
      if (!el) continue;
      const r = setText(id, val);
      if (r.ok) {
        filled.push(id);
        plan.push({ step: 'setText', id, value_len: String(val).length });
      } else {
        errors.push({ id, error: r.error });
      }
    }

    // 2) Location — GOTCHA #1: must be JSON.
    if (profile.location_text) {
      const r = setSelectedLocation(profile.location_text);
      if (r.ok) {
        filled.push('selected-location');
        plan.push({ step: 'setSelectedLocation', value: profile.location_text });
      } else {
        errors.push({ id: 'selected-location', error: r.error });
      }
    }

    // 3) Custom text questions — match by visible label text.
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
        if (el.closest('.select__control')) continue; // picker_answers handles these
        const r = setText(forId, answer);
        if (r.ok) {
          filled.push('custom:' + needle);
          plan.push({ step: 'setText', id: forId, needle });
        } else {
          errors.push({ id: forId, needle, error: r.error });
        }
      }
    }

    // 4) Custom picker questions — match by label, then open + pick.
    if (profile.picker_answers) {
      for (const [needle, optionText] of Object.entries(profile.picker_answers)) {
        const n = needle.toLowerCase();
        const label = labelEls.find((l) => (l.innerText || '').toLowerCase().includes(n));
        if (!label) continue;
        const forId = label.getAttribute('for');
        if (!forId) continue;
        const picked = await pickSelect(forId, optionText);
        if (picked.ok) {
          filled.push('picker:' + needle + '=' + picked.picked);
          plan.push({ step: 'pickSelect', id: forId, needle, picked: picked.picked });
        } else {
          errors.push({
            id: forId,
            needle,
            error: picked.error,
            available: picked.available,
          });
        }
      }
    }

    return { ok: errors.length === 0, filled, errors, plan };
  }

  /**
   * fillCardField(nameOrId, value) — reliably answer a Lever custom "card"
   * field (the kind findEmptyRequired sweep #3 reports). Handles the three
   * shapes that broke manual filling on 2026-05-28:
   *   - radio / checkbox: clicks the matching <label> (React-safe; a bare
   *     input.click()+native-setter was silently reverted on some forms),
   *     matching `value` against the option value OR its visible label text.
   *   - native <select>: sets the option whose text or value matches.
   *   - text / textarea: native value setter + input/change events.
   * `value` is matched case-insensitively as a substring for radios/selects.
   */
  function fillCardField(nameOrId, value) {
    const sel = '[name="' + nameOrId + '"]';
    const nodes = [...document.querySelectorAll(sel)].length
      ? [...document.querySelectorAll(sel)]
      : (document.getElementById(nameOrId) ? [document.getElementById(nameOrId)] : []);
    if (!nodes.length) return { ok: false, note: 'field_not_found', field: nameOrId };
    const want = String(value);
    const rx = new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const first = nodes[0];

    if (first.type === 'radio' || first.type === 'checkbox') {
      const optText = (i) => ((i.closest('label') && i.closest('label').innerText) || i.value || '').replace(/\s+/g, ' ').trim();
      const match = nodes.find((i) => rx.test(i.value || '') || rx.test(optText(i)))
        || nodes.find((i) => optText(i).toLowerCase() === want.toLowerCase());
      if (!match) return { ok: false, note: 'no_matching_option', field: nameOrId, options: nodes.map(optText) };
      const lbl = match.closest('label') || document.querySelector('label[for="' + match.id + '"]');
      if (lbl && lbl.click) lbl.click(); else match.click();
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
      if (desc && desc.set) desc.set.call(match, true);
      match.dispatchEvent(new Event('input', { bubbles: true }));
      match.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: match.checked, picked: optText(match), via: 'label_click' };
    }

    if (first.tagName === 'SELECT') {
      const opt = [...first.options].find((o) => o.text.trim().toLowerCase() === want.toLowerCase())
        || [...first.options].find((o) => rx.test(o.text) || rx.test(o.value));
      if (!opt) return { ok: false, note: 'no_matching_option', field: nameOrId, options: [...first.options].map((o) => o.text) };
      first.value = opt.value;
      first.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: first.value === opt.value, picked: opt.text };
    }

    // text / textarea
    const proto = first.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(first, want); else first.value = want;
    first.dispatchEvent(new Event('input', { bubbles: true }));
    first.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: !!first.value, mode: 'text_fill' };
  }

  globalThis.Lever = {
    // Lever-specific
    setSelectedLocation,
    waitForResumeStorageId,
    verifyResumeUploaded,
    isErrorMessageVisible,
    // Standard helpers
    setText,
    openPicker,
    pickOption,
    pickSelect,
    closeAllMenus,
    findSubmit,
    findEmptyRequired,
    fillCardField,
    checkSuccess,
    normalizeProfile,
    fillForm,
  };

  return 'Lever ready: ' + Object.keys(globalThis.Lever).join(',');
})();
