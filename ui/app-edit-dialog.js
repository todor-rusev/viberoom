// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function(root) {
  'use strict';
  function markup() { return `    <form id="edit-form" method="dialog">
      <h3><span class="h-ico" data-icon="pencil"></span>Edit your message</h3>
      <p class="lead" id="ed-summary"></p>
      <div class="choice-list">
        <div class="choice"><span><strong>Notify vibemates</strong> — the message changes in place; the vibemates that read the old version are told.<button type="button" class="geek-tip" title="For geeks"><span data-icon="geek"></span>for geeks</button><span class="geek-text" hidden>The vibemates that already read the old version get a room event with the change and reply only if it matters to them. Cheap; their memory still holds the old wording.</span></span></div>
        <div class="choice"><span><strong>Rewrite from here</strong> — <span id="ed-rewrite-detail"></span> The vibemates that read the old version start over from this message.<button type="button" class="geek-tip" title="For geeks"><span data-icon="geek"></span>for geeks</button><span class="geek-text" hidden>Those vibemates restart with a fresh session and the conversation up to this message; they lose their working memory (tool results, reasoning). The removed messages are kept for you in <code>history.deleted.jsonl</code>.</span></span></div>
      </div>
      <p class="error" id="ed-error" hidden></p>
      <div class="actions">
        <button type="button" data-ui="button" data-kind="ghost" data-edit-close>Cancel</button>
        <button type="button" id="ed-rewrite" data-ui="button" data-kind="danger">Rewrite from here</button>
        <button type="button" id="ed-notify" data-ui="button" data-kind="primary" autofocus>Notify vibemates</button>
      </div>
    </form>
`; }
  function create(dialog, { window: view = dialog.ownerDocument.defaultView, signal, icon, editMessage, onRewritten, onError, openDialog, closeDialog } = {}) {
    signal?.throwIfAborted(); const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let request = null, visit = 0, pending = false, disposed = false;
    dialog.innerHTML = markup(); dialog.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); });
    const find = selector => dialog.querySelector(selector), summary = find('#ed-summary'), detail = find('#ed-rewrite-detail'), error = find('#ed-error'), notify = find('#ed-notify'), rewrite = find('#ed-rewrite');
    const active = entered => !disposed && !signal?.aborted && entered === visit && dialog.open && !dialog.classList.contains('closing');
    async function submit(mode, silent = false) {
      if (!request || pending || disposed) return;
      const entered = visit, value = request; pending = true;
      try { const result = await editMessage(value.room, value.messageId, value.next, mode);
        if (disposed || signal?.aborted) return;
        if (mode === 'rewrite') onRewritten(result);
        if (active(entered)) closeDialog(dialog);
      } catch (failure) {
        if (active(entered)) { error.textContent = failure.message; error.hidden = false; }
        else if (silent && !disposed && entered === visit) onError(failure);
      } finally { pending = false; }
    }
    function open(room, messageId, next, preview) {
      if (disposed) return false;
      ++visit; request = { room: JSON.parse(JSON.stringify(room)), messageId, next }; error.hidden = true;
      const nobodySaw = preview.restart.length === 0 && preview.offline.length === 0;
      if (preview.laterRecords === 0 && nobodySaw) { void submit('notify', true); return true; }
      const later = preview.laterMessages === 0 ? 'No chat messages follow it' : `${preview.laterMessages} chat message${preview.laterMessages > 1 ? 's' : ''} follow${preview.laterMessages > 1 ? '' : 's'} it`;
      const saw = preview.restart.length ? `Vibemates that already read it: ${preview.restart.join(', ')}.` : 'No online vibemate has read it yet.';
      const off = preview.offline.length ? ` Offline with the old version: ${preview.offline.join(', ')} (a rewrite makes them replay the new history when they reconnect).` : '';
      summary.textContent = `${later}. ${saw}${off}`;
      detail.textContent = preview.laterMessages ? `removes the ${preview.laterMessages} later chat message${preview.laterMessages > 1 ? 's' : ''} (and ${preview.laterRecords - preview.laterMessages} room event${preview.laterRecords - preview.laterMessages === 1 ? '' : 's'}).` : 'nothing to remove after it.';
      rewrite.textContent = preview.restart.length ? `Rewrite from here (restart ${preview.restart.join(', ')})` : 'Rewrite from here';
      openDialog(dialog); notify.focus(); return true;
    }
    owner.on(notify, 'click', () => void submit('notify')); owner.on(rewrite, 'click', () => void submit('rewrite'));
    owner.on(find('[data-edit-close]'), 'click', () => closeDialog(dialog)); owner.on(dialog, 'close', () => { ++visit; request = null; });
    function dispose() { if(disposed) return; disposed = true; ++visit; request = null; owner.dispose(); if(dialog.open) closeDialog(dialog); }
    if(signal) owner.on(signal,'abort',dispose,{once:true});
    return Object.freeze({open,dispose});
  }
  Object.defineProperty(create,'disposable',{value:true}); Object.defineProperty(create,'scoped',{value:true});
  root.VIBEROOM_EDIT_DIALOG = Object.freeze({markup,create});
})(typeof window !== 'undefined' ? window : globalThis);
