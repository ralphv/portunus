# Google OAuth setup

Each self-hoster creates their own Google OAuth client, once. Portunus uses it
to sign you in and to read and write its vault file in your Drive.

## Steps

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a
   project and enable the **Google Drive API**.
2. Go to **APIs & Services → OAuth consent screen** and configure it.
   **External** is fine for personal use; add yourself as a test user.
3. Go to **Credentials → Create OAuth client ID** and choose
   **Web application**.
4. Add the authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` for local use
   - `https://your-domain/api/auth/callback/google` when deployed
5. Copy the client ID and secret into your environment as `AUTH_GOOGLE_ID`
   and `AUTH_GOOGLE_SECRET` (see [Configuration](./configuration)).

The redirect URI's origin must match `AUTH_URL`. If you serve Portunus at
`https://vault.example.com`, the redirect URI is
`https://vault.example.com/api/auth/callback/google`.

## What Portunus asks Google for

The app requests only the `drive.file` scope
(`https://www.googleapis.com/auth/drive.file`). With it, Portunus can see only
the files it created, never the rest of your Drive. The vault is stored as
`portunus.vault.json` in a `Portunus Application` folder.

A compromised Portunus server can't silently widen that scope. Broadening it
would send you back through Google's consent screen.

## Troubleshooting

- **`redirect_uri_mismatch`**: the redirect URI registered in step 4 doesn't
  exactly match `AUTH_URL` + `/api/auth/callback/google`. Check the scheme
  (`http` vs `https`), host, and port.
- **"Access blocked" / app not verified**: while the consent screen is in
  testing, only the test users you added in step 2 can sign in.
- **No Google account handy?** Use [demo mode](./demo#run-the-demo-locally) to
  try the UI without one.
