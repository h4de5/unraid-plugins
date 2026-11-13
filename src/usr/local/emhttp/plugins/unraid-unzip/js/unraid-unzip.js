/* global $, dfm, context */
/* unraid-unzip File Manager integration */
(function () {
  'use strict';

  function cfg() { return window.unraidUnzip || {}; }

  function isArchiveName(name) {
    if (!name) return false;
    var n = String(name).toLowerCase();
    // split volumes: foo.7z.001, foo.zip.002, foo.part1.rar, foo.r00
    if (/\.(7z|zip|rar|arc)(\.\d{3})?$/.test(n)) return true;
    if (/\.(part\d+\.rar|r\d{2})$/.test(n)) return true;
    // regular archive formats
    return /\.(zip|7z|rar|arc|iso|jar|tar|tgz|tbz|tbz2|txz|tzst|zst|gz|bz2|xz|lz4|lzma|cab|arj|lzh|wim|msi|apk|apks|aab|deb|rpm|dmg|img)$/.test(n);
  }

  // ---------- API ----------
  function api(action, payload) {
    var data = $.extend({ action: action }, payload || {});
    data.csrf_token = cfg().csrf || '';
    return $.ajax({
      url: cfg().api,
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      data: $.param(data, true),
      dataType: 'json',
      traditional: true
    });
  }

  function apiError(err) {
    if (err && err.status === 403) {
      return 'Session expired. Please reload the page and try again.';
    }
    if (err && err.responseJSON && err.responseJSON.error) {
      return err.responseJSON.error.message || err.responseJSON.error.code || 'Request failed';
    }
    if (err && err.responseText) {
      try {
        var parsed = JSON.parse(err.responseText);
        if (parsed.error) return parsed.error.message || parsed.error.code || 'Request failed';
      } catch (e) {}
    }
    return 'Request failed: ' + (err && err.statusText ? err.statusText : err);
  }

  // ---------- Context menu ----------
  function patchContextMenu() {
    if (typeof context === 'undefined' || !context.attach) return;
    var original = context.attach;
    context.attach = function (target, opts) {
      var $t = $(target);
      var id = (target || '').replace(/^#/, '');
      var rowId = id;
      if (/^name_/.test(id)) rowId = id.replace(/^name_/, 'row_');
      var $row = (rowId === id) ? $t : $('#' + rowId);
      var type = $row.attr('type');
      var data = ($row.attr('data') || '').replace(/&#34;/g, '"').trim();
      var isFile = type === 'f';
      var isDir = type === 'd';
      var busy = (typeof dfm !== 'undefined' && dfm.running) || opts.some ? opts.some(function (o) { return o.text === '_(Job running)_'; }) : false;

      if (!busy && isFile && isArchiveName(data)) {
        opts.push({ divider: true });
        opts.push({ text: 'Extract here', icon: 'fa-archive', action: function (e) { e.preventDefault(); doExtractHere(data); } });
        opts.push({ text: 'Extract to...', icon: 'fa-folder-open', action: function (e) { e.preventDefault(); doExtractTo(data); } });
        opts.push({ text: 'List contents', icon: 'fa-list', action: function (e) { e.preventDefault(); doListContents(data); } });
      }
      return original.call(context, target, opts);
    };
  }

  function currentDir() {
    if (typeof dfm !== 'undefined' && dfm.current) return dfm.current;
    var m = location.search.match(/dir=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '/';
  }

  // ---------- Dialogs ----------
  function overlay(html) {
    var $o = $('<div>').addClass('unraid-unzip-overlay');
    $o.append($('<div>').addClass('unraid-unzip-dialog').html(html));
    $('body').append($o);
    return $o;
  }

  function closeOverlay($o) { if ($o && $o.length) $o.remove(); }

  function showError(message, title) {
    var $o = overlay(
      '<h3>' + (title || 'Error') + '</h3>'
      + '<p class="unraid-unzip-msg">' + escapeHtml(message) + '</p>'
      + '<div class="unraid-unzip-buttons"><button class="unraid-unzip-primary" id="uuz_close">Close</button></div>'
    );
    $('#uuz_close', $o).on('click', function () { closeOverlay($o); });
    return $o;
  }

  // ---------- Extract ----------
  function doExtractHere(archive) {
    var policy = cfg().defaultOverwrite || 'ask';
    if (policy === 'ask') {
      doExtractTo(archive, true);
      return;
    }
    startExtract({
      archive: archive,
      target: currentDir(),
      overwrite: policy
    });
  }

  function doExtractTo(archive, isHere) {
    var dir = currentDir();
    var html = ''
      + '<h3>' + (isHere ? 'Extract here' : 'Extract to...') + '</h3>'
      + '<div class="unraid-unzip-form">'
      + '<label>Archive</label><div class="unraid-unzip-readonly">' + escapeHtml(archive) + '</div>'
       + '<label>Target directory</label><input type="text" id="uuz_extract_target" value="' + escapeHtml(dir) + '" placeholder="' + escapeHtml(dir) + '">'
      + '<label>Password</label><input type="password" id="uuz_extract_password" autocomplete="off" placeholder="(blank: try saved passwords)">'
      + '<label>Overwrite policy</label><select id="uuz_extract_overwrite">'
      + '<option value="ask">Ask per file (default)</option>'
      + '<option value="overwrite">Overwrite existing</option>'
      + '<option value="skip">Skip existing</option>'
      + '<option value="rename_existing">Rename existing</option>'
      + '<option value="rename_new">Rename new</option>'
      + '</select>'
      + '<label>Root folder</label><select id="uuz_extract_strip">'
      + '<option value="auto">Automatic (default)</option>'
      + '<option value="always">Always strip</option>'
      + '<option value="never">Never strip</option>'
      + '</select>'
      + '</div>'
      + '<div class="unraid-unzip-error" id="uuz_error"></div>'
      + '<div class="unraid-unzip-buttons">'
      + '<button type="button" class="unraid-unzip-primary" id="uuz_go">Start</button>'
      + '<button type="button" id="uuz_cancel">Cancel</button>'
      + '</div>';

    var $o = overlay(html);
    if (cfg().defaultOverwrite && cfg().defaultOverwrite !== 'ask') {
      $('#uuz_extract_overwrite', $o).val(cfg().defaultOverwrite);
    }
    if (cfg().stripRoot) {
      $('#uuz_extract_strip', $o).val(cfg().stripRoot);
    }
    $('#uuz_cancel', $o).on('click', function () { closeOverlay($o); });
    $('#uuz_go', $o).on('click', function () {
       var target = ($('#uuz_extract_target', $o).val() || '').trim() || dir;
      if (!target) {
        $('#uuz_error', $o).text('Please enter a target directory').show();
        return;
      }
      startExtract({
        archive: archive,
        target: target,
        password: $('#uuz_extract_password', $o).val() || '',
        overwrite: $('#uuz_extract_overwrite', $o).val(),
        strip_root: $('#uuz_extract_strip', $o).val()
      }, $o);
    });
  }

  function startExtract(payload, $keepOverlay) {
    api('start_extract', payload).then(function (res) {
      if (res.ok) {
        watchJob(res.data.id, $keepOverlay);
      } else {
        showStartError(res, payload, $keepOverlay);
      }
    }).catch(function (err) {
      showStartError({ error: { message: apiError(err) } }, payload, $keepOverlay);
    });
  }

  function showStartError(res, payload, $keepOverlay) {
    var msg = res && res.error ? res.error.message : 'Unknown error';
    if (res && res.error && res.error.code === 'PASSWORD_REQUIRED') {
      if ($keepOverlay) {
        $('#uuz_error', $keepOverlay).text('A password is required. Enter it and try again.').show();
        $('#uuz_extract_password', $keepOverlay).focus();
      } else {
        overlay('<h3>Password required</h3><p>' + escapeHtml(msg) + '</p><div class="unraid-unzip-buttons"><button class="unraid-unzip-primary" id="uuz_close">Close</button></div>')
          .find('#uuz_close').on('click', function (e) { closeOverlay($(e.target).closest('.unraid-unzip-overlay')); });
      }
      return;
    }
    if (res && res.data && res.data.suspicious && res.data.suspicious.length) {
      if ($keepOverlay) {
        $('#uuz_error', $keepOverlay).text('Suspicious paths detected: ' + res.data.suspicious.join(', ')).show();
      }
    }
    if ($keepOverlay) {
      $('#uuz_error', $keepOverlay).text(msg).show();
    } else {
      overlay('<h3>Could not start</h3><p>' + escapeHtml(msg) + '</p><div class="unraid-unzip-buttons"><button class="unraid-unzip-primary" id="uuz_close">Close</button></div>')
        .find('#uuz_close').on('click', function (e) { closeOverlay($(e.target).closest('.unraid-unzip-overlay')); });
    }
  }

  // ---------- List contents ----------
  function doListContents(archive) {
    var $o = overlay('<h3>Listing...</h3><div class="unraid-unzip-loading">Loading archive contents...</div>');
    api('list', { archive: archive }).then(function (res) {
      closeOverlay($o);
      if (!res.ok) {
        showError(res.error && res.error.message ? res.error.message : 'Unknown error');
        return;
      }
      var d = res.data || {};
      var rows = (d.entries || []).map(function (e) {
        return '<tr class="' + (e.folder ? 'uuz-folder' : '') + (e.encrypted ? ' uuz-encrypted' : '') + '"><td>' + escapeHtml(e.path) + '</td><td class="uuz-num">' + (e.folder ? '' : (e.size != null ? humanSize(e.size) : '')) + '</td><td>' + (e.encrypted ? 'locked' : '') + '</td></tr>';
      }).join('');
      var $o2 = overlay(
        '<h3>Archive contents</h3>'
        + '<p class="unraid-unzip-hint">' + escapeHtml(d.archive_type || '') + (d.encrypted ? ' (encrypted)' : '') + ' &middot; ' + (d.entries && d.entries.length) + ' entries' + (d.entries_truncated ? ' (truncated)' : '') + '</p>'
        + '<div class="unraid-unzip-list">'
        + '<table><thead><tr><th>Name</th><th>Size</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="3">Empty</td></tr>') + '</tbody></table>'
        + '</div>'
        + '<div class="unraid-unzip-buttons"><button class="unraid-unzip-primary" id="uuz_close">Close</button></div>'
      );
      $('#uuz_close', $o2).on('click', function () { closeOverlay($o2); });
    }).catch(function (err) {
      closeOverlay($o);
      overlay('<h3>Could not list</h3><p>' + escapeHtml(apiError(err)) + '</p>');
    });
  }

  // ---------- Progress ----------
  var _pollTimers = {};

  function watchJob(id, $keepOverlay) {
    var $o;
    if ($keepOverlay && $keepOverlay.length) {
      $o = $keepOverlay;
      $('.unraid-unzip-form', $o).remove();
      $('.unraid-unzip-buttons button:not(#uuz_cancel)', $o).remove();
    } else {
      $o = overlay(
        '<h3>Working...</h3>'
        + '<div class="unraid-unzip-progress"><div class="unraid-unzip-bar"></div></div>'
        + '<div class="unraid-unzip-phase">Starting...</div>'
        + '<pre class="unraid-unzip-log"></pre>'
        + '<div class="unraid-unzip-buttons"><button class="unraid-unzip-primary" id="uuz_cancel_job">Cancel</button></div>'
      );
    }

    function render(status, logTail) {
      var state = status.state || '';
      var percent = (status.percent != null) ? Math.max(0, Math.min(100, status.percent)) : null;
      var bar = $('.unraid-unzip-bar', $o);
      if (bar.length) {
        bar.css('width', (percent != null ? percent : 0) + '%');
        bar.toggleClass('indeterminate', percent == null);
      }
      $('.unraid-unzip-phase', $o).text(status.phase || state || '');
      $('.unraid-unzip-log', $o).text(logTail || '');
      var $log = $('.unraid-unzip-log', $o);
      $log.scrollTop($log[0] ? $log[0].scrollHeight : 0);

      if (state === 'done' || state === 'error' || state === 'cancelled') {
        stopPoll(id);
        var cls = state === 'done' ? 'uuz-done' : (state === 'cancelled' ? 'uuz-cancelled' : 'uuz-error');
        $('.unraid-unzip-phase', $o).addClass(cls).text(state + (status.message ? ': ' + status.message : ''));
        var $btn = $('<button>').addClass('unraid-unzip-primary').text('Close');
        $btn.on('click', function () { closeOverlay($o); });
        $('.unraid-unzip-buttons', $o).html('').append($btn);
        if (state === 'done' && (typeof dfm !== 'undefined')) {
          try { dfm.reload && dfm.reload(); } catch (e) {}
        }
      }
    }

    function poll() {
      api('status', { id: id }).then(function (res) {
        if (!res.ok) {
          render({ state: 'error', message: res.error && res.error.message || 'Lost job' }, '');
          stopPoll(id);
          return;
        }
        render(res.data.status || {}, res.data.log_tail || '');
      }).catch(function (err) {
        stopPoll(id);
        $('.unraid-unzip-phase', $o).addClass('uuz-error').text('Connection lost: ' + apiError(err));
        var $btn = $('<button>').addClass('unraid-unzip-primary').text('Close');
        $btn.on('click', function () { closeOverlay($o); });
        $('.unraid-unzip-buttons', $o).html('').append($btn);
      });
    }

    stopPoll(id);
    _pollTimers[id] = setInterval(poll, 1000);
    poll();

    var $cancel = $('#uuz_cancel_job', $o);
    if ($cancel.length) {
      $cancel.on('click', function () {
        api('cancel', { id: id }).then(function () {}).catch(function () {}).always(function () {
          $cancel.prop('disabled', true).text('Cancelling...');
        });
      });
    }
  }

  function stopPoll(id) {
    if (_pollTimers[id]) {
      clearInterval(_pollTimers[id]);
      delete _pollTimers[id];
    }
  }

  // ---------- Helpers ----------
  function humanSize(n) {
    if (n == null || isNaN(n)) return '';
    var units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Init ----------
  function init() {
    if (!document.querySelector('table.indexer')) return;
    if (typeof $ === 'undefined' || !$.fn) return;
    patchContextMenu();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
