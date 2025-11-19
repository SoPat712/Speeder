var regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;

var isUserSeek = false; // Track if seek was user-initiated
var lastToggleSpeed = {}; // Store last toggle speeds per video

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
    logLevel: 5, // Set to 5 to see your debug logs
    enableSubtitleNudge: true,
    subtitleNudgeInterval: 25,
    subtitleNudgeAmount: 0.001
  },
  mediaElements: [],
  isNudging: false
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
  // Original initialization from your code
  tc.settings.keyBindings = storage.keyBindings;
  if (storage.keyBindings.length == 0) {
    tc.settings.keyBindings.push({
      action: "slower",
      key: Number(storage.slowerKeyCode) || 83,
      value: Number(storage.speedStep) || 0.1,
      force: false,
      predefined: true
    });
    tc.settings.keyBindings.push({
      action: "faster",
      key: Number(storage.fasterKeyCode) || 68,
      value: Number(storage.speedStep) || 0.1,
      force: false,
      predefined: true
    });
    tc.settings.keyBindings.push({
      action: "rewind",
      key: Number(storage.rewindKeyCode) || 90,
      value: Number(storage.rewindTime) || 10,
      force: false,
      predefined: true
    });
    tc.settings.keyBindings.push({
      action: "advance",
      key: Number(storage.advanceKeyCode) || 88,
      value: Number(storage.advanceTime) || 10,
      force: false,
      predefined: true
    });
    tc.settings.keyBindings.push({
      action: "reset",
      key: Number(storage.resetKeyCode) || 82,
      value: 1.0,
      force: false,
      predefined: true
    });
    tc.settings.keyBindings.push({
      action: "fast",
      key: Number(storage.fastKeyCode) || 71,
      value: Number(storage.fastSpeed) || 1.8,
      force: false,
      predefined: true
    });
    tc.settings.version = "0.5.3";
    chrome.storage.sync.set({
      keyBindings: tc.settings.keyBindings,
      version: tc.settings.version,
      displayKeyCode: tc.settings.displayKeyCode,
      rememberSpeed: tc.settings.rememberSpeed,
      forceLastSavedSpeed: tc.settings.forceLastSavedSpeed,
      audioBoolean: tc.settings.audioBoolean,
      startHidden: tc.settings.startHidden,
      enabled: tc.settings.enabled,
      controllerOpacity: tc.settings.controllerOpacity,
      blacklist: tc.settings.blacklist.replace(regStrip, "")
    });
  }
  tc.settings.lastSpeed = Number(storage.lastSpeed);
  tc.settings.displayKeyCode = Number(storage.displayKeyCode);
  tc.settings.rememberSpeed = Boolean(storage.rememberSpeed);
  tc.settings.forceLastSavedSpeed = Boolean(storage.forceLastSavedSpeed);
  tc.settings.audioBoolean = Boolean(storage.audioBoolean);
  tc.settings.enabled = Boolean(storage.enabled);
  tc.settings.startHidden = Boolean(storage.startHidden);
  tc.settings.controllerOpacity = Number(storage.controllerOpacity);
  tc.settings.blacklist = String(storage.blacklist);
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
      key: Number(storage.displayKeyCode) || 86,
      value: 0,
      force: false,
      predefined: true
    });
  }
  // Add a listener for messages from the popup.
  // We use a global flag to ensure the listener is only attached once.
  if (!window.vscMessageListener) {
    chrome.runtime.onMessage.addListener(
      function (request, sender, sendResponse) {
        // Check if the message is a request to re-scan the page.
        if (request.action === "rescan_page") {
          log("Re-scan command received from popup.", 4);

          // Call the main initialization function. It's designed to be safe
          // to run multiple times and will pick up any new videos.
          initializeWhenReady(document);

          // Send a response to the popup to confirm completion.
          sendResponse({ status: "complete" });
        }

        // Required to allow for asynchronous responses.
        return true;
      }
    );

    // Set the flag to prevent adding the listener again.
    window.vscMessageListener = true;
  }
  initializeWhenReady(document);
});

function getKeyBindings(action, what = "value") {
  try {
    return tc.settings.keyBindings.find((item) => item.action === action)[what];
  } catch (e) {
    return false;
  }
}
function setKeyBindings(action, value) {
  tc.settings.keyBindings.find((item) => item.action === action)["value"] =
    value;
}

function defineVideoController() {
  tc.videoController = function (target, parent) {
    if (target.vsc) return target.vsc;
    tc.mediaElements.push(target);
    target.vsc = this;
    this.video = target;
    this.parent = target.parentElement || parent;
    this.nudgeAnimationId = null;

    log(`Creating video controller for ${target.tagName} with src: ${target.src || target.currentSrc || 'none'}`, 4);

    // Determine what speed to use
    let storedSpeed = tc.settings.speeds[target.currentSrc];
    if (!tc.settings.rememberSpeed) {
      if (!storedSpeed) {
        storedSpeed = 1.0;
      }
    } else {
      storedSpeed = tc.settings.lastSpeed;
    }
    if (tc.settings.forceLastSavedSpeed) {
      storedSpeed = tc.settings.lastSpeed;
    }

    // FIXED: Actually apply the speed to the video element
    // Use setSpeed function to properly set the speed with all the necessary logic
    setTimeout(() => {
      if (this.video && this.video.vsc) {
        setSpeed(this.video, storedSpeed, true, false);
      }
    }, 0);

    this.div = this.initializeControls();

    if (!this.div) {
      log("ERROR: Failed to create controller div!", 2);
      return;
    }

    log(`Controller created and attached to DOM. Hidden: ${this.div.classList.contains('vsc-hidden')}`, 4);

    // Make the controller visible for 5 seconds on startup
    runAction("blink", 5000, null, this.video);

    // Rewritten mediaEventAction to prevent speed reset on pause.
    var mediaEventAction = function (event) {
      // Handle subtitle nudging based on the event type first.
      if (event.type === "play") {
        this.startSubtitleNudge();

        // FIXED: Only reapply speed if there's a significant mismatch AND it's a new video
        const currentSpeed = event.target.playbackRate;
        const videoId =
          event.target.currentSrc || event.target.src || "default";

        // Get the expected speed based on settings
        let expectedSpeed;
        if (tc.settings.forceLastSavedSpeed) {
          expectedSpeed = tc.settings.lastSpeed;
        } else {
          expectedSpeed = tc.settings.speeds[videoId] || tc.settings.lastSpeed;
        }

        // Only reapply speed if:
        // 1. The current speed is 1.0 (default) AND we have a stored speed that's different
        // 2. OR if forceLastSavedSpeed is enabled and speeds don't match
        const shouldReapplySpeed =
          (Math.abs(currentSpeed - 1.0) < 0.01 &&
            Math.abs(expectedSpeed - 1.0) > 0.01) ||
          (tc.settings.forceLastSavedSpeed &&
            Math.abs(currentSpeed - expectedSpeed) > 0.01);

        if (shouldReapplySpeed) {
          setTimeout(() => {
            if (event.target.vsc) {
              setSpeed(event.target, expectedSpeed, false, false);
            }
          }, 10);
        }
      } else if (event.type === "pause" || event.type === "ended") {
        this.stopSubtitleNudge();
        tc.isNudging = false;
      }

      // For seek events, don't mess with speed
      if (event.type === "seeked" && isUserSeek) {
        isUserSeek = false;
        return;
      }
    };

    target.addEventListener(
      "play",
      (this.handlePlay = mediaEventAction.bind(this))
    );
    target.addEventListener(
      "pause",
      (this.handlePause = mediaEventAction.bind(this))
    );
    target.addEventListener(
      "ended",
      (this.handleEnded = mediaEventAction.bind(this))
    );
    target.addEventListener(
      "seeked",
      (this.handleSeek = mediaEventAction.bind(this))
    );

    // ADDITIONAL FIX: Listen for loadedmetadata to reapply speed when video source changes
    target.addEventListener("loadedmetadata", () => {
      if (this.video && this.video.vsc) {
        const currentSpeed = this.video.playbackRate;
        const videoId = this.video.currentSrc || this.video.src || "default";

        // Get expected speed
        let expectedSpeed;
        if (tc.settings.forceLastSavedSpeed) {
          expectedSpeed = tc.settings.lastSpeed;
        } else {
          expectedSpeed = tc.settings.speeds[videoId] || tc.settings.lastSpeed;
        }

        // Only reapply if current speed is default (1.0) and we have a different stored speed
        const shouldReapplySpeed =
          Math.abs(currentSpeed - 1.0) < 0.01 &&
          Math.abs(expectedSpeed - 1.0) > 0.01;

        if (shouldReapplySpeed) {
          setSpeed(this.video, expectedSpeed, false, false);
        }
      }
    });

    var srcObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "attributes" &&
          (mutation.attributeName === "src" ||
            mutation.attributeName === "currentSrc")
        ) {
          if (this.div) {
            this.stopSubtitleNudge();
            if (!mutation.target.src && !mutation.target.currentSrc) {
              this.div.classList.add("vsc-nosource");
            } else {
              this.div.classList.remove("vsc-nosource");

              // FIXED: Reapply speed when source changes (like in shorts)
              const expectedSpeed = tc.settings.forceLastSavedSpeed
                ? tc.settings.lastSpeed
                : tc.settings.speeds[mutation.target.currentSrc] ||
                tc.settings.lastSpeed;

              setTimeout(() => {
                if (mutation.target.vsc) {
                  setSpeed(mutation.target, expectedSpeed, false, false);
                }
              }, 100);

              if (!mutation.target.paused) this.startSubtitleNudge();
            }
          }
        }
      });
    });
    srcObserver.observe(target, { attributeFilter: ["src", "currentSrc"] });
    if (!target.paused && target.playbackRate !== 1.0)
      this.startSubtitleNudge();
  };

  tc.videoController.prototype.remove = function () {
    this.stopSubtitleNudge();
    if (this.div) this.div.remove();
    if (this.video) {
      this.video.removeEventListener("play", this.handlePlay);
      this.video.removeEventListener("pause", this.handlePause);
      this.video.removeEventListener("ended", this.handleEnded);
      this.video.removeEventListener("seeked", this.handleSeek);
      delete this.video.vsc;
    }
    let idx = tc.mediaElements.indexOf(this.video);
    if (idx != -1) tc.mediaElements.splice(idx, 1);
  };

  tc.videoController.prototype.startSubtitleNudge = function () {
    const isYouTube =
      (this.video &&
        this.video.currentSrc &&
        this.video.currentSrc.includes("googlevideo.com")) ||
      location.hostname.includes("youtube.com");
    if (
      !isYouTube ||
      !tc.settings.enableSubtitleNudge ||
      this.nudgeAnimationId !== null ||
      !this.video ||
      this.video.paused ||
      this.video.playbackRate === 1.0
    ) {
      return;
    }

    const performNudge = () => {
      // Check if we should stop
      if (!this.video || this.video.paused || this.video.playbackRate === 1.0) {
        this.stopSubtitleNudge();
        return;
      }

      const currentRate = this.video.playbackRate;
      const nudgeAmount = tc.settings.subtitleNudgeAmount;

      // Apply nudge
      this.video.playbackRate = currentRate + nudgeAmount;

      // Revert on next frame
      requestAnimationFrame(() => {
        if (this.video) {
          this.video.playbackRate = currentRate;
        }
      });

      // Schedule next nudge using setTimeout instead of continuous RAF loop
      this.nudgeAnimationId = setTimeout(performNudge, tc.settings.subtitleNudgeInterval);
    };

    // Start the first nudge
    this.nudgeAnimationId = setTimeout(performNudge, tc.settings.subtitleNudgeInterval);
    log(`Nudge: Starting with interval ${tc.settings.subtitleNudgeInterval}ms.`, 5);
  };

  tc.videoController.prototype.stopSubtitleNudge = function () {
    if (this.nudgeAnimationId !== null) {
      clearTimeout(this.nudgeAnimationId);
      this.nudgeAnimationId = null;
      log(`Nudge: Stopping.`, 5);
    }
  };

  tc.videoController.prototype.performImmediateNudge = function () {
    const isYouTube =
      (this.video &&
        this.video.currentSrc &&
        this.video.currentSrc.includes("googlevideo.com")) ||
      location.hostname.includes("youtube.com");
    
    if (
      !isYouTube ||
      !tc.settings.enableSubtitleNudge ||
      !this.video ||
      this.video.paused ||
      this.video.playbackRate === 1.0
    ) {
      return;
    }

    const currentRate = this.video.playbackRate;
    const nudgeAmount = tc.settings.subtitleNudgeAmount;

    // Apply nudge
    this.video.playbackRate = currentRate + nudgeAmount;

    // Revert on next frame
    requestAnimationFrame(() => {
      if (this.video) {
        this.video.playbackRate = currentRate;
      }
    });

    log(`Immediate nudge performed at rate ${currentRate.toFixed(2)}`, 5);
  };

  tc.videoController.prototype.initializeControls = function () {
    const doc = this.video.ownerDocument;
    const speed = this.video.playbackRate.toFixed(2);
    // Fix for videos rendered after page load - use relative positioning
    var top = "10px",
      left = "10px";

    // Try to get actual position, but fallback to default if not available
    if (this.video.offsetTop > 0 || this.video.offsetLeft > 0) {
      top = Math.max(this.video.offsetTop, 0) + "px";
      left = Math.max(this.video.offsetLeft, 0) + "px";
    }
    var wrapper = doc.createElement("div");
    wrapper.classList.add("vsc-controller");
    if (!this.video.src && !this.video.currentSrc)
      wrapper.classList.add("vsc-nosource");
    if (tc.settings.startHidden) wrapper.classList.add("vsc-hidden");
    var shadow = wrapper.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style> @import "${chrome.runtime.getURL("shadow.css")}"; </style><div id="controller" style="top:${top}; left:${left}; opacity:${tc.settings.controllerOpacity}"><span data-action="drag" class="draggable">${speed}</span><span id="controls"><button data-action="rewind" class="rw">«</button><button data-action="slower">−</button><button data-action="faster">+</button><button data-action="advance" class="rw">»</button><button data-action="display" class="hideButton">×</button></span></div>`;
    this.speedIndicator = shadow.querySelector(".draggable");
    shadow.querySelector(".draggable").addEventListener(
      "mousedown",
      (e) => {
        runAction(
          e.target.dataset["action"],
          getKeyBindings(e.target.dataset["action"], "value"),
          e
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
            e
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

    log(`Inserting controller: parentEl=${!!parentEl}, parentNode=${!!parentEl?.parentNode}, hostname=${location.hostname}`, 4);

    if (!parentEl || !parentEl.parentNode) {
      log("No suitable parent found, appending to body", 4);
      doc.body.appendChild(fragment);
      return wrapper;
    }

    try {
      switch (true) {
        case location.hostname == "www.amazon.com":
        case location.hostname == "www.reddit.com":
        case /hbogo\./.test(location.hostname):
          log("Using parentElement.parentElement insertion", 5);
          parentEl.parentElement.insertBefore(fragment, parentEl);
          break;
        case location.hostname == "www.facebook.com":
          log("Using Facebook-specific insertion", 5);
          let p =
            parentEl.parentElement.parentElement.parentElement.parentElement
              .parentElement.parentElement.parentElement;
          if (p && p.firstChild) p.insertBefore(fragment, p.firstChild);
          else parentEl.insertBefore(fragment, parentEl.firstChild);
          break;
        case location.hostname == "tv.apple.com":
          log("Using Apple TV-specific insertion", 5);
          const r = parentEl.getRootNode();
          const s = r && r.querySelector ? r.querySelector(".scrim") : null;
          if (s) s.prepend(fragment);
          else parentEl.insertBefore(fragment, parentEl.firstChild);
          break;
        default:
          log("Using default insertion method", 5);
          parentEl.insertBefore(fragment, parentEl.firstChild);
      }
      log("Controller successfully inserted into DOM", 4);
    } catch (error) {
      log(`Error inserting controller: ${error.message}`, 2);
      // Fallback to body insertion
      doc.body.appendChild(fragment);
    }

    return wrapper;
  };
}

function escapeStringRegExp(str) {
  const m = /[|\\{}()[\]^$+*?.]/g;
  return str.replace(m, "\\$&");
}
function isBlacklisted() {
  let b = false;
  const l = tc.settings.blacklist ? tc.settings.blacklist.split("\n") : [];
  l.forEach((m) => {
    if (b) return;
    m = m.replace(regStrip, "");
    if (m.length == 0) return;
    let r;
    if (m.startsWith("/") && m.lastIndexOf("/") > 0) {
      try {
        const ls = m.lastIndexOf("/");
        r = new RegExp(m.substring(1, ls), m.substring(ls + 1));
      } catch (e) {
        log(`Invalid regex: ${m}. ${e.message}`, 2);
        return;
      }
    } else r = new RegExp(escapeStringRegExp(m));
    if (r && r.test(location.href)) b = true;
  });
  if (b) log(`Page ${location.href} blacklisted.`, 4);
  return b;
}
var coolDown = false;
function refreshCoolDown() {
  if (coolDown) clearTimeout(coolDown);
  coolDown = setTimeout(function () {
    coolDown = false;
  }, 1000);
}

function setupListener() {
  if (document.vscRateListenerAttached) return;
  function updateSpeedFromEvent(video, fromUserInput = false) {
    if (!video.vsc || !video.vsc.speedIndicator) return;
    var speed = Number(video.playbackRate.toFixed(2));
    video.vsc.speedIndicator.textContent = speed.toFixed(2);
    tc.settings.speeds[video.currentSrc || "unknown_src"] = speed;
    tc.settings.lastSpeed = speed;
    chrome.storage.sync.set({ lastSpeed: speed }, () => { });
    if (fromUserInput) {
      runAction("blink", 1000, null, video);
    }
    if (video.vsc) {
      if (speed === 1.0 || video.paused) video.vsc.stopSubtitleNudge();
      else video.vsc.startSubtitleNudge();
    }
  }
  document.addEventListener(
    "ratechange",
    function (event) {
      if (tc.isNudging) return;
      if (coolDown) {
        event.stopImmediatePropagation();
        return;
      }
      var video = event.target;
      if (!video || typeof video.playbackRate === "undefined" || !video.vsc)
        return;
      if (tc.settings.forceLastSavedSpeed) {
        if (event.detail && event.detail.origin === "videoSpeed") {
          video.playbackRate = event.detail.speed;
          updateSpeedFromEvent(video, event.detail.fromUserInput === true);
        } else {
          video.playbackRate = tc.settings.lastSpeed;
        }
        event.stopImmediatePropagation();
      } else {
        updateSpeedFromEvent(video, video.vscIsDirectlySettingRate === true);
        if (video.vscIsDirectlySettingRate)
          delete video.vscIsDirectlySettingRate;
      }
    },
    true
  );
  document.vscRateListenerAttached = true;
}

var vscInitializedDocuments = new Set();
function initializeWhenReady(doc, forceReinit = false) {
  if (!forceReinit && vscInitializedDocuments.has(doc) || !doc.body) return;

  // For navigation changes, we want to re-scan even if already initialized
  if (forceReinit) {
    log("Force re-initialization requested", 4);
  }

  if (doc.readyState === "complete") {
    initializeNow(doc, forceReinit);
  } else {
    doc.addEventListener("DOMContentLoaded", () => initializeNow(doc, forceReinit), {
      once: true
    });
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
  let r = [];
  function gC(p) {
    if (p.firstElementChild) {
      var c = p.firstElementChild;
      do {
        r.push(c);
        gC(c);
        if (c.shadowRoot) {
          r.push(...getShadow(c.shadowRoot));
          // Also check for videos in shadow DOM
          const shadowVideos = c.shadowRoot.querySelectorAll(tc.settings.audioBoolean ? "video,audio" : "video");
          shadowVideos.forEach(video => {
            if (!video.vsc) {
              log(`Found video in shadow DOM`, 5);
              checkForVideo(video, video.parentElement, true);
            }
          });
        }
        c = c.nextElementSibling;
      } while (c);
    }
  }
  gC(parent);
  return r;
}

function initializeNow(doc, forceReinit = false) {
  if (!forceReinit && (vscInitializedDocuments.has(doc) || !doc.body)) return;
  if (!tc.settings.enabled) return;

  if (!doc.body.classList.contains("vsc-initialized"))
    doc.body.classList.add("vsc-initialized");
  if (typeof tc.videoController === "undefined") defineVideoController();
  setupListener();

  var docs = Array(doc);
  try {
    if (inIframe()) docs.push(window.top.document);
  } catch (e) { }
  docs.forEach(function (d) {
    if (d.vscKeydownListenerAttached) return; // Prevent duplicate listeners
    d.addEventListener(
      "keydown",
      function (event) {
        var keyCode = event.keyCode;
        if (
          !event.getModifierState ||
          event.getModifierState("Alt") ||
          event.getModifierState("Control") ||
          event.getModifierState("Fn") ||
          event.getModifierState("Meta") ||
          event.getModifierState("Hyper") ||
          event.getModifierState("OS")
        )
          return;
        if (
          event.target.nodeName === "INPUT" ||
          event.target.nodeName === "TEXTAREA" ||
          event.target.isContentEditable
        )
          return;
        if (!tc.mediaElements.length) return;
        var item = tc.settings.keyBindings.find((item) => item.key === keyCode);
        if (item) {
          runAction(item.action, item.value, event);
          if (item.force === "true") {
            event.preventDefault();
            event.stopPropagation();
          }
        }
        return false;
      },
      true
    );
    d.vscKeydownListenerAttached = true;
  });

  if (!doc.vscMutationObserverAttached) {
    const observer = new MutationObserver(function (mutations) {
      requestIdleCallback(
        (_) => {
          mutations.forEach(function (mutation) {
            switch (mutation.type) {
              case "childList":
                mutation.addedNodes.forEach(function (node) {
                  if (typeof node === "function") return;
                  checkForVideo(node, node.parentNode || mutation.target, true);
                });
                mutation.removedNodes.forEach(function (node) {
                  if (typeof node === "function") return;
                  checkForVideo(
                    node,
                    node.parentNode || mutation.target,
                    false
                  );
                });
                break;
              case "attributes":
                // Enhanced attribute monitoring for video detection
                const target = mutation.target;
                if (target.tagName === "VIDEO" || target.tagName === "AUDIO") {
                  // Video/audio element had attributes changed - check if it needs controller
                  if (!target.vsc && (target.src || target.currentSrc)) {
                    checkForVideo(target, target.parentNode, true);
                  }
                } else if (
                  target.attributes["aria-hidden"] &&
                  target.attributes["aria-hidden"].value == "false"
                ) {
                  var flattenedNodes = getShadow(document.body);
                  var node = flattenedNodes.filter(
                    (x) => x.tagName == "VIDEO"
                  )[0];
                  if (node) {
                    if (node.vsc) node.vsc.remove();
                    checkForVideo(
                      node,
                      node.parentNode || mutation.target,
                      true
                    );
                  }
                }
                break;
            }
          });
        },
        { timeout: 1000 }
      );
    });
    function checkForVideo(node, parent, added) {
      if (!added && document.body.contains(node)) return;
      if (
        node.nodeName === "VIDEO" ||
        (node.nodeName === "AUDIO" && tc.settings.audioBoolean)
      ) {
        if (added) {
          if (!node.vsc) {
            log(`Creating controller for ${node.tagName}: ${node.src || node.currentSrc || 'no src'}`, 4);
            node.vsc = new tc.videoController(node, parent);

            // Verify controller was created successfully
            if (!node.vsc || !node.vsc.div) {
              log(`ERROR: Controller creation failed for ${node.tagName}`, 2);
            } else {
              log(`Controller created successfully, div in DOM: ${document.contains(node.vsc.div)}`, 4);
            }

            // Add to intersection observer if available
            if (doc.vscVideoIntersectionObserver) {
              doc.vscVideoIntersectionObserver.observe(node);
            }
          }
        } else {
          if (node.vsc) {
            node.vsc.remove();
            // Remove from intersection observer if available
            if (doc.vscVideoIntersectionObserver) {
              doc.vscVideoIntersectionObserver.unobserve(node);
            }
          }
        }
      } else if (node.children != undefined) {
        for (var i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          checkForVideo(child, child.parentNode || parent, added);
        }
      }
    }
    observer.observe(doc, {
      attributeFilter: ["aria-hidden", "src", "currentSrc", "style", "class"],
      childList: true,
      subtree: true,
      attributes: true
    });
    doc.vscMutationObserverAttached = true;
  }

  const q = tc.settings.audioBoolean ? "video,audio" : "video";
  const foundVideos = doc.querySelectorAll(q);
  foundVideos.forEach((v) => {
    if (!v.vsc) new tc.videoController(v, v.parentElement);
  });

  // Enhanced video detection via media events
  if (!doc.vscMediaEventListenersAttached) {
    const mediaEvents = ['loadstart', 'loadedmetadata', 'canplay', 'play'];
    mediaEvents.forEach(eventType => {
      doc.addEventListener(eventType, function (event) {
        const target = event.target;
        if ((target.tagName === 'VIDEO' || (target.tagName === 'AUDIO' && tc.settings.audioBoolean)) && !target.vsc) {
          log(`Media event ${eventType} detected new ${target.tagName.toLowerCase()}`, 5);
          checkForVideo(target, target.parentElement, true);
        }
      }, true);
    });
    doc.vscMediaEventListenersAttached = true;
  }

  // Intersection Observer for lazy-loaded videos
  if (!doc.vscIntersectionObserverAttached && 'IntersectionObserver' in window) {
    const videoIntersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const target = entry.target;
          if ((target.tagName === 'VIDEO' || (target.tagName === 'AUDIO' && tc.settings.audioBoolean)) && !target.vsc) {
            log(`Intersection observer detected visible ${target.tagName.toLowerCase()}`, 5);
            checkForVideo(target, target.parentElement, true);
          }
        }
      });
    }, { threshold: 0.1 });

    // Observe existing videos that might not have been processed
    doc.querySelectorAll(q).forEach(video => {
      videoIntersectionObserver.observe(video);
    });

    // Store observer to add new videos to it
    doc.vscVideoIntersectionObserver = videoIntersectionObserver;
    doc.vscIntersectionObserverAttached = true;
  }

  Array.from(doc.getElementsByTagName("iframe")).forEach((f) => {
    if (f.vscLoadListenerAttached) return;
    f.addEventListener("load", () => {
      try {
        if (f.contentDocument) {
          initializeWhenReady(f.contentDocument);
        }
      } catch (e) {
        // Silently ignore CORS errors
      }
    });
    f.vscLoadListenerAttached = true;
    try {
      if (f.contentDocument) {
        initializeWhenReady(f.contentDocument);
      }
    } catch (e) {
      // Silently ignore CORS errors
    }
  });
  // Navigation change detection for SPAs
  if (!doc.vscNavigationListenersAttached) {
    let currentUrl = location.href;

    const handleNavigation = (source) => {
      if (location.href !== currentUrl) {
        const oldUrl = currentUrl;
        currentUrl = location.href;
        log(`Navigation detected via ${source}: ${oldUrl} -> ${currentUrl}`, 4);

        // Wait a bit for the new content to load, then force re-scan
        setTimeout(() => {
          const q = tc.settings.audioBoolean ? "video,audio" : "video";
          const videos = document.querySelectorAll(q);
          log(`Post-navigation scan found ${videos.length} videos`, 4);

          videos.forEach(video => {
            if (!video.vsc) {
              log(`Adding controller to post-navigation video`, 4);
              checkForVideo(video, video.parentElement, true);
            }
          });
        }, 500); // Increased delay for content to load

        // Also do a quicker scan
        setTimeout(() => {
          const q = tc.settings.audioBoolean ? "video,audio" : "video";
          const videos = document.querySelectorAll(q);
          videos.forEach(video => {
            if (!video.vsc && (video.src || video.currentSrc)) {
              checkForVideo(video, video.parentElement, true);
            }
          });
        }, 100);
      }
    };

    // Listen for popstate (back/forward navigation)
    window.addEventListener('popstate', () => handleNavigation('popstate'));

    // Override pushState and replaceState to catch programmatic navigation
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      handleNavigation('pushState');
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      handleNavigation('replaceState');
    };

    // Listen for hashchange as well
    window.addEventListener('hashchange', () => handleNavigation('hashchange'));

    // Also intercept fetch and XMLHttpRequest for AJAX-heavy sites
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      return originalFetch.apply(this, args).then(response => {
        // After any fetch completes, check for new videos
        setTimeout(() => {
          const q = tc.settings.audioBoolean ? "video,audio" : "video";
          const videos = document.querySelectorAll(q);
          videos.forEach(video => {
            if (!video.vsc && (video.src || video.currentSrc || video.readyState > 0)) {
              log(`Post-fetch scan found video`, 5);
              checkForVideo(video, video.parentElement, true);
            }
          });
        }, 200);
        return response;
      });
    };

    doc.vscNavigationListenersAttached = true;
  }

  // Periodic fallback scan for missed videos
  if (!doc.vscPeriodicScanAttached) {
    const periodicScan = () => {
      const q = tc.settings.audioBoolean ? "video,audio" : "video";
      const allVideos = doc.querySelectorAll(q);
      let foundNew = false;

      allVideos.forEach(video => {
        if (!video.vsc && (video.src || video.currentSrc || video.readyState > 0)) {
          log(`Periodic scan found missed ${video.tagName.toLowerCase()}`, 4);
          checkForVideo(video, video.parentElement, true);
          foundNew = true;
        }
      });

      if (foundNew) {
        log(`Periodic scan found ${foundNew} new videos`, 4);
      }
    };

    // Run periodic scan every 3 seconds, but only if we have videos on the page
    setInterval(() => {
      if (tc.mediaElements.length > 0 || doc.querySelector(tc.settings.audioBoolean ? "video,audio" : "video")) {
        periodicScan();
      }
    }, 3000);

    doc.vscPeriodicScanAttached = true;
  }

  vscInitializedDocuments.add(doc);
}

function setSpeed(video, speed, isInitialCall = false, isUserKeyPress = false) {
  const numericSpeed = Number(speed);
  if (isNaN(numericSpeed) || numericSpeed <= 0 || numericSpeed > 16) return;
  if (!video || !video.vsc || !video.vsc.speedIndicator) return;

  log(
    `setSpeed: Target ${numericSpeed.toFixed(2)}. Initial: ${isInitialCall}. UserKeyPress: ${isUserKeyPress}`,
    4
  );
  tc.settings.lastSpeed = numericSpeed;
  video.vsc.speedIndicator.textContent = numericSpeed.toFixed(2);

  if (isUserKeyPress && !isInitialCall && video.vsc && video.vsc.div) {
    runAction("blink", 1000, null, video); // Pass video to blink
  }

  if (tc.settings.forceLastSavedSpeed) {
    video.dispatchEvent(
      new CustomEvent("ratechange", {
        detail: {
          origin: "videoSpeed",
          speed: numericSpeed.toFixed(2),
          fromUserInput: isUserKeyPress
        }
      })
    );
  } else {
    if (Math.abs(video.playbackRate - numericSpeed) > 0.001) {
      if (isUserKeyPress && !isInitialCall) {
        video.vscIsDirectlySettingRate = true; // Set flag for ratechange listener
      }
      video.playbackRate = numericSpeed;
    }
  }
  if (!isInitialCall) refreshCoolDown();
  if (video.vsc) {
    if (numericSpeed === 1.0 || video.paused) video.vsc.stopSubtitleNudge();
    else video.vsc.startSubtitleNudge();
  }
}

function runAction(action, value, e) {
  log("runAction Begin", 5);
  var mediaTagsToProcess;
  const specificVideo = arguments[3] || null;

  if (specificVideo) {
    mediaTagsToProcess = [specificVideo];
  } else if (e && e.target && e.target.getRootNode) {
    // Event-driven action
    const docContext = e.target.ownerDocument || document;
    mediaTagsToProcess = tc.mediaElements.filter(
      (v) => v.ownerDocument === docContext
    );
    const targetController = e.target.getRootNode().host;
    if (targetController) {
      // If it's a click on a controller, only use that one video
      const videoFromController = tc.mediaElements.find(
        (v) => v.vsc && v.vsc.div === targetController
      );
      if (videoFromController) mediaTagsToProcess = [videoFromController];
    }
  } else {
    mediaTagsToProcess = tc.mediaElements;
  }
  if (mediaTagsToProcess.length === 0 && action !== "display") return;

  mediaTagsToProcess.forEach(function (v) {
    if (!v.vsc) return; // Don't process videos without a controller
    var controller = v.vsc.div;
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
      showController(controller);
    }
    if (v.classList.contains("vsc-cancelled")) return;
    const numValue = parseFloat(value);
    switch (action) {
      case "rewind":
        isUserSeek = true;
        v.currentTime -= numValue;
        break;
      case "advance":
        isUserSeek = true;
        v.currentTime += numValue;
        break;
      case "faster":
        setSpeed(
          v,
          Math.min(
            (v.playbackRate < 0.07 ? 0.07 : v.playbackRate) + numValue,
            16
          ),
          false,
          true
        );
        break;
      case "slower":
        setSpeed(v, Math.max(v.playbackRate - numValue, 0.07), false, true);
        break;
      case "reset":
        resetSpeed(v, 1.0, false); // Use enhanced resetSpeed
        break;
      case "fast":
        resetSpeed(v, numValue, true); // Use enhanced resetSpeed
        break;
      case "display":
        controller.classList.add("vsc-manual");
        controller.classList.toggle("vsc-hidden");
        break;
      case "blink":
        log(`Blink action: controller hidden=${controller.classList.contains("vsc-hidden")}, timeout=${controller.blinkTimeOut !== undefined}, duration=${numValue}`, 5);

        // Always clear existing timeout and show controller
        if (controller.blinkTimeOut !== undefined) {
          clearTimeout(controller.blinkTimeOut);
        }

        // Always show the controller
        controller.classList.remove("vsc-hidden");
        log(`Controller shown, setting timeout for ${numValue || 1000}ms`, 5);

        controller.blinkTimeOut = setTimeout(() => {
          if (
            !(
              controller.classList.contains("vsc-manual") &&
              !controller.classList.contains("vsc-hidden")
            )
          ) {
            controller.classList.add("vsc-hidden");
            log("Controller auto-hidden after blink timeout", 5);
          } else {
            log("Controller kept visible (manual mode)", 5);
          }
          controller.blinkTimeOut = undefined;
        }, numValue || 1000);
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
    }
  });
  log("runAction End", 5);
}

function pause(v) {
  if (v.paused) v.play().catch((e) => log(`Play err:${e.message}`, 2));
  else v.pause();
}

function resetSpeed(v, target, isFastKey = false) {
  const videoId = v.currentSrc || v.src || "default";
  const currentSpeed = v.playbackRate;

  if (isFastKey) {
    // G key: Toggle between current speed and preferred speed (e.g., 1.8)
    const preferredSpeed = target;
    const lastToggle = lastToggleSpeed[videoId] || currentSpeed;

    if (Math.abs(currentSpeed - preferredSpeed) < 0.01) {
      // Currently at preferred speed, toggle to the last speed
      setSpeed(v, lastToggle, false, true);
    } else {
      // Not at preferred speed, save current as toggle speed and go to preferred
      lastToggleSpeed[videoId] = currentSpeed;
      setSpeed(v, preferredSpeed, false, true);
    }
  } else {
    // R key: Toggle between current speed and 1.0
    const resetSpeedValue = 1.0;
    const lastToggle = lastToggleSpeed[videoId] || currentSpeed;

    if (Math.abs(currentSpeed - resetSpeedValue) < 0.01) {
      // Currently at 1.0, toggle to the last speed (or 1.8 if no history)
      const speedToRestore =
        Math.abs(lastToggle - 1.0) < 0.01
          ? getKeyBindings("fast") || 1.8
          : lastToggle;
      setSpeed(v, speedToRestore, false, true);
    } else {
      // Not at 1.0, save current as toggle speed and go to 1.0
      lastToggleSpeed[videoId] = currentSpeed;
      setSpeed(v, resetSpeedValue, false, true);
    }
  }
}

function muted(v) {
  v.muted = !v.muted;
}
function setMark(v) {
  v.vsc.mark = v.currentTime;
}
function jumpToMark(v) {
  if (v.vsc && typeof v.vsc.mark === "number") v.currentTime = v.vsc.mark;
}
function handleDrag(video, e) {
  const c = video.vsc.div;
  const sC = c.shadowRoot.querySelector("#controller");
  var pE = c.parentElement;
  while (
    pE.parentNode &&
    pE.parentNode.offsetHeight === pE.offsetHeight &&
    pE.parentNode.offsetWidth === pE.offsetWidth
  )
    pE = pE.parentNode;
  video.classList.add("vcs-dragging");
  sC.classList.add("dragging");
  const iXY = [e.clientX, e.clientY],
    iCXY = [parseInt(sC.style.left), parseInt(sC.style.top)];
  const sD = (e) => {
    let s = sC.style;
    s.left = iCXY[0] + e.clientX - iXY[0] + "px";
    s.top = iCXY[1] + e.clientY - iXY[1] + "px";
  };
  const eD = () => {
    pE.removeEventListener("mousemove", sD);
    pE.removeEventListener("mouseup", eD);
    pE.removeEventListener("mouseleave", eD);
    sC.classList.remove("dragging");
    video.classList.remove("vcs-dragging");
  };
  pE.addEventListener("mouseup", eD);
  pE.addEventListener("mouseleave", eD);
  pE.addEventListener("mousemove", sD);
}
var timer = null;
function showController(controller) {
  if (!controller || typeof controller.classList === "undefined") return;
  controller.classList.add("vsc-show");
  if (timer) clearTimeout(timer);
  timer = setTimeout(function () {
    controller.classList.remove("vsc-show");
    timer = false;
  }, 2000);
}
