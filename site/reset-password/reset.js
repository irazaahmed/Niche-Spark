// Completes a NicheSpark password reset: the emailed link lands here with ?token=…
(function () {
  var params = new URLSearchParams(location.search);
  var token = params.get('token');
  var form = document.getElementById('reset-form');
  var message = document.getElementById('reset-message');
  var button = document.getElementById('reset-submit');

  function show(text, ok) {
    message.textContent = text;
    message.className = ok ? 'reset-ok' : 'reset-error';
  }

  if (!token || params.get('error')) {
    form.hidden = true;
    show('This reset link is invalid or has expired. Open the NicheSpark extension and choose "Forgot password?" to get a new one.', false);
    return;
  }
  // Keep the token out of the address bar and browser history.
  history.replaceState(null, '', location.pathname);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var password = document.getElementById('new-password').value;
    var confirm = document.getElementById('confirm-password').value;
    if (password.length < 8) return show('Use a password of at least 8 characters.', false);
    if (password !== confirm) return show('The two passwords do not match.', false);
    button.disabled = true;
    show('Saving…', true);
    fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token, newPassword: password }),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) throw new Error(body.error || 'Could not reset your password.');
        });
      })
      .then(function () {
        form.hidden = true;
        show('Your password has been changed. Open the NicheSpark extension and sign in with your new password.', true);
      })
      .catch(function (err) {
        button.disabled = false;
        show(err.message, false);
      });
  });
})();
