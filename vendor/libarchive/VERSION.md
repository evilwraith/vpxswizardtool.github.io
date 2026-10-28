# Vendored libarchive.js

These files are copied from a fork's committed `dist/`. This repo has no build
step, so the fork's `dist/` is vendored directly rather than installed from npm.
Nothing here is generated locally.

| Field | Value |
|---|---|
| Source | `github.com/n-i-x/libarchivejs` (fork of `nika-begiashvili/libarchivejs`) |
| Pinned commit | `3eeb3ad366352550da9ae1ca3e1edaadbdf78aad` |
| Branch | `feat/workerfs-lazy-input` |
| Package version | `libarchive.js@2.0.2` |
| libarchive | 3.8.9 |
| Vendored | 2026-08-26 |

## Files

| File | sha256 |
|---|---|
| `libarchive.js` | `73975b2e913f29cf54d07f63661bf77b95156bb3493ce80f414cb332f014345f` |
| `worker-bundle.js` | `4abb991a2384ecbe14460a8e3e1a1d4dd3d859bc2ad929fc874c48e866a3183c` |
| `libarchive.wasm` | `2b050f848a55917dbddc05ae4157730b2452b60ec5e84f42362920853ae9d926` |

`LICENSE` is unchanged from upstream and is byte-identical to the version that
shipped with stock 2.0.2.

`libarchive.js` did **not** change in this bump — its sha256 is the same as it
was at `7c35a382`, and its git blob hash matches the fork's `dist/libarchive.js`
at the new commit exactly. Only the worker bundle and the wasm moved.

## Encrypted archives — what this build can and cannot do

Measured on 2026-08-26 against this exact wasm, using archives built with
WinRAR and 7-Zip holding 560 KB of real compressed payload. Every "yes" below
means the extracted bytes were sha256-compared against the original file and
matched. **The app started supplying passwords on 2026-08-27.**
`openArchiveUnlocked` in `js.src/uiHelper.js` reads them from the `vpxMagic`
VPX Password slots and tries each in turn against one open handle; the solid
RAR4 fallback in `extractRarEntries` takes the same list. Encrypted 7z is
refused in the app's own words rather than the engine's - see the 7z notes
below. Behaviour is pinned by `tests/archive-password.test.mjs`.

| Format | Encrypted | Listable without the password | Decrypts |
|---|---|---|---|
| ZIP | ZipCrypto (legacy) | yes | **yes** |
| ZIP | AES-256 (WinZip) | yes | **yes** |
| RAR4 | `-p` (data only) | no | **yes** |
| RAR4 | `-hp` (headers too) | no | **yes** |
| RAR5 | `-p` (data only) | no | **yes** |
| RAR5 | `-hp` (headers too) | no | **yes** |
| RAR5 | `-s -p` (solid + encrypted) | no | **yes** |
| 7z | AES-256 | yes | **NO** |
| 7z | AES-256 + `-mhe=on` | no | **NO** |

**RAR decryption arrived in the three commits between `7c35a382` and this one**
(`a067521` RAR5, `929574b` RAR4 data, `3eeb3ad` RAR4 headers). They add an
AES-CBC + PBKDF2-SHA256 cryptor to libarchive by patch. The previous pin refused
every encrypted RAR outright, which is why `vendor/unrar/` was the only way to
read one.

**7z encryption is not supported and no commit addresses it.** libarchive has
never decrypted 7-Zip. Do not plan around this changing.

What to know before writing any password UI. Measured 2026-08-26 and
substantially corrected and extended 2026-08-27 against WinRAR-built `-p` and
`-hp` archives in both RAR versions, plus 7-Zip AES-256 and ZipCrypto ZIPs:

- **A wrong password never yields wrong bytes.** Every wrong-password case
  raised an error. That is the property that matters here, and it was checked
  explicitly rather than assumed.
- **Where the "wrong password" answer comes from depends on the format, and
  most of them are clean.** Header-encrypted RAR (`-hp`, both versions) answers
  **at listing, from the header, decompressing nothing** — "Incorrect
  passphrase" on RAR5, "Incorrect passphrase or corrupt encrypted RAR4 header"
  on RAR4. Encrypted ZIP raises a clean "Incorrect passphrase" too, in **both**
  AES-256 and legacy ZipCrypto. **Only RAR `-p` is noisy**: its listing succeeds
  under any password at all, and the *extraction* fails with decompression
  garbage instead — "Invalid location to Huffman tree specified",
  "Unsupported block header size", "Block checksum error", "Truncated RAR file
  data". Never surface those verbatim.
  *(Corrected 2026-08-27. This bullet previously claimed clean errors came only
  from header-encrypted archives, which is wrong: encrypted ZIP is not
  header-encrypted and still answers cleanly.)*
- **NEVER probe a zero-byte entry, and never trust a single one.** An empty
  file has no bytes to decrypt, so it proves nothing either way — and on
  **RAR4 libarchive fails one outright with "Zero window size is invalid"
  even when the password is correct**. Found 2026-08-27 against a real table
  pack: it held a zero-byte placeholder, that entry sorted first, the probe
  picked it, and the app reported a wrong password while every other entry in
  the archive decrypted fine. RAR5 does not have this problem, which is what
  made it look format-specific rather than size-specific. `probeCandidates`
  in `js.src/uiHelper.js` now skips empty entries and returns the three
  smallest, and any one of them decrypting is enough; an archive with no
  probeable entry is treated as open rather than condemned on no evidence.
- **Validating a password is cheap, and the cost does not scale with archive
  size.** Probe the **smallest non-empty** entry rather than the one actually wanted — a
  32-byte entry settles it, and that is what makes `-p` archives a non-problem
  despite the noisy errors above: you report pass/fail from the probe and never
  show the string. Measured on a 0.38 MB archive: RAR4 `-hp` 36-47 ms, RAR5
  `-p` 63-71 ms, RAR4 `-p` 56-177 ms, ZIP AES-256 6-19 ms, ZIP ZipCrypto 3-8 ms.
- **One open archive accepts repeated `usePassword()` attempts — RAR included.**
  Verified by trying three passwords against a single handle and having the
  third accepted, with no re-open and no re-read. **Do not carry unrar's
  constraint across:** `node-unrar-js` fixes the password at
  `createExtractorFromData`, so a retry there genuinely is a fresh whole-file
  read. libarchive does not work that way. A note in this project asserted that
  it did, and trying a password list was written off as expensive on RAR on the
  strength of it; it is not.
- **Listing an encrypted RAR throws without a password** ("Passphrase required
  for this entry", or "… for encrypted RAR4 headers" / "… for this archive" on
  `-hp`), where the previous pin listed entry names happily and only failed at
  extraction. So a failed *listing* is the detect-a-password signal for RAR. ZIP
  headers stay readable, so use `hasEncryptedData()` there — it returned `true`
  correctly for every encrypted ZIP and RAR tested here. It is still **not**
  trustworthy for 7z, where it returns `false`.

### Solid RAR

`RAR5` solid archives read correctly, encrypted or not. **`RAR4` solid archives
are refused outright** with "RAR solid archive support unavailable".

That refusal is an improvement, not a regression: at `7c35a382` a solid RAR4
listed **one of its two entries and reported no error**, which is silent data
loss in a checksum tool. It now fails loudly. `vendor/unrar/` remains the only
engine here that reads solid RAR4.

## Why the fork rather than stock 2.0.2

Stock was replaced on 2026-08-24. Four things it did wrong, all verified against
the stock bundle before the swap rather than taken on trust:

1. **The whole archive was copied into wasm memory before anything was read.**
   Stock's `_loadFile` did `await file.arrayBuffer()` then `HEAPU8.set(...)`, so
   archive size was bounded by the wasm heap. The fork mounts the file with
   WORKERFS and opens it with `archive_read_open_filename`, reading only the
   blocks it needs. This is what lifts the ~2 GB ceiling on browsing and
   scanning archives.

2. **Entry reads could silently return garbage.** Stock ran
   `const p = getFileData(archive, size); if (p < 0) throw ...` and then
   `HEAPU8.slice(p, p + size)`. **The `< 0` guard itself worked** — `cwrap`
   binds `get_filedata` straight to the raw wasm export, and WebAssembly hands
   an `i32` back to JS as *signed*, so the C error branch (`return (void *)
   read_size`) really did arrive as a negative number. Verified empirically,
   not assumed. Two other paths bypassed the guard entirely:

   - **`malloc` was never NULL-checked.** A failed allocation returned 0, which
     is not `< 0`, so the slice read `size` bytes from heap offset 0.
   - **Short reads were ignored.** `archive_read_data` returns how many bytes it
     actually read; stock only tested that for being negative and then sliced
     the full entry size regardless, padding the tail with uninitialized
     `malloc` memory. This one needs no heap pressure at all.

   Either path yields right length, wrong bytes, and no error raised — a
   silently wrong MD5 in a tool whose whole job is checksums. The fork
   NULL-checks the allocation and reads through `readDataChunk` in a loop,
   returning `subarray(0, actual)` when an entry comes up short.

   *(Corrected 2026-08-25. The original note here claimed the pointer was
   unsigned so `p < 0` could never fire. That mechanism was wrong; the
   conclusion was right for the two reasons above.)*

3. **Entry sizes above 2^31 were truncated**, silently corrupting recorded
   metadata for large entries.

4. **libarchive 3.8.9 instead of 3.7.2**, which fixes a RAR4 decode bug that
   issue 2 was masking.

## Upgrading

Replace the three files from the fork's `dist/` at a specific commit, update the
table above, and re-run `npm test`. Keep `LICENSE`. Do not reformat or re-encode
the files: they ship LF and the repo's working tree is otherwise CRLF, so a
careless rewrite converts them (see the editing notes in `VPXS Architecture Map`
in the vault).

The worker and wasm are fetched at fixed, unhashed paths, so both loaders append
a `?v=` cache-busting query built from `APP_VERSION`. **Bump `APP_VERSION` in
`js.src/appVersion.js` whenever these files change** — a browser holding a cached
worker against a new wasm calls exports the binary does not have, and it fails in
a way that looks exactly like a corrupt archive.
