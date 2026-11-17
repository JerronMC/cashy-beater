/*
  Cashy Beater config
  -------------------
  FIREBASE_URL = "" (empty)  ->  LOCAL MODE: accounts + leaderboard live only in this browser/device.
  FIREBASE_URL = "https://YOUR-PROJECT-default-rtdb.firebaseio.com"  ->  ONLINE MODE: real users
  worldwide share one live leaderboard (refreshes every 2 seconds). See README.md for the 3-minute setup.
*/
window.CASHY_CONFIG = {
  FIREBASE_URL: ""
};
