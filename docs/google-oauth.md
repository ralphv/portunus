---
title: Google OAuth setup
nav_order: 4
---

# Google OAuth setup
{: .no_toc }

Every self-hoster creates their own Google OAuth client, once. It's free, and it
means your instance talks to Google as *your* app, not someone else's.

1. TOC
{:toc}

## Create the client

In the [Google Cloud Console](https://console.cloud.google.com/):

1. **Create a project** (or pick an existing one).
2. **Enable the Google Drive API**: APIs & Services → Library → "Google Drive
   API" → Enable.
3. **Configure the OAuth consent screen** (shown as *Google Auth Platform* in
   newer consoles): choose **External**, fill in an app name and your email.
   While the app is in *Testing*, add your own Google account under **Test
   users**.
4. **Create the client**: Credentials (or *Clients*) → Create OAuth client ID →
   application type **Web application**.
5. **Add the authorized redirect URI** — your `AUTH_URL` followed by
   `/api/auth/callback/google`:

   | Where you run it | Redirect URI |
   |---|---|
   | Same machine only | `http://localhost:3000/api/auth/callback/google` |
   | Your own domain | `https://vault.example.com/api/auth/callback/google` |

   You can list both. The URI has to match `AUTH_URL` exactly — scheme, host
   and port.
6. **Copy the client ID and client secret** into `AUTH_GOOGLE_ID` and
   `AUTH_GOOGLE_SECRET` (see [Install](install.md)).

## What Portunus asks for

At sign-in Portunus requests `openid email profile` and
`https://www.googleapis.com/auth/drive.file`. The `drive.file` scope grants
access only to files this app itself created, so Portunus cannot read the rest
of your Drive. Google lists `drive.file` as a
[non-sensitive scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Redirect URIs Google will refuse

Google's [redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation)
reject, among other things:

- **plain `http://`** — except `localhost`;
- **raw IP addresses**, such as `https://192.168.1.20` — except localhost IPs;
- **hostnames whose suffix isn't a public domain suffix**, such as
  `umbrel.local`, `nas.lan` or `vault.home`.

So `http://192.168.1.20:3000` and `http://umbrel.local:3000` can't be used,
even on your home network. You need a real HTTPS hostname —
[Running it over HTTPS](https.md) shows several ways to get one, including free
ones.

## "Testing" mode and the 7-day sign-in

While your consent screen's publishing status is **Testing**, Google
[issues refresh tokens that expire after 7 days](https://developers.google.com/identity/protocols/oauth2#expiration)
for any app that asks for more than name, email and profile — and Portunus
asks for `drive.file`. In practice, expect to be sent back through "Sign in with
Google" about once a week. Your vault is unaffected; it's just a fresh sign-in.

If that's annoying, set the publishing status to **In production** on the
consent screen. Google applies a lighter review to apps that request only
non-sensitive scopes, but check what the console asks of you when you switch.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Google shows `Error 400: redirect_uri_mismatch` | The redirect URI in the console doesn't exactly match `AUTH_URL` + `/api/auth/callback/google`. Check `http` vs `https`, the port, and any trailing slash. |
| Google shows "Access blocked" or says you're not a tester | The consent screen is in *Testing* and your account isn't listed under **Test users**. |
| You're asked to sign in again about once a week | The consent screen is in *Testing*; see above. |
| The container exits at startup with `Missing required environment variables` | One of `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`, `AUTH_URL` isn't set. |
