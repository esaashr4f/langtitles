# Setting up Google Drive backups (one time, by the developer)

Google needs every app that signs people in to have a **client ID**. Make one, put it in
`extension/background/drive.js` (`DEFAULT_CLIENT_ID`), and everyone using the published extension
can connect their Drive with one click. Until then, Drive backups work only for someone who pastes their own
client ID under Options → Backups → Advanced.

It's free, and the scope Langtitles asks for (`drive.file`, "only the files this app made") is one Google
classes as **non-sensitive**, so there is no security review or verification fee.

## Steps

1. Go to https://console.cloud.google.com/ and create a project (e.g. "Langtitles").
2. **APIs & Services → Library**: search for **Google Drive API** and click **Enable**.
3. **Google Auth Platform → Branding** (older consoles: "OAuth consent screen"):
   - App name: Langtitles. User support email and developer contact: your email.
   - App home page: https://github.com/esaashr4f/langtitles
   - Privacy policy: link to `PRIVACY.md` on GitHub (or wherever it's published).
4. **Audience**: User type **External**. Then click **Publish app** so its status is **In production**.
   While it says "Testing", only people you add as test users can sign in.
5. **Data access → Add or remove scopes**: add `https://www.googleapis.com/auth/drive.file`. Save.
6. **Clients → Create client**:
   - Application type: **Web application**. Name: Langtitles Firefox.
   - **Authorised redirect URIs**: add
     `https://77885ee350c86f916a7f8158047d7f77e7d205a8.extensions.allizom.org/`
     This is Firefox's redirect address for the add-on ID `langtitles@langtitles.local`. It changes if the
     ID changes, and Options → Backups → Advanced always shows the exact one for the installed copy.
     **Chrome** uses `https://<extension id>.chromiumapp.org/`: add that one to the same client too. The
     Chrome Web Store gives the extension its permanent ID when you first upload it; a copy loaded
     unpacked has a different ID (shown in Options → Backups → Advanced).
   - Create, then copy the **Client ID** (ends in `.apps.googleusercontent.com`). There's no need for the
     client secret: the extension never uses it.
7. Put the client ID in `extension/background/drive.js`:
   ```js
   const DEFAULT_CLIENT_ID = '1234567890-abc….apps.googleusercontent.com';
   ```
   A client ID is not a secret; it's fine in the public code.

Until Google reviews the branding, people may see a "Google hasn't verified this app" screen with an
**Advanced → Go to Langtitles** link. Submitting the branding for verification removes it, and is free for
non-sensitive scopes.

## Testing it yourself first

Without changing the code: Options → Backups → **Advanced: your own Google client ID**, paste the client ID,
then **Connect Google Drive**.
