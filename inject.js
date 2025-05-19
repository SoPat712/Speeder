var regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;

var tc = {
  settings: {
    lastSpeed: 1.0,
    enabled: true,
    speeds: {},
    displayKeyCode: 86,
    rememberSpeed: false,
    forceLastSavedSpeed: false,
    audioBoolean: false,
    startHidden: false,
    controllerOpacity: 0.3,
    keyBindings: [],
    blacklist: `\
      www.instagram.com
      twitter.com
      vine.co
      imgur.com
      teams.microsoft.com
    `.replace(regStrip, ""),
    defaultLogLevel: 4,
    logLevel: 3,
    // --- Nudge settings (ADDED) ---
    enableSubtitleNudge: true,
    subtitleNudgeInterval: 25,
    subtitleNudgeAmount: 0.001
  },
  mediaElements: [],
  isNudging: false // ADDED: Flag for nudge operation
};

/* Log levels */
function log(message, level) {
  verbosity = tc.settings.logLevel;
  if (typeof level === "undefined") level = tc.settings.defaultLogLevel;
  if (verbosity >= level) {
    let prefix = "[VSC] ";
    if (level === 2) console.log(prefix + "ERROR: " + message);
    else if (level === 3) console.log(prefix + "WARNING: " + message);
    else if (level === 4) console.log(prefix + "INFO: " + message);
    else if (level === 5) console.log(prefix + "DEBUG: " + message);
    else if (level === 6) {
      console.log(prefix + "DEBUG (VERBOSE): " + message);
      console.trace();
    }
  }
}

chrome.storage.sync.get(tc.settings, function (storage) {
  // MODIFIED: Robust keyBinding initialization
  tc.settings.keyBindings =
    Array.isArray(storage.keyBindings) &&
    storage.keyBindings.length > 0 &&
    storage.keyBindings[0].hasOwnProperty("predefined")
      ? storage.keyBindings
      : [
          {
            action: "slower",
            key: Number(storage.slowerKeyCode) || 83,
            value: Number(storage.speedStep) || 0.1,
            force: false,
            predefined: true
          },
          {
            action: "faster",
            key: Number(storage.fasterKeyCode) || 68,
            value: Number(storage.speedStep) || 0.1,
            force: false,
            predefined: true
          },
          {
            action: "rewind",
            key: Number(storage.rewindKeyCode) || 90,
            value: Number(storage.rewindTime) || 10,
            force: false,
            predefined: true
          },
          {
            action: "advance",
            key: Number(storage.advanceKeyCode) || 88,
            value: Number(storage.advanceTime) || 10,
            force: false,
            predefined: true
          },
          {
            action: "reset",
            key: Number(storage.resetKeyCode) || 82,
            value: 1.0,
            force: false,
            predefined: true
          },
          {
            action: "fast",
            key: Number(storage.fastKeyCode) || 71,
            value: Number(storage.fastSpeed) || 1.8,
            force: false,
            predefined: true
          }
        ];
  if (
    !Array.isArray(storage.keyBindings) ||
    storage.keyBindings.length === 0 ||
    (storage.keyBindings.length > 0 &&
      !storage.keyBindings[0].hasOwnProperty("predefined"))
  ) {
    log("Initializing/Updating keybindings in storage.", 4);
    chrome.storage.sync.set({
      keyBindings: tc.settings.keyBindings,
      version: "0.6.3.10"
    }); // Update version
  }

  tc.settings.lastSpeed = Number(storage.lastSpeed) || 1.0;
  tc.settings.displayKeyCode = Number(storage.displayKeyCode) || 86;
  tc.settings.rememberSpeed = Boolean(storage.rememberSpeed);
  tc.settings.forceLastSavedSpeed = Boolean(storage.forceLastSavedSpeed);
  tc.settings.audioBoolean = Boolean(storage.audioBoolean);
  tc.settings.enabled =
    typeof storage.enabled !== "undefined" ? Boolean(storage.enabled) : true;
  tc.settings.startHidden = Boolean(storage.startHidden);
  tc.settings.controllerOpacity = Number(storage.controllerOpacity) || 0.3;
  tc.settings.blacklist = String(storage.blacklist || tc.settings.blacklist);

  if (typeof storage.logLevel !== "undefined")
    tc.settings.logLevel = Number(storage.logLevel);

  // ADDED: Load nudge settings
  tc.settings.enableSubtitleNudge =
    typeof storage.enableSubtitleNudge !== "undefined"
      ? Boolean(storage.enableSubtitleNudge)
      : tc.settings.enableSubtitleNudge;
  tc.settings.subtitleNudgeInterval =
    Number(storage.subtitleNudgeInterval) || 25;
  tc.settings.subtitleNudgeAmount =
    Number(storage.subtitleNudgeAmount) || tc.settings.subtitleNudgeAmount;

  if (
    tc.settings.keyBindings.filter((x) => x.action == "display").length == 0
  ) {
    tc.settings.keyBindings.push({
      action: "display",
      key: tc.settings.displayKeyCode,
      value: 0,
      force: false,
      predefined: true
    });
  }
  initializeWhenReady(document);
});

function getKeyBindings(action, what = "value") {
  // Original getKeyBindings
  if (!tc.settings.keyBindings) return false;
  try {
    const binding = tc.settings.keyBindings.find(
      (item) => item.action === action
    );
    if (binding) return binding[what];
    // Fallbacks from original
    if (what === "value") {
      if (action === "slower" || action === "faster") return 0.1;
      if (action === "rewind" || action === "advance") return 10;
      if (action === "reset") return 1.0;
      if (action === "fast") return 1.8;
    }
    return false;
  } catch (e) {
    log(`Error in getKeyBindings for ${action} (${what}): ${e.message}`, 2);
    return false;
  }
}

// Original setKeyBindings from your provided code (used by original resetSpeed)
function setKeyBindings(action, value) {
  if (!tc.settings.keyBindings) return;
  const binding = tc.settings.keyBindings.find(
    (item) => item.action === action
  );
  if (binding) {
    binding["value"] = value;
  }
}

function defineVideoController() {
  tc.videoController = function (target, parent) {
    if (target.vsc) return target.vsc;
    log(`Creating VSC controller for ${target.src || "video"}.`, 4);
    tc.mediaElements.push(target);
    target.vsc = this;

    this.video = target;
    this.parent = parent || target.parentElement;
    this.nudgeIntervalId = null; // ADDED for nudge

    let storedSpeed; // Original logic
    if (!tc.settings.rememberSpeed) {
      storedSpeed = tc.settings.speeds[target.currentSrc];
      if (!storedSpeed) storedSpeed = 1.0;
      setKeyBindings("reset", getKeyBindings("fast"));
    } else {
      storedSpeed =
        tc.settings.speeds[target.currentSrc] || tc.settings.lastSpeed;
    }
    if (tc.settings.forceLastSavedSpeed) storedSpeed = tc.settings.lastSpeed;

    this.div = this.initializeControls();

    if (Math.abs(target.playbackRate - storedSpeed) > 0.001) {
      setSpeed(target, storedSpeed, true); // MODIFIED: Pass true for isInitialSet
    } else {
      if (this.speedIndicator)
        this.speedIndicator.textContent = storedSpeed.toFixed(2);
      if (
        !tc.settings.forceLastSavedSpeed &&
        tc.settings.lastSpeed !== storedSpeed
      ) {
        tc.settings.lastSpeed = storedSpeed;
      }
    }

    var mediaEventAction = function (event) {
      // Original mediaEventAction
      const video = event.target;
      if (!video.vsc) return;
      let speedToSet = tc.settings.speeds[video.currentSrc];
      if (!tc.settings.rememberSpeed) {
        if (!speedToSet) speedToSet = 1.0;
        setKeyBindings("reset", getKeyBindings("fast"));
      } else {
        speedToSet = tc.settings.lastSpeed;
      }
      if (tc.settings.forceLastSavedSpeed) speedToSet = tc.settings.lastSpeed;

      if (Math.abs(video.playbackRate - speedToSet) > 0.001) {
        setSpeed(video, speedToSet, false); // MODIFIED: isInitialSet is false
      }
      // ADDED: Manage nudge
      if (event.type === "play") video.vsc.startSubtitleNudge();
      else if (event.type === "pause" || event.type === "ended")
        video.vsc.stopSubtitleNudge();
    };

    target.addEventListener(
      "play",
      (this.handlePlay = mediaEventAction.bind(this))
    );
    target.addEventListener(
      "pause",
      (this.handlePause = mediaEventAction.bind(this))
    ); // ADDED
    target.addEventListener(
      "ended",
      (this.handleEnded = mediaEventAction.bind(this))
    ); // ADDED
    target.addEventListener(
      "seeked",
      (this.handleSeek = mediaEventAction.bind(this))
    );

    var srcObserver = new MutationObserver((mutations) => {
      // Original srcObserver
      mutations.forEach((mutation) => {
        if (
          mutation.type === "attributes" &&
          (mutation.attributeName === "src" ||
            mutation.attributeName === "currentSrc")
        ) {
          if (!this.div) return;
          this.stopSubtitleNudge(); // ADDED
          if (!mutation.target.src && !mutation.target.currentSrc)
            this.div.classList.add("vsc-nosource");
          else {
            this.div.classList.remove("vsc-nosource");
            let newSrcSpeed = tc.settings.speeds[mutation.target.currentSrc];
            if (!tc.settings.rememberSpeed) {
              if (!newSrcSpeed) newSrcSpeed = 1.0;
            } else {
              newSrcSpeed = newSrcSpeed || tc.settings.lastSpeed;
            }
            if (tc.settings.forceLastSavedSpeed)
              newSrcSpeed = tc.settings.lastSpeed;
            setSpeed(mutation.target, newSrcSpeed, true); // MODIFIED: isInitialSet = true
            if (!mutation.target.paused && mutation.target.playbackRate !== 1.0)
              this.startSubtitleNudge(); // ADDED
          }
        }
      });
    });
    srcObserver.observe(target, { attributeFilter: ["src", "currentSrc"] });

    if (!target.paused && target.playbackRate !== 1.0)
      this.startSubtitleNudge(); // ADDED
  };

  // --- Nudge Methods (ADDED) ---
  tc.videoController.prototype.startSubtitleNudge = function () {
    if (!location.hostname.includes("youtube.com")) return; // ADDED: Nudge only on YouTube
    if (
      !tc.settings.enableSubtitleNudge ||
      this.nudgeIntervalId !== null ||
      !this.video
    )
      return;
    if (this.video.paused || this.video.playbackRate === 1.0) {
      this.stopSubtitleNudge();
      return;
    }
    log(`Nudge: Starting interval: ${tc.settings.subtitleNudgeInterval}ms.`, 5);
    this.nudgeIntervalId = setInterval(() => {
      if (
        !this.video ||
        this.video.paused ||
        this.video.playbackRate === 1.0 ||
        tc.isNudging
      ) {
        this.stopSubtitleNudge();
        return;
      }
      const currentRate = this.video.playbackRate;
      const nudgeAmount = tc.settings.subtitleNudgeAmount;
      tc.isNudging = true;
      this.video.playbackRate = currentRate + nudgeAmount;
      requestAnimationFrame(() => {
        if (
          this.video &&
          Math.abs(this.video.playbackRate - (currentRate + nudgeAmount)) <
            nudgeAmount * 1.5
        ) {
          this.video.playbackRate = currentRate;
        }
        tc.isNudging = false;
      });
    }, tc.settings.subtitleNudgeInterval);
  };
  tc.videoController.prototype.stopSubtitleNudge = function () {
    if (this.nudgeIntervalId !== null) {
      log(`Nudge: Stopping.`, 5);
      clearInterval(this.nudgeIntervalId);
      this.nudgeIntervalId = null;
    }
  };

  tc.videoController.prototype.remove = function () {
    // Original remove
    this.stopSubtitleNudge(); // ADDED
    if (this.div && this.div.parentNode) this.div.remove();
    if (this.video) {
      this.video.removeEventListener("play", this.handlePlay);
      this.video.removeEventListener("pause", this.handlePause); // ADDED
      this.video.removeEventListener("ended", this.handleEnded); // ADDED
      this.video.removeEventListener("seeked", this.handleSeek); // Original had "seek"
      delete this.video.vsc;
    }
    let idx = tc.mediaElements.indexOf(this.video);
    if (idx !== -1) tc.mediaElements.splice(idx, 1);
  };

  tc.videoController.prototype.initializeControls = function () {
    // Original initializeControls
    log("initializeControls Begin", 5);
    const doc = this.video.ownerDocument;
    const speedForUI = this.video.playbackRate.toFixed(2);
    var top = Math.max(this.video.offsetTop, 0) + "px",
      left = Math.max(this.video.offsetLeft, 0) + "px";
    var wrapper = doc.createElement("div");
    wrapper.classList.add("vsc-controller");
    if (!this.video.src && !this.video.currentSrc)
      wrapper.classList.add("vsc-nosource");
    if (tc.settings.startHidden) wrapper.classList.add("vsc-hidden");
    var shadow = wrapper.attachShadow({ mode: "open" });
    shadow.innerHTML = `
        <style> @import "${chrome.runtime.getURL("shadow.css")}"; </style>
        <div id="controller" style="top:${top}; left:${left}; opacity:${tc.settings.controllerOpacity}">
          <span data-action="drag" class="draggable">${speedForUI}</span>
          <span id="controls">
            <button data-action="rewind" class="rw">«</button>
            <button data-action="slower">−</button>
            <button data-action="faster">+</button>
            <button data-action="advance" class="rw">»</button>
            <button data-action="display" class="hideButton">×</button>
          </span>
        </div>`;
    this.speedIndicator = shadow.querySelector(".draggable"); // MODIFIED: Original was "span"

    // MODIFIED: Pass this.video as 4th arg to runAction
    shadow.querySelector(".draggable").addEventListener(
      "mousedown",
      (e) => {
        runAction(
          e.target.dataset["action"],
          getKeyBindings(e.target.dataset["action"], "value"),
          e,
          this.video
        );
        e.stopPropagation();
      },
      true
    );
    shadow.querySelectorAll("button").forEach((btn) =>
      btn.addEventListener(
        "click",
        (e) => {
          runAction(
            e.target.dataset["action"],
            getKeyBindings(e.target.dataset["action"]),
            e,
            this.video
          );
          e.stopPropagation();
        },
        true
      )
    );
    shadow
      .querySelector("#controller")
      .addEventListener("click", (e) => e.stopPropagation(), false);
    shadow
      .querySelector("#controller")
      .addEventListener("mousedown", (e) => e.stopPropagation(), false);
    var fragment = doc.createDocumentFragment();
    fragment.appendChild(wrapper);
    const pEl = this.parent || this.video.parentElement;
    if (!pEl || !pEl.parentNode) {
      doc.body.appendChild(fragment);
      return wrapper;
    }
    // Original placement logic
    switch (true) {
      case location.hostname == "www.amazon.com":
      case location.hostname == "www.reddit.com":
      case /hbogo\./.test(location.hostname):
        pEl.parentElement.insertBefore(fragment, pEl);
        break;
      case location.hostname == "www.facebook.com":
        let p =
          pEl.parentElement.parentElement.parentElement.parentElement
            .parentElement.parentElement.parentElement;
        if (p && p.firstChild) p.insertBefore(fragment, p.firstChild);
        else if (pEl.firstChild) pEl.insertBefore(fragment, pEl.firstChild);
        else pEl.appendChild(fragment);
        break;
      case location.hostname == "tv.apple.com":
        const r = pEl.getRootNode();
        const s = r && r.querySelector ? r.querySelector(".scrim") : null;
        if (s) s.prepend(fragment);
        else pEl.insertBefore(fragment, pEl.firstChild);
        break;
      default:
        pEl.insertBefore(fragment, pEl.firstChild);
    }
    return wrapper;
  };
}

function escapeStringRegExp(str) {
  const m = /[|\\{}()[\]^$+*?.]/g;
  return str.replace(m, "\\$&");
} // Original
function isBlacklisted() {
  /* ... same original logic (with robust regex) ... */
  let blacklisted = false;
  const blacklistLines = tc.settings.blacklist
    ? tc.settings.blacklist.split("\n")
    : [];
  blacklistLines.forEach((match) => {
    if (blacklisted) return;
    match = match.replace(regStrip, "");
    if (match.length == 0) return;
    let regexp;
    if (match.startsWith("/") && match.lastIndexOf("/") > 0) {
      try {
        const ls = match.lastIndexOf("/");
        regexp = new RegExp(match.substring(1, ls), match.substring(ls + 1));
      } catch (err) {
        log(`Invalid regex in blacklist: ${match}. Error: ${err.message}`, 2);
        return;
      }
    } else regexp = new RegExp(escapeStringRegExp(match));
    if (regexp && regexp.test(location.href)) blacklisted = true;
  });
  if (blacklisted) log(`Page ${location.href} is blacklisted.`, 4);
  return blacklisted;
}

var coolDown = false; // Original coolDown
function refreshCoolDown() {
  // Original refreshCoolDown
  log("Begin refreshCoolDown", 5);
  if (coolDown) clearTimeout(coolDown);
  coolDown = setTimeout(function () {
    coolDown = false;
  }, 1000);
}

function setupListener() {
  if (document.vscRateListenerAttached) return; // Original flag was vscRateChangeListenerAttached

  // MODIFIED: fromUserInput parameter added
  function updateSpeedFromEvent(video, fromUserInput = false) {
    if (!video.vsc || !video.vsc.speedIndicator) return;
    var speed = Number(video.playbackRate.toFixed(2));
    log(
      `updateSpeedFromEvent: Rate is ${speed}. FromUserInput: ${fromUserInput}`,
      4
    );

    video.vsc.speedIndicator.textContent = speed.toFixed(2);
    tc.settings.speeds[video.currentSrc || "unknown_src"] = speed;
    tc.settings.lastSpeed = speed;
    chrome.storage.sync.set({ lastSpeed: speed }, () => {
      /* error handling if needed */
    });

    // MODIFIED: Only "blink" (show controller) if change was from user input
    if (fromUserInput) {
      // The original runAction("blink", null, null) implies value is taken from keybinding or default
      runAction("blink", getKeyBindings("blink", "value") || 1000, null, video);
    }

    if (video.vsc) {
      // MODIFIED: Manage nudge based on new speed
      if (speed === 1.0 || video.paused) video.vsc.stopSubtitleNudge();
      else video.vsc.startSubtitleNudge();
    }
  }

  document.addEventListener(
    "ratechange",
    function (event) {
      // ADDED: Check tc.isNudging at the very start
      if (tc.isNudging) {
        return;
      }

      // Original coolDown logic
      if (coolDown) {
        log("Speed event propagation blocked by coolDown", 4);
        event.stopImmediatePropagation();
        return;
      }

      var video = event.target;
      if (!video || typeof video.playbackRate === "undefined" || !video.vsc)
        return;

      const eventOrigin = event.detail && event.detail.origin;
      let isFromUserInputForBlink = false;

      if (tc.settings.forceLastSavedSpeed) {
        if (eventOrigin === "videoSpeed") {
          if (event.detail.speed) {
            const detailSpeedNum = Number(event.detail.speed);
            if (
              !isNaN(detailSpeedNum) &&
              Math.abs(video.playbackRate - detailSpeedNum) > 0.001
            ) {
              video.playbackRate = detailSpeedNum;
            }
          }
          // Use fromUserInput from event.detail if present (set by setSpeed)
          isFromUserInputForBlink = event.detail.fromUserInput !== false;
          updateSpeedFromEvent(video, isFromUserInputForBlink);
          event.stopImmediatePropagation();
        } else {
          if (Math.abs(video.playbackRate - tc.settings.lastSpeed) > 0.001) {
            video.playbackRate = tc.settings.lastSpeed;
            event.stopImmediatePropagation();
          } else {
            updateSpeedFromEvent(video, false);
          }
        }
      } else {
        // forceLastSavedSpeed is OFF
        // If setSpeed was called (which sets video.vscIsDirectSetByVSC)
        // then it's a user-driven change (or initial set).
        isFromUserInputForBlink = video.vscIsDirectSetByVSC === true;
        if (video.hasOwnProperty("vscIsDirectSetByVSC"))
          delete video.vscIsDirectSetByVSC; // Consume flag

        updateSpeedFromEvent(video, isFromUserInputForBlink);
        // DO NOT stop propagation when forceLastSavedSpeed is OFF
      }
    },
    true
  );
  document.vscRateListenerAttached = true; // Original flag name
}

// Original initializeWhenReady and initializeNow structure, with unique flags for re-entrancy checks
var vscInitializedDocuments = new Set();
function initializeWhenReady(doc) {
  if (doc.vscInitWhenReadyUniqueFlag1 && doc.readyState !== "loading") return;
  doc.vscInitWhenReadyUniqueFlag1 = true;
  if (isBlacklisted()) return;
  log(
    `initializeWhenReady for: ${doc.location ? doc.location.href : "iframe"}. RS: ${doc.readyState}`,
    5
  );
  if (doc === window.document && !window.vscPageLoadListenerUniqueFlag1) {
    window.addEventListener("load", () => initializeNow(window.document), {
      once: true
    });
    window.vscPageLoadListenerUniqueFlag1 = true;
  }
  if (doc.readyState === "complete") initializeNow(doc);
  else if (!doc.vscReadyStateListenerUniqueFlag1) {
    doc.addEventListener("readystatechange", function onRSChangeUnique1() {
      if (doc.readyState === "complete") {
        doc.removeEventListener("readystatechange", onRSChangeUnique1);
        initializeNow(doc);
      }
    });
    doc.vscReadyStateListenerUniqueFlag1 = true;
  }
}
function inIframe() {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
}
function getShadow(parent) {
  /* ... original logic ... */
  let result = [];
  function getChild(p) {
    if (p.firstElementChild) {
      var c = p.firstElementChild;
      do {
        result.push(c);
        getChild(c);
        if (c.shadowRoot) result.push(...getShadow(c.shadowRoot));
        c = c.nextElementSibling;
      } while (c);
    }
  }
  getChild(parent);
  return result;
}

function initializeNow(doc) {
  if (vscInitializedDocuments.has(doc) || !doc.body) return;
  log(
    `initializeNow for doc: ${doc.location ? doc.location.href : "iframe"}`,
    4
  );
  if (!tc.settings.enabled) {
    log("VSC disabled.", 4);
    return;
  }
  if (!doc.body.classList.contains("vsc-initialized"))
    doc.body.classList.add("vsc-initialized");
  if (typeof tc.videoController === "undefined") defineVideoController();
  setupListener();
  if (
    inIframe() &&
    doc !== window.top.document &&
    !doc.head.querySelector('link[href*="inject.css"]')
  ) {
    var link = doc.createElement("link");
    link.href = chrome.runtime.getURL("inject.css");
    link.type = "text/css";
    link.rel = "stylesheet";
    doc.head.appendChild(link);
  }
  const docsForKeydown = new Set([doc]);
  try {
    if (inIframe() && window.top.document)
      docsForKeydown.add(window.top.document);
  } catch (e) {}
  docsForKeydown.forEach((lDoc) => {
    if (!lDoc.vscKeydownListenerUniqueFlagC) {
      // Unique flag name
      lDoc.addEventListener(
        "keydown",
        function (event) {
          if (!tc.settings.enabled) return;
          const target = event.target;
          if (
            target.nodeName === "INPUT" ||
            target.nodeName === "TEXTAREA" ||
            target.isContentEditable
          )
            return;
          if (
            event.getModifierState &&
            (event.getModifierState("Alt") ||
              event.getModifierState("Control") ||
              event.getModifierState("Meta") ||
              event.getModifierState("Fn") ||
              event.getModifierState("Hyper") ||
              event.getModifierState("OS"))
          )
            return;
          if (
            tc.mediaElements.length === 0 &&
            !lDoc.querySelector("video,audio")
          )
            return;
          var item = tc.settings.keyBindings.find(
            (kb) => kb.key === event.keyCode
          );
          if (item) {
            runAction(item.action, item.value, event);
            if (item.force === "true" || item.force === true) {
              event.preventDefault();
              event.stopPropagation();
            }
          }
        },
        true
      );
      lDoc.vscKeydownListenerUniqueFlagC = true;
    }
  });
  if (!doc.vscMutationObserverUniqueFlagC) {
    // Unique flag name
    const obs = new MutationObserver((muts) => {
      if (typeof requestIdleCallback === "function")
        requestIdleCallback(() => processMutations(muts), { timeout: 1000 });
      else setTimeout(() => processMutations(muts), 200);
    });
    function processMutations(mList) {
      for (const m of mList) {
        if (m.type === "childList") {
          m.addedNodes.forEach((n) => {
            if (n instanceof Element) chkVid(n, n.parentNode || m.target, true);
          });
          m.removedNodes.forEach((n) => {
            if (n instanceof Element)
              chkVid(n, n.parentNode || m.target, false);
          });
        } else if (
          m.type === "attributes" &&
          m.attributeName === "aria-hidden" &&
          m.target instanceof Element &&
          m.target.getAttribute("aria-hidden") === "false"
        ) {
          const vidsInTgt = Array.from(getShadow(m.target)).filter(
            (el) => el.tagName === "VIDEO"
          );
          vidsInTgt.forEach((vEl) => {
            if (!vEl.vsc) chkVid(vEl, vEl.parentNode || m.target, true);
          });
        }
      }
    }
    function chkVid(n, p, add) {
      if (!add && !n.isConnected) {
      } else if (!add && n.isConnected) return;
      if (
        n.nodeName === "VIDEO" ||
        (n.nodeName === "AUDIO" && tc.settings.audioBoolean)
      ) {
        if (add) {
          if (!n.vsc) new tc.videoController(n, p);
        } else {
          if (n.vsc) n.vsc.remove();
        }
      } else if (n.children && n.children.length > 0) {
        for (let i = 0; i < n.children.length; i++)
          chkVid(n.children[i], n.children[i].parentNode || p, add);
      }
    }
    obs.observe(doc, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-hidden"]
    });
    doc.vscMutationObserverUniqueFlagC = true;
  }
  const q = tc.settings.audioBoolean ? "video,audio" : "video";
  doc.querySelectorAll(q).forEach((vid) => {
    if (!vid.vsc) new tc.videoController(vid, vid.parentElement);
  });
  Array.from(doc.getElementsByTagName("iframe")).forEach((fr) => {
    try {
      if (fr.contentDocument) initializeWhenReady(fr.contentDocument);
    } catch (e) {}
  });
  vscInitializedDocuments.add(doc);
}

// MODIFIED setSpeed to accept `isInitialCall` and pass it for `fromUserInput` in custom event
function setSpeed(video, speed, isInitialCall = false) {
  const numericSpeed = Number(speed);
  if (isNaN(numericSpeed) || numericSpeed <= 0 || numericSpeed > 16) return;
  if (!video || !video.vsc || !video.vsc.speedIndicator) return;
  log(
    `setSpeed: Target ${numericSpeed.toFixed(2)}. Initial: ${isInitialCall}`,
    4
  );

  tc.settings.lastSpeed = numericSpeed;
  video.vsc.speedIndicator.textContent = numericSpeed.toFixed(2);

  if (tc.settings.forceLastSavedSpeed) {
    video.dispatchEvent(
      new CustomEvent("ratechange", {
        detail: {
          origin: "videoSpeed",
          speed: numericSpeed.toFixed(2),
          fromUserInput: !isInitialCall
        }
      })
    );
  } else {
    if (Math.abs(video.playbackRate - numericSpeed) > 0.001) {
      // ADDED: Set a temporary flag on the video element itself before changing playbackRate
      // This helps the native ratechange event handler determine if VSC initiated this change.
      if (!isInitialCall) {
        video.vscIsDirectlySettingRate = true;
      }
      video.playbackRate = numericSpeed;
    }
  }
  if (!isInitialCall) refreshCoolDown(); // Original call
  if (video.vsc) {
    if (numericSpeed === 1.0 || video.paused) video.vsc.stopSubtitleNudge();
    else video.vsc.startSubtitleNudge();
  }
}

// MODIFIED runAction for specificVideo targeting and passing `isInitialCall=false` to setSpeed
function runAction(action, value, e, specificVideo = null) {
  var mediaTagsToProcess = [];
  if (specificVideo) mediaTagsToProcess = [specificVideo];
  else if (e && e.target) {
    const docContext = e.target.ownerDocument || document;
    let activeVideo = tc.mediaElements.find(
      (v) =>
        v.ownerDocument === docContext &&
        (docContext.activeElement === v || v.contains(docContext.activeElement))
    );
    if (activeVideo) mediaTagsToProcess = [activeVideo];
    else {
      activeVideo = tc.mediaElements.find(
        (v) =>
          v.ownerDocument === docContext &&
          v.offsetParent !== null &&
          (!v.paused || v.readyState > 0)
      );
      if (activeVideo) mediaTagsToProcess = [activeVideo];
      else {
        mediaTagsToProcess = tc.mediaElements.filter(
          (v) => v.ownerDocument === docContext
        );
        if (mediaTagsToProcess.length === 0 && tc.mediaElements.length > 0)
          mediaTagsToProcess = [tc.mediaElements[0]];
        else if (mediaTagsToProcess.length === 0) mediaTagsToProcess = [];
      }
    }
  } else mediaTagsToProcess = tc.mediaElements;
  if (mediaTagsToProcess.length === 0 && action !== "display") return;

  var targetControllerFromEvent =
    e && e.target && e.target.getRootNode && e.target.getRootNode().host
      ? e.target.getRootNode().host
      : null;

  // Store current action for original resetSpeed context (local to this runAction call)
  const currentActionContext = action;

  mediaTagsToProcess.forEach(function (v) {
    if (!v || !v.vsc || !v.vsc.div || !v.vsc.speedIndicator) return;
    var controllerDiv = v.vsc.div;
    if (
      targetControllerFromEvent &&
      targetControllerFromEvent !== controllerDiv &&
      action !== "blink"
    )
      return;
    if (action === "blink" && specificVideo && v !== specificVideo) return;

    // MODIFIED: showController only for explicit user-driven actions, not "blink" itself
    const userDrivenActionsThatShowController = [
      "rewind",
      "advance",
      "faster",
      "slower",
      "reset",
      "fast",
      "pause",
      "muted",
      "mark",
      "jump",
      "drag"
    ];
    if (userDrivenActionsThatShowController.includes(action)) {
      showController(controllerDiv);
    }

    if (v.classList.contains("vsc-cancelled")) return;
    const numValue = parseFloat(value);
    switch (action) {
      case "rewind":
        v.currentTime -= numValue;
        break;
      case "advance":
        v.currentTime += numValue;
        break;
      case "faster":
        setSpeed(
          v,
          Math.min(
            (v.playbackRate < 0.07 ? 0.07 : v.playbackRate) + numValue,
            16
          ),
          false
        );
        break;
      case "slower":
        setSpeed(v, Math.max(v.playbackRate - numValue, 0.07), false);
        break;
      // MODIFIED: Passing currentActionContext to original resetSpeed
      case "reset":
        resetSpeed(v, 1.0, currentActionContext);
        break;
      case "fast":
        resetSpeed(v, numValue, currentActionContext);
        break;
      case "display":
        controllerDiv.classList.add("vsc-manual");
        controllerDiv.classList.toggle("vsc-hidden");
        break;
      case "blink":
        if (
          controllerDiv.classList.contains("vsc-hidden") ||
          controllerDiv.blinkTimeOut !== undefined
        ) {
          clearTimeout(controllerDiv.blinkTimeOut);
          controllerDiv.classList.remove("vsc-hidden");
          controllerDiv.blinkTimeOut = setTimeout(
            () => {
              if (
                controllerDiv.classList.contains("vsc-manual") &&
                !controllerDiv.classList.contains("vsc-hidden")
              ) {
              } else {
                controllerDiv.classList.add("vsc-hidden");
              }
              controllerDiv.blinkTimeOut = undefined;
            },
            typeof value === "number" && !isNaN(value) ? value : 1000
          );
        }
        break;
      case "drag":
        if (e) handleDrag(v, e);
        break;
      case "pause":
        pause(v);
        break;
      case "muted":
        muted(v);
        break;
      case "mark":
        setMark(v);
        break;
      case "jump":
        jumpToMark(v);
        break;
      default:
        log(`Unknown action: ${action}`, 3);
    }
  });
}
// Removed global actionBeingProcessedForReset_global

function pause(v) {
  if (v.paused) v.play().catch((e) => log(`Play err:${e.message}`, 2));
  else v.pause();
}

// MODIFIED: Original resetSpeed function now takes currentActionContext
function resetSpeed(v, target, currentActionContext = null) {
  log(
    `resetSpeed (original): Video current: ${v.playbackRate.toFixed(2)}, Target: ${target.toFixed(2)}, Context: ${currentActionContext}`,
    4
  );

  if (Math.abs(v.playbackRate - target) < 0.01) {
    // Using Math.abs for float comparison
    // If current speed IS the target of THIS action
    if (v.playbackRate === (getKeyBindings("reset", "value") || 1.0)) {
      if (target !== 1.0) {
        setSpeed(v, 1.0, false);
      } else {
        // Target is 1.0 and current is 1.0 (or what reset key last stored) -> go to fast
        setSpeed(v, getKeyBindings("fast", "value"), false);
      }
    } else {
      // Current is target, but not what 'reset' binding value holds (e.g. G pressed, current is fast speed)
      setSpeed(v, getKeyBindings("reset", "value") || 1.0, false);
    }
  } else {
    // Current speed is NOT the target of this action. Set to the target.
    if (currentActionContext === "reset") {
      // Only do this for 'reset' action context
      setKeyBindings("reset", v.playbackRate); // Original call to store current rate
    }
    setSpeed(v, target, false);
  }
}

function muted(v) {
  v.muted = !v.muted;
  log(`Mute: ${v.muted}`, 5);
}
function setMark(v) {
  if (!v.vsc) v.vsc = {};
  v.vsc.mark = v.currentTime;
  log(`Mark: ${v.vsc.mark.toFixed(2)}`, 5);
}
function jumpToMark(v) {
  if (v.vsc && typeof v.vsc.mark === "number") v.currentTime = v.vsc.mark;
  else log("No mark.", 4);
}
function handleDrag(video, e) {
  /* ... same original logic ... */
  if (!video || !video.vsc || !video.vsc.div || !video.vsc.div.shadowRoot)
    return;
  const controller = video.vsc.div;
  const shadowController = controller.shadowRoot.querySelector("#controller");
  if (!shadowController) return;
  var parentElement = controller.parentElement;
  while (
    parentElement &&
    parentElement.parentNode &&
    parentElement.parentNode !== document &&
    parentElement.parentNode.offsetHeight === parentElement.offsetHeight &&
    parentElement.parentNode.offsetWidth === parentElement.offsetWidth
  )
    parentElement = parentElement.parentNode;
  const dragBoundary = parentElement || video.ownerDocument.body;
  video.classList.add("vcs-dragging");
  shadowController.classList.add("dragging");
  const iXY = [e.clientX, e.clientY],
    iCtrlXY = [
      parseInt(shadowController.style.left, 10) || 0,
      parseInt(shadowController.style.top, 10) || 0
    ];
  const sD = (mvE) => {
    let s = shadowController.style;
    s.left = iCtrlXY[0] + mvE.clientX - iXY[0] + "px";
    s.top = iCtrlXY[1] + mvE.clientY - iXY[1] + "px";
    mvE.preventDefault();
  };
  const eD = () => {
    dragBoundary.removeEventListener("mousemove", sD);
    dragBoundary.removeEventListener("mouseup", eD);
    dragBoundary.removeEventListener("mouseleave", eD);
    shadowController.classList.remove("dragging");
    video.classList.remove("vcs-dragging");
  };
  dragBoundary.addEventListener("mousemove", sD);
  dragBoundary.addEventListener("mouseup", eD);
  dragBoundary.addEventListener("mouseleave", eD);
}
var timer = null;
function showController(controller) {
  /* ... same original logic ... */
  if (!controller || typeof controller.classList === "undefined") return;
  controller.classList.add("vcs-show");
  if (timer) clearTimeout(timer);
  timer = setTimeout(function () {
    if (controller && controller.classList)
      controller.classList.remove("vsc-show");
    timer = false;
  }, 2000);
}
