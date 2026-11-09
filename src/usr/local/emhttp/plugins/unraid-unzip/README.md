**unraid-unzip**

Right-click any archive file in the File Manager and use **Extract here**, **Extract to...** or **List contents**.
Extraction runs as a background job with a progress view and a live log tail.

- **Formats:** zip, 7z, RAR (read), iso, jar, wim, apk, deb, rpm, dmg, img and (compressed) tarballs (`tar`, `gz`, `bz2`, `xz`, `zst`, `lz4`, `lzma`)
- **Passwords:** keep a list of saved passwords in Settings; they are tried automatically for encrypted archives
- **Excludes:** saved glob patterns (e.g. `__MACOSX/*`) are applied to every job
- **Overwrite policies:** ask, overwrite, skip, rename existing or rename new
- **Root folder handling:** automatic, always or never strip a single top-level folder
- **Notifications:** finished jobs are announced in the unRAID notification centre

No RAR creation, no archive creation - this plugin only extracts.
