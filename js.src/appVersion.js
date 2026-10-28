(() => {
  'use strict';

  // Cache-busting stamp for the vendored worker/wasm assets.
  //
  // vendor/libarchive/ and vendor/unrar/ ship at fixed, unhashed paths, so a
  // browser that cached them keeps using them across deploys. That is not a
  // soft failure: a stale worker against a newer wasm calls exports the binary
  // does not have, and it throws *after* the archive has opened and listed
  // successfully, which looks exactly like a corrupt archive and is very hard
  // to diagnose.
  //
  // Bump this whenever anything under vendor/ changes.
  // See vendor/libarchive/VERSION.md.
  window.VPS_APP_VERSION = '2026-08-26';
})();
