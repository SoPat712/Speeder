var regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;

var tc = {
  settings: {
    lastSpeed: 1.0, // default 1x
    enabled: true, // default enabled
    speeds: {}, // empty object to hold speed for each source

    displayKeyCode: 86, // default: V
    rememberSpeed: false, // default: false
    forceLastSavedSpeed: false, //default: false
    audioBoolean: false, // default: false
    startHidden: false, // default: false
    controllerOpacity: 0.3, // default: 0.3
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

  // Holds a reference to all of the AUDIO/VIDEO DOM elements we've attached to
  mediaElements: [],
  isNudging: false // Flag for nudge operation (ADDED)
};

/* Log levels (depends on caller specifying the correct level) */
function log(message, level) {
  verbosity = tc.settings.logLevel;
  if (typeof level === "undefined") {
    level = tc.settings.defaultLogLevel;
  }
  if (verbosity >= level) {
    // MODIFIED: Added [VSC] prefix for clarity
    let prefix = "[VSC] ";
    if (level === 2) {
      console.log(prefix + "ERROR: " + message);
    } else if (level === 3) {
      console.log(prefix + "WARNING: " + message);
    } else if (level === 4) {
      console.log(prefix + "INFO: " + message);
    } else if (level === 5) {
      console.log(prefix + "DEBUG: " + message);
    } else if (level === 6) {
      console.log(prefix + "DEBUG (VERBOSE): " + message);
      console.trace();
    }
  }
}

chrome.storage.sync.get(tc.settings, function (storage) {
  // MODIFIED: Robust keyBinding initialization from storage or defaults.
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
          }, // Default value for reset action is 1.0
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
      version: "0.6.3.8"
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

  if (typeof storage.logLevel !== "undefined") {
    tc.settings.logLevel = Number(storage.logLevel);
  }
  // ADDED: Load nudge settings from storage
  tc.settings.enableSubtitleNudge =
    typeof storage.enableSubtitleNudge !== "undefined"
      ? Boolean(storage.enableSubtitleNudge)
      : tc.settings.enableSubtitleNudge;
  tc.settings.subtitleNudgeInterval =
    Number(storage.subtitleNudgeInterval) || 25; // Using 25ms as requested
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
  if (!tc.settings.keyBindings) return false; // ADDED: Guard against undefined keyBindings
  try {
    const binding = tc.settings.keyBindings.find(
      (item) => item.action === action
    );
    if (binding) return binding[what];
    // Fallback defaults for safety
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

// Original setKeyBindings, used by original resetSpeed logic.
function setKeyBindings(action, value) {
  if (!tc.settings.keyBindings) return; // ADDED: Guard
  const binding = tc.settings.keyBindings.find(
    (item) => item.action === action
  );
  if (binding) {
    binding["value"] = value;
    log(
      `In-memory value for keyBinding '${action}' set to ${value} by original setKeyBindings func`,
      6
    );
  }
}

function defineVideoController() {
  tc.videoController = function (target, parent) {
    if (target.vsc) {
      log(`VSC controller already exists for ${target.src || "video"}.`, 6);
      return target.vsc;
    }
    log(`Creating VSC controller for ${target.src || "video"}.`, 4);

    tc.mediaElements.push(target);
    target.vsc = this;

    this.video = target;
    this.parent = parent || target.parentElement;
    this.nudgeIntervalId = null; // ADDED: For the subtitle nudge feature

    // Original logic for determining initial speed
    let storedSpeed;
    if (!tc.settings.rememberSpeed) {
      storedSpeed = tc.settings.speeds[target.currentSrc];
      if (!storedSpeed) {
        log(
          "Overwriting stored speed to 1.0 due to rememberSpeed being disabled or no speed for src",
          5
        );
        storedSpeed = 1.0;
      }
      setKeyBindings("reset", getKeyBindings("fast")); // Original logic for 'R' key toggle state
    } else {
      log("Recalling stored speed due to rememberSpeed being enabled", 5);
      storedSpeed =
        tc.settings.speeds[target.currentSrc] || tc.settings.lastSpeed;
    }
    if (tc.settings.forceLastSavedSpeed) {
      storedSpeed = tc.settings.lastSpeed;
    }

    this.div = this.initializeControls();

    if (Math.abs(target.playbackRate - storedSpeed) > 0.001) {
      log(
        `Video current rate ${target.playbackRate.toFixed(2)} differs from VSC target ${storedSpeed.toFixed(2)}. Setting speed (initial).`,
        4
      );
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

    // Original mediaEventAction
    var mediaEventAction = function (event) {
      const video = event.target;
      if (!video.vsc) return;

      let speedToSet = tc.settings.speeds[video.currentSrc]; // Use 'let'
      if (!tc.settings.rememberSpeed) {
        if (!speedToSet) speedToSet = 1.0;
        setKeyBindings("reset", getKeyBindings("fast"));
      } else {
        speedToSet = tc.settings.lastSpeed;
      }
      if (tc.settings.forceLastSavedSpeed) speedToSet = tc.settings.lastSpeed;

      if (Math.abs(video.playbackRate - speedToSet) > 0.001) {
        log(
          `Media event '${event.type}': rate ${video.playbackRate.toFixed(2)} vs target ${speedToSet.toFixed(2)}. Setting.`,
          4
        );
        setSpeed(video, speedToSet, false); // MODIFIED: isInitialSet is false
      }

      // ADDED: Manage nudge based on event type
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
    ); // ADDED for nudge
    target.addEventListener(
      "ended",
      (this.handleEnded = mediaEventAction.bind(this))
    ); // ADDED for nudge
    target.addEventListener(
      "seeked",
      (this.handleSeek = mediaEventAction.bind(this))
    );

    var srcObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "attributes" &&
          (mutation.attributeName === "src" ||
            mutation.attributeName === "currentSrc")
        ) {
          if (!this.div) return; // MODIFIED: Check if div exists
          log(`Src changed to: ${mutation.target.currentSrc || "empty"}`, 4);
          this.stopSubtitleNudge(); // ADDED: Stop nudge for old src

          if (!mutation.target.src && !mutation.target.currentSrc) {
            this.div.classList.add("vsc-nosource");
          } else {
            this.div.classList.remove("vsc-nosource");
            let newSrcSpeed = tc.settings.speeds[mutation.target.currentSrc]; // MODIFIED: Follow original logic
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

    // ADDED: Initial nudge check
    if (!target.paused && target.playbackRate !== 1.0) {
      this.startSubtitleNudge();
    }
  };

  // --- Nudge Methods (ADDED) ---
  tc.videoController.prototype.startSubtitleNudge = function () {
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
    log(
      `Nudge: Starting for ${this.video.currentSrc || "video"} (Rate: ${this.video.playbackRate.toFixed(2)}) interval: ${tc.settings.subtitleNudgeInterval}ms.`,
      5
    );
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
      log(
        `Nudge: Stopping for ${this.video ? this.video.currentSrc || "video" : "detached video"}`,
        5
      );
      clearInterval(this.nudgeIntervalId);
      this.nudgeIntervalId = null;
    }
  };
  // --- End Nudge Methods ---

  tc.videoController.prototype.remove = function () {
    this.stopSubtitleNudge(); // ADDED
    // Original remove logic:
    if (this.div && this.div.parentNode) this.div.remove();
    if (this.video) {
      this.video.removeEventListener("play", this.handlePlay);
      this.video.removeEventListener("pause", this.handlePause); // ADDED
      this.video.removeEventListener("ended", this.handleEnded); // ADDED
      this.video.removeEventListener("seeked", this.handleSeek); // MODIFIED: was "seek" in original provided code
      delete this.video.vsc;
    }
    let idx = tc.mediaElements.indexOf(this.video);
    if (idx !== -1) tc.mediaElements.splice(idx, 1);
  };

  // Original initializeControls
  tc.videoController.prototype.initializeControls = function () {
    log("initializeControls Begin", 5);
    const doc = this.video.ownerDocument;
    const speedForUI = this.video.playbackRate.toFixed(2);
    var top = Math.max(this.video.offsetTop, 0) + "px",
      left = Math.max(this.video.offsetLeft, 0) + "px";
    log("Speed variable for UI set to: " + speedForUI, 5);
    var wrapper = doc.createElement("div");
    wrapper.classList.add("vsc-controller");
    if (!this.video.src && !this.video.currentSrc)
      wrapper.classList.add("vsc-nosource");
    if (tc.settings.startHidden) wrapper.classList.add("vsc-hidden");
    var shadow = wrapper.attachShadow({ mode: "open" });
    var shadowTemplate = `
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
    shadow.innerHTML = shadowTemplate;
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
    shadow.querySelectorAll("button").forEach((button) => {
      button.addEventListener(
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
      );
    });
    shadow
      .querySelector("#controller")
      .addEventListener("click", (e) => e.stopPropagation(), false);
    shadow
      .querySelector("#controller")
      .addEventListener("mousedown", (e) => e.stopPropagation(), false);
    var fragment = doc.createDocumentFragment();
    fragment.appendChild(wrapper);
    const parentEl = this.parent || this.video.parentElement;
    if (!parentEl || !parentEl.parentNode) {
      doc.body.appendChild(fragment);
      return wrapper;
    }
    // Original placement logic
    switch (true) {
      case location.hostname == "www.amazon.com":
      case location.hostname == "www.reddit.com":
      case /hbogo\./.test(location.hostname):
        parentEl.parentElement.insertBefore(fragment, parentEl);
        break;
      case location.hostname == "www.facebook.com":
        let p =
          parentEl.parentElement.parentElement.parentElement.parentElement
            .parentElement.parentElement.parentElement;
        if (p && p.firstChild) p.insertBefore(fragment, p.firstChild);
        else if (parentEl.firstChild)
          parentEl.insertBefore(fragment, parentEl.firstChild);
        else parentEl.appendChild(fragment);
        break;
      case location.hostname == "tv.apple.com":
        const appleRoot = parentEl.getRootNode();
        const scrim =
          appleRoot && appleRoot.querySelector
            ? appleRoot.querySelector(".scrim")
            : null;
        if (scrim) scrim.prepend(fragment);
        else parentEl.insertBefore(fragment, parentEl.firstChild);
        break;
      default:
        parentEl.insertBefore(fragment, parentEl.firstChild);
    }
    return wrapper;
  };
}

function escapeStringRegExp(str) {
  const matchOperatorsRe = /[|\\{}()[\]^$+*?.]/g;
  return str.replace(matchOperatorsRe, "\\$&");
}
function isBlacklisted() {
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

var coolDown = false;
function refreshCoolDown() {
  log("Begin refreshCoolDown", 5);
  if (coolDown) clearTimeout(coolDown);
  coolDown = setTimeout(function () {
    coolDown = false;
  }, 1000);
  // log("End refreshCoolDown", 6); // Original log level was 5
}

function setupListener() {
  if (document.vscRateListenerAttached) return; // MODIFIED: Ensure flag check

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
      if (chrome.runtime.lastError)
        log(`Error saving lastSpeed: ${chrome.runtime.lastError.message}`, 2);
    });

    // MODIFIED: Only "blink" (show controller) if change was from user input
    if (fromUserInput) {
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
        // log("Ratechange event during nudge, VSC UI/state update skipped. Allowing propagation for YT.", 6);
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
      let isFromUserInputForBlink = false; // MODIFIED: Flag to control blink

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
          isFromUserInputForBlink = event.detail.fromUserInput !== false; // Respect passed flag
          updateSpeedFromEvent(video, isFromUserInputForBlink);
          event.stopImmediatePropagation();
        } else {
          if (Math.abs(video.playbackRate - tc.settings.lastSpeed) > 0.001) {
            log(
              `Ratechange (Force ON): Discrepancy. Video rate: ${video.playbackRate.toFixed(2)}, VSC wants: ${tc.settings.lastSpeed.toFixed(2)}. Forcing.`,
              3
            );
            video.playbackRate = tc.settings.lastSpeed;
            event.stopImmediatePropagation();
            // The next ratechange will be from VSC forcing, consider that not direct user input for blink
            // updateSpeedFromEvent will be called by that next event.
          } else {
            updateSpeedFromEvent(video, false); // Not user input, just confirming forced speed
          }
        }
      } else {
        // forceLastSavedSpeed is OFF
        // Determine if it was a VSC-initiated user action (like S/D keys)
        // The `setSpeed` function, when called by `runAction`, doesn't add a special origin detail
        // when forceLastSavedSpeed is off. So, a native ratechange event fires.
        // We assume if forceLastSavedSpeed is off, any rate change processed here
        // that isn't a nudge IS significant enough to update UI state.
        // The "blink" should happen if tc.settings.lastSpeed *changed* due to this event,
        // implying it wasn't just a confirmation of existing speed.
        const oldLastSpeed = tc.settings.lastSpeed;
        updateSpeedFromEvent(video, false); // Initially assume not user-driven for blink
        if (
          Math.abs(oldLastSpeed - tc.settings.lastSpeed) > 0.001 &&
          oldLastSpeed !== 1.0 &&
          tc.settings.lastSpeed !== 1.0
        ) {
          // If lastSpeed actually changed due to this event, it was likely a user action via VSC
          // or a significant external change. Trigger blink.
          // Exception: don't blink if going to/from 1.0x as that's often a reset.
          // This logic is imperfect for determining "user input" when not forcing.
          // A cleaner way would be if setSpeed could flag the *next* native event.
          // For now, this is a heuristic.
          if (!tc.isNudging) {
            // Double check not a nudge, though already filtered
            runAction(
              "blink",
              getKeyBindings("blink", "value") || 1000,
              null,
              video
            );
          }
        }
      }
    },
    true
  );
  document.vscRateChangeListenerAttached = true; // MODIFIED: Ensure flag is set
}

// MODIFIED: More robust initialization flow with unique flags
var vscInitializedDocuments = new Set();
function initializeWhenReady(doc) {
  if (doc.vscInitWhenReadyCalledFullUniqueFlag && doc.readyState !== "loading")
    return;
  doc.vscInitWhenReadyCalledFullUniqueFlag = true;
  if (isBlacklisted()) {
    return;
  }
  log(
    `initializeWhenReady for: ${doc.location ? doc.location.href : "iframe"}. ReadyState: ${doc.readyState}`,
    5
  );

  if (doc === window.document && !window.vscPageLoadListenerFullUniqueFlag) {
    window.addEventListener("load", () => initializeNow(window.document), {
      once: true
    });
    window.vscPageLoadListenerFullUniqueFlag = true;
  }
  if (doc.readyState === "complete") {
    initializeNow(doc);
  } else {
    if (!doc.vscReadyStateListenerFullUniqueFlag) {
      doc.addEventListener(
        "readystatechange",
        function onRSChange_VSC_Final_Unique_CB() {
          if (doc.readyState === "complete") {
            doc.removeEventListener(
              "readystatechange",
              onRSChange_VSC_Final_Unique_CB
            );
            initializeNow(doc);
          }
        }
      );
      doc.vscReadyStateListenerFullUniqueFlag = true;
    }
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
    log("VSC is disabled.", 4);
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
    if (!lDoc.vscKeydownListenerUniqueFlagB) {
      // Different flag
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
      lDoc.vscKeydownListenerUniqueFlagB = true;
    }
  });
  if (!doc.vscMutationObserverUniqueFlagB) {
    // Different flag
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
    doc.vscMutationObserverUniqueFlagB = true;
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

// MODIFIED setSpeed to accept `isInitialCall` and use it for `fromUserInput`
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
      // Before changing rate, set a flag that this is VSC initiated for non-forced mode
      video.vscIsSettingRate = !isInitialCall; // True if user action, false if initial
      video.playbackRate = numericSpeed;
      // Flag will be cleared by ratechange listener after processing
    }
  }
  if (!isInitialCall) refreshCoolDown();
  if (video.vsc) {
    if (numericSpeed === 1.0 || video.paused) video.vsc.stopSubtitleNudge();
    else video.vsc.startSubtitleNudge();
  }
}

// MODIFIED runAction to pass 4th arg `specificVideo` to some internal calls if needed.
// And pass `isInitialCall=false` to setSpeed calls.
function runAction(action, value, e, specificVideo = null) {
  // ... (robust mediaTagsToProcess logic from previous correct version) ...
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
  var originalActionForResetContext = actionBeingProcessedForReset_ctx; // Use a local context var
  actionBeingProcessedForReset_ctx = action;

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
      // MODIFIED: Calls new resetSpeed directly
      case "reset":
        resetSpeedSimple(v, 1.0);
        break;
      case "fast":
        resetSpeedSimple(v, numValue);
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
  actionBeingProcessedForReset_ctx = originalActionForResetContext;
}
var actionBeingProcessedForReset_ctx = null; // Context for original resetSpeed

function pause(v) {
  if (v.paused) v.play().catch((e) => log(`Play err:${e.message}`, 2));
  else v.pause();
}

// MODIFIED: New simpler resetSpeed function
function resetSpeedSimple(v, targetActionSpeed) {
  log(
    `resetSpeedSimple: Video current: ${v.playbackRate.toFixed(2)}, Target for this action: ${targetActionSpeed.toFixed(2)}`,
    4
  );
  const fastPreferredSpeed = getKeyBindings("fast", "value") || 1.8;

  if (targetActionSpeed === 1.0) {
    // Action was "reset" (R key)
    if (Math.abs(v.playbackRate - 1.0) < 0.01) {
      setSpeed(v, fastPreferredSpeed, false);
    } else {
      setSpeed(v, 1.0, false);
    }
  } else {
    // Action was "fast" (G key), targetActionSpeed is the preferred speed
    if (Math.abs(v.playbackRate - targetActionSpeed) < 0.01) {
      setSpeed(v, 1.0, false);
    } else {
      setSpeed(v, targetActionSpeed, false);
    }
  }
}
// Remove or comment out the old `resetSpeed` function that uses setKeyBindings and actionBeingProcessedForReset_global
/*
function resetSpeed(v, target) { // THIS IS THE OLD ONE TO BE REPLACED by resetSpeedSimple
  // ... original complex logic ...
}
*/

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
  /* ... same original ... */
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
  /* ... same original ... */
  if (!controller || typeof controller.classList === "undefined") return;
  controller.classList.add("vcs-show");
  if (timer) clearTimeout(timer);
  timer = setTimeout(function () {
    if (controller && controller.classList)
      controller.classList.remove("vsc-show");
    timer = false;
  }, 2000);
}
