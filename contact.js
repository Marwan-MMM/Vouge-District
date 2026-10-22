/* ==========================================================================
   VOGUE DISTRICT — CONTACT PAGE (contact.js)
   --------------------------------------------------------------------------
   Validates and wires #contact-form, then hands the message to
   VD.api.sendContactMessage() and shows ONE of three honest outcomes:

     • result.ok      → success panel ("Message sent" — the message really
                        reached the contact_messages table).
     • result.demo    → "Message sending isn't connected yet" panel. Demo
                        mode never fakes success: the visitor gets a clear
                        explanation plus a pre-filled mailto: fallback so
                        the message still reaches the store by email.
     • anything else  → an error note; the form stays filled and editable.

   Validation (client-side, matches the Supabase column checks):
     • name    — at least 2 characters
     • email   — simple pattern check
     • message — at least 10 characters
   ========================================================================== */

(function () {
  'use strict';

  window.VD = window.VD || {};
  window.VD.page = window.VD.page || {};

  /* Fallback to the config placeholder if config.js contact.email is blank. */
  function storeEmail() {
    var cfg = window.VOGUE_CONFIG || {};
    return (cfg.contact && cfg.contact.email) || 'hello@voguedistrict.example';
  }

  window.VD.page.init = function () {
    var form = document.getElementById('contact-form');
    if (!form) return;                                    // guard: wrong page / removed form

    var note = document.getElementById('contact-note');
    var submit = form.querySelector('button[type="submit"]');
    var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    /* --------------------------------------------------------------------
       Field validation helpers
       -------------------------------------------------------------------- */
    function setError(input, show) {
      var field = input.closest('.field');
      if (!field) return;
      var errorText = field.querySelector('.field__error');
      field.classList.toggle('field--error', show);
      if (errorText) errorText.hidden = !show;
    }

    function validators() {
      return {
        name: function (value) { return value.trim().length >= 2; },
        email: function (value) { return EMAIL_PATTERN.test(value.trim()); },
        message: function (value) { return value.trim().length >= 10; }
      };
    }

    function validateField(input) {
      var check = validators()[input.name];
      if (!check) return true;
      var valid = check(input.value || '');
      setError(input, !valid);
      return valid;
    }

    /* Clear a field's error as soon as the visitor edits it again. */
    ['name', 'email', 'message'].forEach(function (fieldName) {
      var input = form.elements[fieldName];
      if (input) input.addEventListener('input', function () { setError(input, false); });
    });

    /* --------------------------------------------------------------------
       Panels shown in place of the form after submit
       -------------------------------------------------------------------- */
    var PANEL_STYLE =
      'border: 1px solid var(--color-line); background: var(--color-cream);' +
      'padding: 2.5rem; max-width: 640px;';

    function buildPanel(innerTitle, bodyHTML, extraHTML) {
      var panel = document.createElement('div');
      panel.className = 'contact-result';
      panel.setAttribute('role', 'status');
      panel.style.cssText = PANEL_STYLE;
      panel.innerHTML =
        '<p class="eyebrow">Contact</p>' +
        '<h3 class="section__title" tabindex="-1">' + innerTitle + '</h3>' +
        '<div class="prose">' + bodyHTML + '</div>' +
        (extraHTML || '');
      return panel;
    }

    /* SUCCESS — the message really was stored. */
    function successPanel() {
      var panel = buildPanel(
        'Message sent',
        '<p>We usually reply within two business days.</p>'
      );
      panel.insertAdjacentHTML('beforeend',
        '<a class="button button--outline" href="shop.html">Continue shopping</a>');
      return panel;
    }

    /* DEMO MODE — never pretend the message was sent. Offer a pre-filled
       mailto: fallback so the visitor can still reach the store. */
    function mailtoHref(fields) {
      var subject = 'Vogue District website — ' + fields.subject;
      var body =
        'Name: ' + fields.name + '\n' +
        'Email: ' + fields.email + '\n' +
        'Subject: ' + fields.subject + '\n\n' +
        fields.message + '\n';
      return 'mailto:' + storeEmail() +
        '?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(body);
    }

    function demoPanel(fields) {
      var panel = buildPanel(
        'Message sending isn’t connected yet',
        '<p>This store is running in local demo mode — Supabase isn’t connected, ' +
          'so your message was <strong>not sent</strong> and nothing was stored. ' +
          'We won’t pretend otherwise.</p>' +
        '<p>To get your message to us right now, use the button below: it opens ' +
          'your own email app with everything you typed already filled in.</p>'
      );
      panel.insertAdjacentHTML('beforeend',
        '<p style="margin-top: 1.5rem;">' +
          '<a class="button button--dark" href="' + mailtoHref(fields) + '">Email us your message</a>' +
        '</p>' +
        '<p class="form-note form-note--info" style="margin-top: 1rem;">' +
          'Store owner: this form goes live as soon as you connect Supabase in ' +
          '<code>config.js</code> (messages are stored in the <code>contact_messages</code> ' +
          'table) — or point the submit handler at any email service. ' +
          'See README.md → Content pages.' +
        '</p>');
      return panel;
    }

    /* Move focus to the panel heading — the status change shouldn't be silent. */
    function swapInPanel(panel) {
      form.replaceWith(panel);
      var heading = panel.querySelector('h3');
      if (heading) heading.focus();
    }

    /* --------------------------------------------------------------------
       Submit
       -------------------------------------------------------------------- */
    form.addEventListener('submit', function (event) {
      event.preventDefault();

      /* Validate all fields; focus the first invalid one. */
      var fields = {
        name: form.elements.name.value,
        email: form.elements.email.value,
        subject: form.elements.subject.value,
        message: form.elements.message.value
      };

      var firstInvalid = null;
      ['name', 'email', 'message'].forEach(function (fieldName) {
        var input = form.elements[fieldName];
        if (!validateField(input) && !firstInvalid) firstInvalid = input;
      });
      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }

      /* Hand off to the data layer. */
      if (submit) { submit.disabled = true; submit.textContent = 'Sending…'; }
      if (note) { note.textContent = ''; note.className = 'form-note'; }

      window.VD.api.sendContactMessage(fields)
        .then(function (result) {
          if (result && result.ok) {
            swapInPanel(successPanel());
            window.VD.utils.toast('Message sent — thank you!', 'success');
            return;
          }
          if (result && result.demo) {
            swapInPanel(demoPanel(fields));
            return;
          }
          /* Real backend error — keep the form so nothing typed is lost. */
          if (note) {
            note.textContent = (result && result.message) ||
              'Something went wrong — please try again, or email us directly.';
            note.className = 'form-note form-note--error';
          }
        })
        .catch(function (err) {
          console.error('Vogue District: contact message failed.', err);
          if (note) {
            note.textContent = 'Something went wrong — please try again, or email us directly.';
            note.className = 'form-note form-note--error';
          }
        })
        .finally(function () {
          if (submit) { submit.disabled = false; submit.textContent = 'Send message'; }
        });
    });
  };
})();
