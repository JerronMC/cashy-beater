
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");

const DATABASE_URL =
  "https://rofiles-8f18b-default-rtdb.firebaseio.com";

// IMPORTANT: Replace this with Jerron's Firebase Authentication UID.
const OWNER_UID = "knPIohtfryOIWkCibWtqO8yxAzx2";

initializeApp({ databaseURL: DATABASE_URL });
setGlobalOptions({ region: "asia-southeast1" });

const db = getDatabase();

function fail(code, message) {
  throw new HttpsError(code, message);
}

function getUid(request) {
  if (!request.auth) fail("unauthenticated", "Please sign in.");
  return request.auth.uid;
}

function ownerOnly(request) {
  const uid = getUid(request);

  if (uid !== OWNER_UID) {
    fail("permission-denied", "Owner permission required.");
  }

  return uid;
}

function cleanText(value, max = 100) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function int(value, max = 1000000000) {
  const n = Number(value);

  if (!Number.isFinite(n) || n < 0 || n > max) {
    fail("invalid-argument", "Invalid amount.");
  }

  return Math.floor(n);
}

function titleFor(level) {
  if (level >= 100) return "Cashy Legend";
  if (level >= 50) return "Cashy Master";
  if (level >= 25) return "Cashy Pro";
  if (level >= 10) return "Beater";
  if (level >= 5) return "Rising Beater";
  return "Rookie";
}

function normalizePlayer(player, uid) {
  player.cashy = Math.max(0, Number(player.cashy) || 0);
  player.xp = Math.max(0, Number(player.xp) || 0);

  player.level = Math.floor(player.xp / 100) + 1;

  player.title =
    uid === OWNER_UID
      ? "Jerron · Owner"
      : cleanText(player.customTitle, 32) || titleFor(player.level);

  const badges = [];

  if (uid === OWNER_UID) badges.push("OWNER");
  if (player.level >= 5) badges.push("LEVEL 5");
  if (player.level >= 10) badges.push("LEVEL 10");
  if (player.level >= 25) badges.push("LEVEL 25");
  if (player.level >= 50) badges.push("LEVEL 50");
  if (player.level >= 100) badges.push("LEVEL 100");

  if (Array.isArray(player.extraBadges)) {
    badges.push(
      ...player.extraBadges
        .map(x => cleanText(x, 24))
        .filter(Boolean)
    );
  }

  player.badges = [...new Set(badges)].slice(0, 12);

  player.redeemedCodes = player.redeemedCodes || {};

  return player;
}

function publicPlayer(player) {
  return {
    displayName: player.displayName,
    cashy: player.cashy,
    xp: player.xp,
    level: player.level,
    title: player.title,
    badges: player.badges || []
  };
}

async function syncPublicProfile(uid, player) {
  await db.ref("publicProfiles/" + uid).set({
    ...publicPlayer(player),
    updatedAt: Date.now()
  });
}

async function ensureProfile(uid, displayName) {
  const ref = db.ref("players/" + uid);

  await ref.transaction(current => {
    if (current) return current;

    return {
      displayName: cleanText(displayName, 24) || "Player",
      cashy: 0,
      xp: 0,
      createdAt: Date.now(),
      redeemedCodes: {},
      extraBadges: {}
    };
  });

  const snapshot = await ref.get();
  const player = normalizePlayer(snapshot.val(), uid);

  if (
    player.ban &&
    player.ban.active &&
    (!player.ban.until || player.ban.until > Date.now())
  ) {
    fail("permission-denied", "Your account is banned.");
  }

  if (player.ban && player.ban.active) {
    player.ban.active = false;
  }

  await ref.set(player);
  await syncPublicProfile(uid, player);

  return player;
}

async function updatePlayer(uid, change) {
  const ref = db.ref("players/" + uid);

  const result = await ref.transaction(current => {
    if (!current) return;

    const updated = change(current);
    return normalizePlayer(updated, uid);
  });

  if (!result.committed) {
    fail("failed-precondition", "Player update failed.");
  }

  const player = result.snapshot.val();

  await syncPublicProfile(uid, player);

  return player;
}

// --------------------------------------------------
// PLAYER PROFILE AND ROLE
// --------------------------------------------------

exports.ensurePlayer = onCall(async request => {
  const uid = getUid(request);

  const player = await ensureProfile(
    uid,
    request.data?.displayName || request.auth.token.name
  );

  return publicPlayer(player);
});

exports.getMyRole = onCall(async request => {
  const uid = getUid(request);

  return {
    owner: uid === OWNER_UID,
    title: uid === OWNER_UID ? "Jerron · Owner" : "Player"
  };
});

// --------------------------------------------------
// LEVELS, RANKS AND BADGES
// 100 XP = 1 level
// --------------------------------------------------

// --------------------------------------------------
// NORMAL, RARE AND GOLD CRATES
// Rewards are guaranteed, not random.
// --------------------------------------------------

const CRATES = {
  normal: {
    cost: 100,
    cashy: 140,
    xp: 25
  },

  rare: {
    cost: 500,
    cashy: 850,
    xp: 100
  },

  gold: {
    cost: 2500,
    cashy: 5000,
    xp: 500
  }
};

exports.openCrate = onCall(async request => {
  const uid = getUid(request);

  await ensureProfile(uid, request.auth.token.name);

  const tier = cleanText(request.data?.tier, 10).toLowerCase();
  const crate = CRATES[tier];

  if (!crate) fail("invalid-argument", "Unknown crate.");

  let insufficient = false;

  const player = await (async () => {
    const result = await db.ref("players/" + uid).transaction(current => {
      if (!current) return;

      if (Number(current.cashy || 0) < crate.cost) {
        insufficient = true;
        return;
      }

      current.cashy -= crate.cost;
      current.cashy += crate.cashy;
      current.xp = Number(current.xp || 0) + crate.xp;

      return normalizePlayer(current, uid);
    });

    if (!result.committed) {
      fail(
        "failed-precondition",
        insufficient ? "Not enough Cashy." : "Crate purchase failed."
      );
    }

    return result.snapshot.val();
  })();

  await syncPublicProfile(uid, player);

  return {
    crate: tier,
    cost: crate.cost,
    reward: {
      cashy: crate.cashy,
      xp: crate.xp
    },
    player: publicPlayer(player)
  };
});

// --------------------------------------------------
// OWNER: CREATE REDEEM CODE
//
// expiresAt: 0 = never
// maxUses: 0 = unlimited
// One redemption per player.
// --------------------------------------------------

exports.ownerCreateCode = onCall(async request => {
  const uid = ownerOnly(request);

  const code = cleanText(request.data?.code, 32).toUpperCase();

  if (!/^[A-Z0-9_-]{4,32}$/.test(code)) {
    fail("invalid-argument", "Invalid redeem code.");
  }

  const expiresAt = int(request.data?.expiresAt || 0, 9999999999999);
  const maxUses = int(request.data?.maxUses || 0, 1000000);

  if (expiresAt && expiresAt <= Date.now()) {
    fail("invalid-argument", "Expiration must be in the future.");
  }

  const rewardInput = request.data?.reward || {};

  const reward = {
    cashy: int(rewardInput.cashy || 0),
    xp: int(rewardInput.xp || 0, 10000000)
  };

  if (!reward.cashy && !reward.xp) {
    fail("invalid-argument", "The code needs a reward.");
  }

  const ref = db.ref("redeemCodes/" + code);

  const result = await ref.transaction(current => {
    if (current) return;

    return {
      code,
      createdBy: uid,
      createdAt: Date.now(),
      expiresAt,
      maxUses,
      uses: 0,
      reward,
      redeemedBy: {}
    };
  });

  if (!result.committed) {
    fail("already-exists", "This redeem code already exists.");
  }

  return {
    success: true,
    code,
    expiresAt: expiresAt || "Never",
    maxUses: maxUses || "Unlimited",
    reward
  };
});

// --------------------------------------------------
// PLAYER: REDEEM CODE
// --------------------------------------------------

exports.redeemCode = onCall(async request => {
  const uid = getUid(request);

  await ensureProfile(uid, request.auth.token.name);

  const code = cleanText(request.data?.code, 32).toUpperCase();

  if (!/^[A-Z0-9_-]{4,32}$/.test(code)) {
    fail("invalid-argument", "Invalid code.");
  }

  const ref = db.ref("redeemCodes/" + code);

  let denial = "";

  const claim = await ref.transaction(current => {
    denial = "";

    if (!current) {
      denial = "Redeem code not found.";
      return;
    }

    const redeemedBy = current.redeemedBy || {};

    // Allow a retry if the previous reward operation was interrupted.
    if (redeemedBy[uid]) return current;

    if (current.expiresAt && current.expiresAt <= Date.now()) {
      denial = "This code has expired.";
      return;
    }

    if (
      current.maxUses > 0 &&
      current.uses >= current.maxUses
    ) {
      denial = "This code has reached its usage limit.";
      return;
    }

    current.redeemedBy = redeemedBy;
    current.redeemedBy[uid] = true;
    current.uses = (current.uses || 0) + 1;

    return current;
  });

  if (denial) fail("failed-precondition", denial);

  if (!claim.committed) {
    fail("failed-precondition", "Could not redeem code.");
  }

  const reward = claim.snapshot.val().reward || {};
  let alreadyRedeemed = false;

  const playerResult = await db.ref("players/" + uid).transaction(current => {
    if (!current) return;

    current.redeemedCodes = current.redeemedCodes || {};

    if (current.redeemedCodes[code]) {
      alreadyRedeemed = true;
      return current;
    }

    current.cashy =
      Number(current.cashy || 0) + Number(reward.cashy || 0);

    current.xp =
      Number(current.xp || 0) + Number(reward.xp || 0);

    current.redeemedCodes[code] = true;

    return normalizePlayer(current, uid);
  });

  if (!playerResult.committed) {
    fail("internal", "Reward processing failed. Try redeeming again.");
  }

  const player = playerResult.snapshot.val();

  await syncPublicProfile(uid, player);

  return {
    success: true,
    alreadyRedeemed,
    reward: alreadyRedeemed ? null : reward,
    player: publicPlayer(player)
  };
});

// --------------------------------------------------
// OWNER: SET PLAYER CASHY, XP, TITLE AND BADGES
// targetUid must be a Firebase Authentication UID.
// --------------------------------------------------

exports.ownerSetPlayer = onCall(async request => {
  ownerOnly(request);

  const targetUid = cleanText(request.data?.targetUid, 128);

  if (!targetUid) {
    fail("invalid-argument", "Target UID is required.");
  }

  const player = await updatePlayer(targetUid, current => {
    if (request.data.cashy !== undefined) {
      current.cashy = int(request.data.cashy);
    }

    if (request.data.xp !== undefined) {
      current.xp = int(request.data.xp, 100000000);
    }

    if (request.data.title !== undefined) {
      current.customTitle = cleanText(request.data.title, 32);
    }

    if (Array.isArray(request.data.badges)) {
      current.extraBadges = request.data.badges
        .slice(0, 5)
        .map(x => cleanText(x, 24))
        .filter(Boolean);
    }

    return current;
  });

  return {
    success: true,
    player: publicPlayer(player)
  };
});

// --------------------------------------------------
// OWNER: BAN AND UNBAN
// durationHours: 0 = permanent
// --------------------------------------------------

exports.ownerBanPlayer = onCall(async request => {
  ownerOnly(request);

  const targetUid = cleanText(request.data?.targetUid, 128);
  const hours = int(request.data?.durationHours || 0, 87600);
  const reason = cleanText(request.data?.reason, 160);

  if (!targetUid || !reason) {
    fail("invalid-argument", "UID and reason are required.");
  }

  const player = await updatePlayer(targetUid, current => {
    current.ban = {
      active: true,
      until: hours ? Date.now() + hours * 3600000 : 0,
      reason
    };

    return current;
  });

  return { success: true, player: publicPlayer(player) };
});

exports.ownerUnbanPlayer = onCall(async request => {
  ownerOnly(request);

  const targetUid = cleanText(request.data?.targetUid, 128);

  if (!targetUid) {
    fail("invalid-argument", "Target UID is required.");
  }

  await updatePlayer(targetUid, current => {
    current.ban = {
      active: false,
      until: 0,
      reason: ""
    };

    return current;
  });

  return { success: true };
});

// --------------------------------------------------
// GLOBAL CHAT
// --------------------------------------------------

exports.sendGlobalChat = onCall(async request => {
  const uid = getUid(request);

  const player = await ensureProfile(uid, request.auth.token.name);
  const message = cleanText(request.data?.message, 180);

  if (!message) {
    fail("invalid-argument", "Message cannot be empty.");
  }

  const now = Date.now();
  const limitRef = db.ref("chatLimits/" + uid);

  const limit = await limitRef.transaction(lastMessage => {
    if (lastMessage && now - Number(lastMessage) < 1500) {
      return;
    }

    return now;
  });

  if (!limit.committed) {
    fail("resource-exhausted", "Please wait before sending another message.");
  }

  const messageRef = db.ref("globalChat").push();

  await messageRef.set({
    uid,
    name: cleanText(player.displayName, 24) || "Player",
    message,
    createdAt: now
  });

  return { success: true, id: messageRef.key };
});
