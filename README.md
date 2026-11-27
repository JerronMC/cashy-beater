# Cashy Beater 2.0.0 — update by DataRonn

A mobile-friendly Cashy tapping game with accounts, daily rewards, upgrades, ranks, account settings and a changelog.

## Deploy

1. Create a GitHub repository.
2. Upload all files in this ZIP directly to the repository root. This ZIP is intentionally flat and contains no folders.
3. Open **Settings → Pages** and publish from the `main` branch, `/ (root)`.
4. Open the HTTPS GitHub Pages URL. HTTPS is required for secure browser password hashing.

## Existing account and progress protection

- Version 2.0.0 adds new state fields (`boostLvl` and `luckyLvl`) with zero defaults. Existing balance, total earned, taps, upgrades, streaks, tasks, account name and password hash are retained.
- The update does not automatically delete or reset accounts or player progress.
- Local account password hashes are upgraded after a successful login where possible. The original progress record is retained during the upgrade.
- Players can export a JSON account-state backup from **Me → Account Security**. The backup does not include password hashes.
- The separate Economy Reset action is available only when the signed-in username is `Jerron` in local mode. It creates a local backup before resetting local game progress. It keeps usernames and password credentials. It does not affect the Firebase database.

## Version 2.0.0 features

- Stronger PBKDF2 password hashing for new/local accounts and a local login-attempt cooldown.
- Change password after confirming the current password (local mode).
- Jerron Owner title and owner panel.
- Local-only player ban/unban with day, month or year duration and reason.
- Local-only Cashy balance editing by username; total-earned leaderboard score is preserved.
- Local-only economy reset with automatic backup; user accounts remain.
- Cashy Multiplier and Lucky Aura shop upgrades.
- Changelog tab, rank labels, owner badge, sound effects and visual-effect preferences.
- Faster tap input and refreshed mobile UI.

## Important security limitations

This project is a static browser app. The current Firebase REST configuration does **not** provide a verified owner identity, secure password recovery, or server-side moderation. A username such as `Jerron` is not proof of ownership: a public user can register that name unless the backend reserves it securely.

For that reason, owner ban/unban, Cashy editing and economy reset are enabled only for the `Jerron` account in **local mode**. They are deliberately locked in online mode. Do not remove this lock by adding a client-side secret or checking only the username; those approaches are not secure.

Online account password reset requires a trusted recovery channel, such as Firebase Authentication with verified email, or a server-side recovery service. This update does not pretend that a password can be securely reset without one. Existing online credentials and progress are left unchanged.

The existing online database rules shown in older project instructions are not a secure production authorization system. Before running a public competitive game, migrate authentication to Firebase Authentication and move admin actions and score validation into trusted Cloud Functions or another authenticated backend. Use database rules that authorize users by authenticated UID and reserve the owner UID server-side.

## Files

`index.html` · `style.css` · `app.js` · `config.js` · `logo.svg` · `manifest.webmanifest` · `icon-192.png` · `icon-512.png` · `.nojekyll`
