# Home Medicine Tracker — setup and user guide

## What this app does

Home Medicine Tracker is an Android-installable Progressive Web App (PWA). It runs in Chrome, can be added to the Android home screen, and does not require Play Store publishing.

### Medicine fields

- **Medicine name** — required.
- **Ingredients** — required; enter one ingredient per line and the app displays them as bullets.
- **Quantity** — required; accepts zero or a positive number.
- **Opened date** — optional.
- **Expiry date** — required.
- **Image** — optional; images are resized/compressed before saving.
- **Notes** — optional.
- **Expiry reminders** — multiple offsets per medicine. Negative offsets are before expiry, `0` is the expiry date, and positive offsets are after expiry. Default reminders are `-2`, `-1`, `0`, and `+1` days.

Inventory features include search, All / Expiring soon / Expired filters, edit and delete, a 30-day warning count, local JSON backup export and import, and optional Google Drive synchronization.

## Important limits to understand

1. **This is a PWA, not a Play Store APK.** Once hosted over HTTPS, it can be installed on Android from Chrome's menu.
2. **Notifications are not guaranteed while Android has completely stopped the app.** The app checks due reminders when open, once per minute while running, and when it returns to the foreground. A reminder missed while the app is stopped will be shown when it next opens. For dependable alarms while the app is force-stopped, a native Android app or a server-side notification service would be needed.
3. **Keep your Google account safe.** This initial version syncs through the *same Google account* on every device, as requested. Sharing a personal Google account also shares access to that account's Gmail, photos and other services. Consider making a dedicated family Google account for this inventory rather than sharing your personal account password.
4. **The source code is hosted as a static site.** If you use a public GitHub Pages repository, the app's source code is public, but your medicine list is not placed in the repository. The inventory is stored in your browser and in a JSON file created in your Google Drive. Never put real medicine data in a GitHub file or commit.
5. **Sync requires internet access.** The local inventory can be used offline after the app has loaded at least once. Drive changes sync when connected and authorized. Reconnect Drive when the temporary Google access token expires.
6. **Avoid editing the Drive JSON file by hand** while using the app; let the app manage it. Use Export backup for a readable, portable backup.

---

# Part A — Publish the app free with GitHub Pages

You need a GitHub account. These instructions use GitHub Pages for hosting; the app source itself is a small static website.

1. Extract the ZIP file on a computer.
2. Open GitHub and create a new repository, for example `home-medicine-tracker`. For the simplest free GitHub Pages setup, set it to **Public**. The source code will therefore be publicly viewable; the medicine list is not stored in the repository.
3. In the repository, choose **Add file → Upload files**. Upload the *contents* of this folder so `index.html`, `app.js`, `styles.css`, `manifest.json`, `sw.js`, and `icons/` are at the repository root. Do not upload only the ZIP as a file.
4. Commit the files to the `main` branch.
5. Open **Settings → Pages**. Under build/deployment, select **Deploy from a branch**, choose branch `main` and folder `/(root)`, then save.
6. Wait for GitHub Pages to publish and open the displayed URL. It will look like `https://YOUR-USERNAME.github.io/home-medicine-tracker/`.
7. Check that the page loads and the title is Home Medicine Tracker. Keep this URL; you will use it on each family device.

GitHub Pages guide: https://docs.github.com/pages/getting-started-with-github-pages

# Part B — Configure Google Drive sync (one-time setup)

You need a Google Cloud project and a Web OAuth Client ID. This app does not need a client secret.

1. Open https://console.cloud.google.com/ and create a project, e.g. `Home Medicine Tracker`.
2. Select that project. Go to **APIs & Services → Library**, search for **Google Drive API**, and enable it.
3. Open **Google Auth Platform** (or **APIs & Services → OAuth consent screen** in the older console layout). Complete the app name, support email, audience and contact details.
4. For personal/family use, leave the app in **Testing** while you validate it, and add the Google account you plan to use as a test user. Since this version expects the *same account* on each device, you only need to authorize that account. If Google shows an unverified-app warning during testing, proceed only if you recognize your own project and the requested Google Drive file access.
5. Open **Google Auth Platform → Clients** (or **APIs & Services → Credentials → Create credentials → OAuth client ID**). Choose **Web application**.
6. Under **Authorized JavaScript origins**, add the origin only — no repository path and no trailing slash. Example: `https://YOUR-USERNAME.github.io`.
7. No redirect URI is needed for this implementation. Create the client and copy its Client ID; it ends with `.apps.googleusercontent.com`.
8. Open the published Home Medicine Tracker URL. Tap the gear icon → paste the Client ID → **Save Client ID** → **Connect / reconnect**.
9. In Google's account chooser, select the intended family inventory Google account and approve the requested access. The app uses the `drive.file` scope to create and update a single inventory JSON file, not to read every file in Drive.
10. Once connected, the app creates a file named `home-medicine-tracker.json` in that account's Google Drive. It stores the medicine records and any compressed medicine photos. The app can update this file when you add, edit or delete medicines.

Google reference: https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
Google Drive scope reference: https://developers.google.com/drive/api/guides/api-specific-auth

If Google reports an origin mismatch, compare the exact site origin shown in your browser with **Authorized JavaScript origins**. The origin is the protocol plus hostname; the repository subpath is not included there.

# Part C — Install it on your Android phone

Do this separately on every family device.

1. Open the published URL in **Google Chrome** on Android.
2. Open Chrome's three-dot menu.
3. Tap **Install app** if offered, or **Add to Home screen → Install**. The exact wording can vary by Chrome version.
4. Open the new Home Medicine Tracker icon from the home screen.
5. On the first device, configure the Client ID in Settings and connect the intended Google account as described in Part B.
6. On each other device, open the same URL, install the app, enter and save the same Client ID in Settings, then connect the **same Google account**. Tap **Sync now** if the list does not appear immediately.
7. Allow notifications when prompted, or open Settings → **Enable notifications**. On Android, also check **Settings → Apps → Chrome / Home Medicine Tracker → Notifications** and allow them. Disable battery restrictions for Chrome only if you understand the battery trade-off and reminders are not being checked reliably.

Chrome's install guidance: https://developer.chrome.com/blog/how_chrome_helps_users_install_the_apps_they_value

# Part D — Enter medicines and set multiple reminders

1. Tap **Add medicine**.
2. Enter the medicine name.
3. In Ingredients, enter one ingredient per line. For example:
   - Paracetamol 500 mg
   - Caffeine 30 mg
4. Enter quantity, expiry date, and optionally opened date, image and notes.
5. The default reminder offsets appear as four rows: **-2 days, -1 day, 0 days, +1 day**. Remove a row using ×, or enter a whole number (such as `-30`, `-7`, `3`) and tap **Add reminder** to add it.
6. Tap **Save medicine**. When Drive is connected, changes are synced automatically after the local save. You can also use **Sync now** in Settings.
7. Use the search bar or status filters to find medicines. Tap the pencil icon to edit; tap the delete icon to remove a medicine. Deletions are stored as sync tombstones so they propagate to connected devices.

## Reminder behaviour

- Each device must grant its own notification permission.
- `-2` means two calendar days before the expiry date; `0` means the expiry date; `+1` means one calendar day after expiry.
- The app checks at launch, when returning to the foreground, and every minute while it remains running. It deduplicates each reminder on each device.
- If Android stops the app for a long time, a notification may not appear at the exact scheduled time. Missed reminders are checked when the app is opened again. Do not rely on this first version for critical or time-sensitive medication administration.

## Data and backup

- The browser keeps a local copy for that device.
- Drive sync keeps one shared `home-medicine-tracker.json` file in the connected Google account. The app uses the same Google account and the same OAuth client ID on every device to locate it.
- **Export backup** downloads a JSON copy. Keep a copy somewhere secure. **Import backup** merges records using their IDs and last-update timestamps.
- If you clear browser data, the local copy may be removed; connect Drive and sync to restore it.
- The **Clear local inventory** button only clears that browser's local list; it deliberately does not delete the Drive copy.

## Troubleshooting

- **Connect Drive does nothing:** ensure the site is HTTPS, the Google client ID was saved, the Google Identity script has loaded, and pop-ups are allowed.
- **Origin mismatch:** add the base origin, for example `https://YOUR-USERNAME.github.io`, under Authorized JavaScript origins.
- **Access denied / app not configured:** ensure the Google Drive API is enabled and the account is on the OAuth test-user list.
- **Inventory differs across phones:** connect the same Google account and the same deployed app/client ID on both devices, then tap Sync now on each. Avoid editing on two devices at exactly the same time; this is a lightweight JSON sync, not a collaborative database.
- **Notifications do not appear:** check both Chrome/site notification permission and Android notification permission, open the app, and review battery optimization. Reminders while the app is closed are not guaranteed.
