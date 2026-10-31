# Setup (about 15 minutes, once)

Three parts: put the app on GitHub Pages, connect a private Google Sheet, open it on both phones.

## 1. Put the app online (GitHub Pages)

1. On github.com, create a new repository, e.g. `household-budget` (public is fine: it contains no data and no keys).
2. Upload the contents of this folder (everything except `tests/screenshots`). The folder `apps-script` can go up too; it holds no secrets.
3. Repository **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, branch `main`, folder `/ (root)`. Save.
4. After a minute the app is at `https://<your-username>.github.io/household-budget/`.

## 2. Create the private Google Sheet and its sync script

1. In Google Drive (your account), create a new empty Google Sheet, e.g. "Household Budget data". Don't share it with anyone; the app talks to it through the script.
2. In the Sheet: **Extensions → Apps Script**. Delete the sample code, paste all of `apps-script/Code.gs`, and save (`Ctrl+S`).
3. Create the sync key: in the function list at the top choose **createKey**, click **Run**. Google asks for permission the first time (it's your own script: *Advanced → Go to … (unsafe) → Allow*). Open **Execution log**: it prints the key. Copy it somewhere safe (a password manager is ideal).
4. **Deploy → New deployment** → gear icon → **Web app**:
   - Description: `Household Budget sync`
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click **Deploy** and copy the **Web app URL** (ends in `/exec`).

   *"Anyone" means anyone can reach the URL, but every request without the right key is refused, and opening the URL in a browser shows no data.*

## 3. Connect both phones

On each phone (Chrome on Android):

1. Open the app's GitHub Pages address.
2. **Settings → This phone belongs to**: pick your name.
3. **Sync with Google Sheet**: paste the Web app URL and the sync key → **Test and save**.
4. Chrome menu → **Install app** (use Chrome, not another browser: only an installed app can receive shared Revolut statements).

The top-right chip shows "Synced 08:12" when all is well.

## Later: changing the script

If `Code.gs` changes in a future version: paste the new code, then **Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy**. The URL stays the same.

## If something goes wrong

- **"Wrong sync key"**: the key on the phone doesn't match the one in the script (Apps Script → Project Settings → Script properties → `APP_KEY`).
- **"APP_KEY is not set up"**: run `createKey` once (step 2.3).
- **HTTP 401/403 or a Google login page**: the deployment's access is not "Anyone"; edit the deployment.
