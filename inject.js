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
    this.nudgeIntervalId = null;
    let storedSpeed = tc.settings.speeds[target.currentSrc];
    if (!tc.settings.rememberSpeed) {
      if (!storedSpeed) {
        storedSpeed = 1.0;
      }
      setKeyBindings("reset", getKeyBindings("fast"));
    } else {
      storedSpeed = tc.settings.lastSpeed;
    }
    if (tc.settings.forceLastSavedSpeed) {
      storedSpeed = tc.settings.lastSpeed;
    }
    target.playbackRate = storedSpeed;
    this.div = this.initializeControls();
    var mediaEventAction = function (event) {
      let storedSpeed = tc.settings.speeds[event.target.currentSrc];
      if (!tc.settings.rememberSpeed) {
        if (!storedSpeed) {
          storedSpeed = 1.0;
        }
        setKeyBindings("reset", getKeyBindings("fast"));
      } else {
        storedSpeed = tc.settings.lastSpeed;
      }
      if (tc.settings.forceLastSavedSpeed) storedSpeed = tc.settings.lastSpeed;
      setSpeed(event.target, storedSpeed);
      if (event.type === "play") this.startSubtitleNudge();
      else if (event.type === "pause" || event.type === "ended")
        this.stopSubtitleNudge();
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

  // MODIFIED: Using your debug-enhanced startSubtitleNudge function
  tc.videoController.prototype.startSubtitleNudge = function () {
    console.log("[VSC DEBUG] startSubtitleNudge called");
    console.log("[VSC DEBUG] location.hostname:", location.hostname);
    console.log(
      "[VSC DEBUG] enableSubtitleNudge:",
      tc.settings.enableSubtitleNudge
    );
    console.log("[VSC DEBUG] video element:", this.video);
    console.log(
      "[VSC DEBUG] video src:",
      this.video ? this.video.src : "no video"
    );
    console.log(
      "[VSC DEBUG] video currentSrc:",
      this.video ? this.video.currentSrc : "no video"
    );
    console.log(
      "[VSC DEBUG] video paused:",
      this.video ? this.video.paused : "no video"
    );
    console.log(
      "[VSC DEBUG] video playbackRate:",
      this.video ? this.video.playbackRate : "no video"
    );
    const isYouTube =
      (this.video &&
        this.video.currentSrc &&
        this.video.currentSrc.includes("googlevideo.com")) ||
      location.hostname.includes("youtube.com");
    if (!isYouTube) return;
    if (
      !tc.settings.enableSubtitleNudge ||
      this.nudgeIntervalId !== null ||
      !this.video
    ) {
      console.log("[VSC DEBUG] Nudge blocked - reasons:", {
        enableSubtitleNudge: tc.settings.enableSubtitleNudge,
        nudgeIntervalId: this.nudgeIntervalId,
        hasVideo: !!this.video
      });
      return;
    }
    if (this.video.paused || this.video.playbackRate === 1.0) {
      console.log("[VSC DEBUG] Nudge stopped - video paused or 1.0x speed");
      this.stopSubtitleNudge();
      return;
    }
    console.log("[VSC DEBUG] Starting nudge interval");
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

  tc.videoController.prototype.initializeControls = function () {
    const doc = this.video.ownerDocument;
    const speed = this.video.playbackRate.toFixed(2);
    var top = Math.max(this.video.offsetTop, 0) + "px",
      left = Math.max(this.video.offsetLeft, 0) + "px";
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
        else parentEl.insertBefore(fragment, parentEl.firstChild);
        break;
      case location.hostname == "tv.apple.com":
        const r = parentEl.getRootNode();
        const s = r && r.querySelector ? r.querySelector(".scrim") : null;
        if (s) s.prepend(fragment);
        else parentEl.insertBefore(fragment, pEl.firstChild);
        break;
      default:
        parentEl.insertBefore(fragment, parentEl.firstChild);
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
    chrome.storage.sync.set({ lastSpeed: speed }, () => {});
    if (fromUserInput) {
      runAction("blink", getKeyBindings("blink", "value") || 1000, null, video);
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
function initializeWhenReady(doc) {
  if (vscInitializedDocuments.has(doc) || !doc.body) return;
  if (doc.readyState === "complete") {
    initializeNow(doc);
  } else {
    doc.addEventListener("DOMContentLoaded", () => initializeNow(doc), {
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
        if (c.shadowRoot) r.push(...getShadow(c.shadowRoot));
        c = c.nextElementSibling;
      } while (c);
    }
  }
  gC(parent);
  return r;
}

// MODIFIED: Replaced with your debug-enhanced initializeNow
function initializeNow(doc) {
  console.log(
    "[VSC DEBUG] initializeNow called for:",
    doc.location ? doc.location.hostname : "unknown doc"
  );
  if (vscInitializedDocuments.has(doc) || !doc.body) return;
  if (!tc.settings.enabled) return;
  if (!doc.body.classList.contains("vsc-initialized"))
    doc.body.classList.add("vsc-initialized");
  if (typeof tc.videoController === "undefined") defineVideoController();
  setupListener();

  // Re-inserting original keydown listener logic from your codebase
  var docs = Array(doc);
  try {
    if (inIframe()) docs.push(window.top.document);
  } catch (e) {}
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

  // Original MutationObserver logic
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
                if (
                  mutation.target.attributes["aria-hidden"] &&
                  mutation.target.attributes["aria-hidden"].value == "false"
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
          if (!node.vsc) node.vsc = new tc.videoController(node, parent);
        } else {
          if (node.vsc) node.vsc.remove();
        }
      } else if (node.children != undefined) {
        for (var i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          checkForVideo(child, child.parentNode || parent, added);
        }
      }
    }
    observer.observe(doc, {
      attributeFilter: ["aria-hidden"],
      childList: true,
      subtree: true
    });
    doc.vscMutationObserverAttached = true;
  }

  const q = tc.settings.audioBoolean ? "video,audio" : "video";
  const foundVideos = doc.querySelectorAll(q);
  console.log(
    "[VSC DEBUG] Found videos:",
    foundVideos.length,
    "in doc:",
    doc.location ? doc.location.hostname : "unknown"
  );
  foundVideos.forEach((v) => {
    if (!v.vsc) new tc.videoController(v, v.parentElement);
  });

  // Your enhanced iframe handling
  Array.from(doc.getElementsByTagName("iframe")).forEach((f) => {
    console.log("[VSC DEBUG] Found iframe:", f.src);
    if (f.vscLoadListenerAttached) return; // Prevent attaching multiple load listeners
    f.addEventListener("load", () => {
      console.log("[VSC DEBUG] Iframe loaded, attempting to access");
      try {
        if (f.contentDocument) {
          initializeWhenReady(f.contentDocument);
        }
      } catch (e) {
        console.log(
          "[VSC DEBUG] Still cannot access iframe after load:",
          e.message
        );
      }
    });
    f.vscLoadListenerAttached = true;
    try {
      if (f.contentDocument) {
        initializeWhenReady(f.contentDocument);
      }
    } catch (e) {
      console.log("[VSC DEBUG] Error accessing iframe immediately:", e.message);
    }
  });
  vscInitializedDocuments.add(doc);
}

// MODIFIED: setSpeed now takes isUserKeyPress for blink logic
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
    runAction("blink", null, null, video); // Pass video to blink
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

// MODIFIED: runAction is now context-aware and calls the new simpler resetSpeed
function runAction(action, value, e) {
  log("runAction Begin", 5);
  var mediaTagsToProcess;
  if (e && e.target && e.target.getRootNode) {
    // Event-driven action
    const docContext = e.target.ownerDocument || document;
    mediaTagsToProcess = tc.mediaElements.filter(
      (v) => v.ownerDocument === docContext
    );
    const targetController = e.target.getRootNode().host;
    if (targetController) {
      // If it's a click on a controller, only use that one video
      const specificVideo = tc.mediaElements.find(
        (v) => v.vsc && v.vsc.div === targetController
      );
      if (specificVideo) mediaTagsToProcess = [specificVideo];
    }
  } else {
    // No event context (e.g., internal blink call) or a passed specificVideo
    const specificVideo = arguments[3] || null; // The optional 4th argument
    if (specificVideo) mediaTagsToProcess = [specificVideo];
    else mediaTagsToProcess = tc.mediaElements;
  }
  if (mediaTagsToProcess.length === 0 && action !== "display") return;

  mediaTagsToProcess.forEach(function (v) {
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
          false,
          true
        );
        break;
      case "slower":
        setSpeed(v, Math.max(v.playbackRate - numValue, 0.07), false, true);
        break;
      case "reset":
        resetSpeed(v, 1.0);
        break; // Use new simpler resetSpeed
      case "fast":
        resetSpeed(v, numValue, true);
        break; // Use new simpler resetSpeed
      case "display":
        controller.classList.add("vsc-manual");
        controller.classList.toggle("vsc-hidden");
        break;
      case "blink":
        if (
          controller.classList.contains("vsc-hidden") ||
          controller.blinkTimeOut !== undefined
        ) {
          clearTimeout(controller.blinkTimeOut);
          controller.classList.remove("vsc-hidden");
          controller.blinkTimeOut = setTimeout(() => {
            if (
              !(
                controller.classList.contains("vsc-manual") &&
                !controller.classList.contains("vsc-hidden")
              )
            ) {
              controller.classList.add("vsc-hidden");
            }
            controller.blinkTimeOut = undefined;
          }, value || 1000);
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
    }
  });
  log("runAction End", 5);
}

function pause(v) {
  if (v.paused) v.play().catch((e) => log(`Play err:${e.message}`, 2));
  else v.pause();
}

// MODIFIED: Replaced with new, simpler resetSpeed function
function resetSpeed(v, target, isFastKey = false) {
  const fastSpeed = getKeyBindings("fast", "value") || 1.8;
  if (isFastKey) {
    // Called by 'fast' action
    if (Math.abs(v.playbackRate - target) < 0.01) {
      setSpeed(v, 1.0, false, true); // Toggle to 1.0
    } else {
      setSpeed(v, target, false, true); // Set to preferred speed
    }
  } else {
    // Called by 'reset' action
    if (Math.abs(v.playbackRate - 1.0) < 0.01) {
      setSpeed(v, fastSpeed, false, true); // Toggle to fast speed
    } else {
      setSpeed(v, 1.0, false, true); // Set to 1.0
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
  /* ... Same original logic ... */
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
  /* ... Same original logic ... */
  if (!controller || typeof controller.classList === "undefined") return;
  controller.classList.add("vcs-show");
  if (timer) clearTimeout(timer);
  timer = setTimeout(function () {
    controller.classList.remove("vsc-show");
    timer = false;
  }, 2000);
}
