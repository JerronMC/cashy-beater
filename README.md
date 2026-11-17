# Cashy Beater — by Dadasaves

Mobile-friendly tap-to-earn game with accounts, daily tasks, upgrades and a live leaderboard (refreshes every 2 seconds).
Reach **#1 → King Tier**. If someone passes you, you drop to **NineTNine Tier #N** (every rank number has its own tier).

## 1) Put it on GitHub Pages (2 minutes)

1. Create a new GitHub repo (e.g. `cashy-beater`).
2. Upload **all files from this folder** to the repo root (including `.nojekyll`).
3. Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → Save.
4. Your game goes live at `https://YOUR-USERNAME.github.io/cashy-beater/`.

At this point it works in **Local mode**: accounts and the leaderboard exist only inside each player's own browser.

## 2) Turn on REAL users + worldwide leaderboard (3 minutes, free)

GitHub Pages is static hosting, so a shared leaderboard needs a tiny free backend. This project uses Firebase Realtime Database through plain REST calls (no SDK, no build step).

1. Go to <https://console.firebase.google.com> → **Add project**.
2. **Build → Realtime Database → Create database** (pick any region, start in *locked mode*).
3. Open the **Rules** tab, paste the rules below, and **Publish**.
4. Copy the database URL shown at the top of the **Data** tab (looks like `https://YOUR-PROJECT-default-rtdb.firebaseio.com`).
5. Open `config.js`, paste it into `FIREBASE_URL`, commit. Done — every player now shares one leaderboard.

### Rules to paste

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "board": {
      ".read": true,
      "$k": {
        ".write": "newData.exists()",
        ".validate": "newData.hasChildren(['n','s','c','t']) && newData.child('n').isString() && newData.child('n').val().length <= 14 && newData.child('n').val().toLowerCase() === $k && newData.child('s').isNumber() && newData.child('s').val() >= 0"
      }
    },
    "users": {
      "$k": {
        ".read": true,
        ".write": "!data.exists()",
        "data": { ".write": "newData.exists()" }
      }
    }
  }
}
```

## Features

- Local account (username + password) with login / register, session remembered
- Earn Cashy by tapping, daily check-in streak, lucky box (every 2h), daily tap goal, 9 achievements
- Shop: Tap Power and Auto Earner upgrades
- Leaderboard refreshing every 2 seconds, ranked by total Cashy ever earned
- King Tier for #1, NineTNine Tier #N for everyone else; dethrone notifications
- Fullscreen button (iPhone Safari has no fullscreen API — use *Share → Add to Home Screen*)
- Installable as a PWA, safe-area aware, works on phones, tablets and desktop

## Honest limitations

- **No server-side validation.** Scores are computed in the player's browser, so a technical user could edit their own score. The rules above stop bad data shapes and account overwrites, but cannot stop forged scores. For a competitive public game, move scoring to a server (Cloud Functions / Supabase Edge Functions) later.
- Passwords are salted + PBKDF2-hashed in the browser before being stored, but with no real auth backend, treat this as a casual game login, not a secure one. Tell players not to reuse real passwords.
- The leaderboard downloads the whole `board` node every 2 seconds. That is fine for hundreds of players; beyond a few thousand, switch to a top-N query with an index.

## Files

`index.html` · `style.css` · `app.js` · `config.js` · `logo.svg` · `manifest.webmanifest` · `icon-192.png` · `icon-512.png` · `.nojekyll`
