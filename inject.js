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
    chrome.storage.sync.set({
      keyBindings: tc.settings.keyBindings,
      version: "0.6.3.13"
    }); // Incremented
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
  /* ... Same as your provided ... */
  if (!tc.settings.keyBindings) return false;
  try {
    const binding = tc.settings.keyBindings.find(
      (item) => item.action === action
    );
    if (binding) return binding[what];
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
function setKeyBindings(action, value) {
  /* ... Same as your provided ... */
  if (!tc.settings.keyBindings) return;
  const binding = tc.settings.keyBindings.find(
    (item) => item.action === action
  );
  if (binding) binding["value"] = value;
}

function defineVideoController() {
  tc.videoController = function (target, parent) {
    if (target.vsc) return target.vsc;
    tc.mediaElements.push(target);
    target.vsc = this;
    this.video = target;
    this.parent = parent || target.parentElement;
    this.nudgeIntervalId = null;

    let storedSpeed;
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
      setSpeed(target, storedSpeed, true, false); // isInitialCall=true, isUserKeyPress=false
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
        // Speed corrections from play/seek are not direct user key presses for blink
        setSpeed(video, speedToSet, false, false); // isInitialCall=false, isUserKeyPress=false
      }
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
          if (!this.div) return;
          this.stopSubtitleNudge();
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
            setSpeed(mutation.target, newSrcSpeed, true, false); // isInitialCall=true, isUserKeyPress=false
            if (!mutation.target.paused && mutation.target.playbackRate !== 1.0)
              this.startSubtitleNudge();
          }
        }
      });
    });
    srcObserver.observe(target, { attributeFilter: ["src", "currentSrc"] });

    if (!target.paused && target.playbackRate !== 1.0)
      this.startSubtitleNudge();
  };

  tc.videoController.prototype.startSubtitleNudge = function () {
    /* ... Same as your provided ... */
    if (!location.hostname.includes("youtube.com")) return;
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
    /* ... Same as your provided ... */
    if (this.nudgeIntervalId !== null) {
      clearInterval(this.nudgeIntervalId);
      this.nudgeIntervalId = null;
    }
  };
  tc.videoController.prototype.remove = function () {
    /* ... Same as your provided ... */
    this.stopSubtitleNudge();
    if (this.div && this.div.parentNode) this.div.remove();
    if (this.video) {
      this.video.removeEventListener("play", this.handlePlay);
      this.video.removeEventListener("pause", this.handlePause);
      this.video.removeEventListener("ended", this.handleEnded);
      this.video.removeEventListener("seeked", this.handleSeek);
      delete this.video.vsc;
    }
    let idx = tc.mediaElements.indexOf(this.video);
    if (idx !== -1) tc.mediaElements.splice(idx, 1);
  };
  tc.videoController.prototype.initializeControls = function () {
    /* ... Same as your provided ... */
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
    shadow.innerHTML = `<style> @import "${chrome.runtime.getURL("shadow.css")}"; </style><div id="controller" style="top:${top}; left:${left}; opacity:${tc.settings.controllerOpacity}"><span data-action="drag" class="draggable">${speedForUI}</span><span id="controls"><button data-action="rewind" class="rw">«</button><button data-action="slower">−</button><button data-action="faster">+</button><button data-action="advance" class="rw">»</button><button data-action="display" class="hideButton">×</button></span></div>`;
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
}
function isBlacklisted() {
  /* ... Same as your provided ... */
  let blacklisted = false;
  const bl = tc.settings.blacklist ? tc.settings.blacklist.split("\n") : [];
  bl.forEach((m) => {
    if (blacklisted) return;
    m = m.replace(regStrip, "");
    if (m.length == 0) return;
    let rgx;
    if (m.startsWith("/") && m.lastIndexOf("/") > 0) {
      try {
        const ls = m.lastIndexOf("/");
        rgx = new RegExp(m.substring(1, ls), m.substring(ls + 1));
      } catch (e) {
        log(`Invalid regex: ${m}. ${e.message}`, 2);
        return;
      }
    } else rgx = new RegExp(escapeStringRegExp(m));
    if (rgx && rgx.test(location.href)) blacklisted = true;
  });
  if (blacklisted) log(`Page ${location.href} blacklisted.`, 4);
  return blacklisted;
}
var coolDown = false;
function refreshCoolDown() {
  /* ... Same as your provided ... */
  if (coolDown) clearTimeout(coolDown);
  coolDown = setTimeout(() => {
    coolDown = false;
  }, 1000);
}

function setupListener() {
  if (document.vscRateListenerAttached) return;

  // MODIFIED: updateSpeedFromEvent NO LONGER calls runAction("blink")
  function updateSpeedFromEvent(video) {
    if (!video.vsc || !video.vsc.speedIndicator) return;
    var speed = Number(video.playbackRate.toFixed(2));
    log(`updateSpeedFromEvent: Rate is ${speed}.`, 4); // Removed fromUserInput from this log

    video.vsc.speedIndicator.textContent = speed.toFixed(2);
    tc.settings.speeds[video.currentSrc || "unknown_src"] = speed;
    tc.settings.lastSpeed = speed;
    chrome.storage.sync.set({ lastSpeed: speed }, () => {
      /* ... */
    });

    // runAction("blink") is now called directly from setSpeed if it's a user key press.

    if (video.vsc) {
      if (speed === 1.0 || video.paused) video.vsc.stopSubtitleNudge();
      else video.vsc.startSubtitleNudge();
    }
  }

  document.addEventListener(
    "ratechange",
    function (event) {
      if (tc.isNudging) return; // Ignore nudge's own rate changes for VSC UI/state logic

      if (coolDown) {
        log("Blocked by coolDown", 4);
        event.stopImmediatePropagation();
        return;
      }

      var video = event.target;
      if (!video || typeof video.playbackRate === "undefined" || !video.vsc)
        return;

      const eventOrigin = event.detail && event.detail.origin;
      // The `fromUserInput` flag that was passed to updateSpeedFromEvent is removed from here.
      // updateSpeedFromEvent now just updates state. Blinking is handled by setSpeed.

      if (tc.settings.forceLastSavedSpeed) {
        if (eventOrigin === "videoSpeed") {
          // This "videoSpeed" event is dispatched by setSpeed when forceLastSavedSpeed is true.
          // setSpeed itself will handle blinking if it was a user key press.
          if (event.detail.speed) {
            const detailSpeedNum = Number(event.detail.speed);
            if (
              !isNaN(detailSpeedNum) &&
              Math.abs(video.playbackRate - detailSpeedNum) > 0.001
            ) {
              video.playbackRate = detailSpeedNum; // As per original forceLastSavedSpeed logic
            }
          }
          updateSpeedFromEvent(video); // Update state
          event.stopImmediatePropagation(); // Original behavior
        } else {
          // Native event when forceLastSavedSpeed is ON
          if (Math.abs(video.playbackRate - tc.settings.lastSpeed) > 0.001) {
            video.playbackRate = tc.settings.lastSpeed;
            event.stopImmediatePropagation();
            // The next ratechange (from VSC forcing it) will call updateSpeedFromEvent.
          } else {
            updateSpeedFromEvent(video); // Just confirming, no blink needed from here
          }
        }
      } else {
        // forceLastSavedSpeed is OFF
        updateSpeedFromEvent(video); // Update state
        // DO NOT stop propagation
      }
    },
    true
  );
  document.vscRateListenerAttached = true;
}

var vscInitializedDocuments = new Set();
function initializeWhenReady(doc) {
  /* ... Same robust init ... */
  if (doc.vscInitWhenReadyUniqueFlag1 && doc.readyState !== "loading") return;
  doc.vscInitWhenReadyUniqueFlag1 = true;
  if (isBlacklisted()) return;
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
  /* ... Same ... */ try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
}
function getShadow(parent) {
  /* ... Same ... */ let r = [];
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

function initializeNow(doc) {
  /* ... Same robust init, ensuring tc.videoController is defined ... */
  if (vscInitializedDocuments.has(doc) || !doc.body) return;
  if (!tc.settings.enabled) return;
  if (!doc.body.classList.contains("vsc-initialized"))
    doc.body.classList.add("vsc-initialized");
  if (typeof tc.videoController === "undefined") defineVideoController();
  setupListener();
  if (
    inIframe() &&
    doc !== window.top.document &&
    !doc.head.querySelector('link[href*="inject.css"]')
  ) {
    var l = doc.createElement("link");
    l.href = chrome.runtime.getURL("inject.css");
    l.type = "text/css";
    l.rel = "stylesheet";
    doc.head.appendChild(l);
  }
  const dFK = new Set([doc]);
  try {
    if (inIframe() && window.top.document) dFK.add(window.top.document);
  } catch (e) {}
  dFK.forEach((lD) => {
    if (!lD.vscKDLFlagC) {
      lD.addEventListener(
        "keydown",
        function (evt) {
          if (!tc.settings.enabled) return;
          const tgt = evt.target;
          if (
            tgt.nodeName === "INPUT" ||
            tgt.nodeName === "TEXTAREA" ||
            tgt.isContentEditable
          )
            return;
          if (
            evt.getModifierState &&
            (evt.getModifierState("Alt") ||
              evt.getModifierState("Control") ||
              evt.getModifierState("Meta") ||
              evt.getModifierState("Fn") ||
              evt.getModifierState("Hyper") ||
              evt.getModifierState("OS"))
          )
            return;
          if (tc.mediaElements.length === 0 && !lD.querySelector("video,audio"))
            return;
          var itm = tc.settings.keyBindings.find((k) => k.key === evt.keyCode);
          if (itm) {
            runAction(itm.action, itm.value, evt);
            if (itm.force === "true" || itm.force === true) {
              evt.preventDefault();
              evt.stopPropagation();
            }
          }
        },
        true
      );
      lD.vscKDLFlagC = true;
    }
  });
  if (!doc.vscMOFlagC) {
    const o = new MutationObserver((m) => {
      if (typeof requestIdleCallback === "function")
        requestIdleCallback(() => pM(m), { timeout: 1000 });
      else setTimeout(() => pM(m), 200);
    });
    function pM(ml) {
      for (const m of ml) {
        if (m.type === "childList") {
          m.addedNodes.forEach((n) => {
            if (n instanceof Element) cV(n, n.parentNode || m.target, true);
          });
          m.removedNodes.forEach((n) => {
            if (n instanceof Element) cV(n, n.parentNode || m.target, false);
          });
        } else if (
          m.type === "attributes" &&
          m.attributeName === "aria-hidden" &&
          m.target instanceof Element &&
          m.target.getAttribute("aria-hidden") === "false"
        ) {
          const vIT = Array.from(getShadow(m.target)).filter(
            (el) => el.tagName === "VIDEO"
          );
          vIT.forEach((vE) => {
            if (!vE.vsc) cV(vE, vE.parentNode || m.target, true);
          });
        }
      }
    }
    function cV(n, p, a) {
      if (!a && !n.isConnected) {
      } else if (!a && n.isConnected) return;
      if (
        n.nodeName === "VIDEO" ||
        (n.nodeName === "AUDIO" && tc.settings.audioBoolean)
      ) {
        if (a) {
          if (!n.vsc) new tc.videoController(n, p);
        } else {
          if (n.vsc) n.vsc.remove();
        }
      } else if (n.children && n.children.length > 0) {
        for (let i = 0; i < n.children.length; i++)
          cV(n.children[i], n.children[i].parentNode || p, a);
      }
    }
    o.observe(doc, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-hidden"]
    });
    doc.vscMOFlagC = true;
  }
  const q = tc.settings.audioBoolean ? "video,audio" : "video";
  doc.querySelectorAll(q).forEach((v) => {
    if (!v.vsc) new tc.videoController(v, v.parentElement);
  });
  Array.from(doc.getElementsByTagName("iframe")).forEach((f) => {
    try {
      if (f.contentDocument) initializeWhenReady(f.contentDocument);
    } catch (e) {}
  });
  vscInitializedDocuments.add(doc);
}

// MODIFIED: setSpeed now takes `isInitialCall` and `isUserKeyPress`
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

  if (tc.settings.forceLastSavedSpeed) {
    video.dispatchEvent(
      new CustomEvent("ratechange", {
        // Pass `isUserKeyPress` as `fromUserInput` for the custom event
        detail: {
          origin: "videoSpeed",
          speed: numericSpeed.toFixed(2),
          fromUserInput: isUserKeyPress
        }
      })
    );
  } else {
    if (Math.abs(video.playbackRate - numericSpeed) > 0.001) {
      video.playbackRate = numericSpeed;
    }
  }

  if (!isInitialCall) refreshCoolDown(); // Original call, only for non-initial sets

  // MODIFIED: Directly trigger blink here if it's a user key press and not initial setup
  if (isUserKeyPress && !isInitialCall && video.vsc) {
    runAction("blink", getKeyBindings("blink", "value") || 1000, null, video);
  }

  if (video.vsc) {
    if (numericSpeed === 1.0 || video.paused) video.vsc.stopSubtitleNudge();
    else video.vsc.startSubtitleNudge();
  }
}

// MODIFIED: runAction passes `isUserKeyPress=true` to setSpeed for relevant actions
function runAction(action, value, e, specificVideo = null) {
  var mediaTagsToProcess = []; // ... (same robust mediaTagsToProcess logic as before) ...
  if (specificVideo) mediaTagsToProcess = [specificVideo];
  else if (e && e.target) {
    const dC = e.target.ownerDocument || document;
    let aV = tc.mediaElements.find(
      (v) =>
        v.ownerDocument === dC &&
        (dC.activeElement === v || v.contains(dC.activeElement))
    );
    if (aV) mediaTagsToProcess = [aV];
    else {
      aV = tc.mediaElements.find(
        (v) =>
          v.ownerDocument === dC &&
          v.offsetParent !== null &&
          (!v.paused || v.readyState > 0)
      );
      if (aV) mediaTagsToProcess = [aV];
      else {
        mediaTagsToProcess = tc.mediaElements.filter(
          (v) => v.ownerDocument === dC
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

    // Original showController logic (not tied to `isUserKeyPress` here, runAction("blink") is separate)
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
      // MODIFIED: Pass `isUserKeyPress = true`
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
        resetSpeed(v, 1.0, currentActionContext);
        break;
      case "fast":
        resetSpeed(v, numValue, currentActionContext);
        break;
      case "display":
        controllerDiv.classList.add("vsc-manual");
        controllerDiv.classList.toggle("vsc-hidden");
        break;
      case "blink": // This action is now mostly called by setSpeed itself for user key presses
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

function pause(v) {
  /* ... Same as your original ... */ if (v.paused)
    v.play().catch((e) => log(`Play err:${e.message}`, 2));
  else v.pause();
}

// MODIFIED: `resetSpeed` now calls `setSpeed` with `isUserKeyPress = true`
function resetSpeed(v, target, currentActionContext = null) {
  log(
    `resetSpeed (original): Video current: ${v.playbackRate.toFixed(2)}, Target: ${target.toFixed(2)}, Context: ${currentActionContext}`,
    4
  );
  if (Math.abs(v.playbackRate - target) < 0.01) {
    if (v.playbackRate === (getKeyBindings("reset", "value") || 1.0)) {
      if (target !== 1.0) {
        setSpeed(v, 1.0, false, true); // isInitial=false, isUserKeyPress=true
      } else {
        setSpeed(v, getKeyBindings("fast", "value"), false, true); // isInitial=false, isUserKeyPress=true
      }
    } else {
      setSpeed(v, getKeyBindings("reset", "value") || 1.0, false, true); // isInitial=false, isUserKeyPress=true
    }
  } else {
    if (currentActionContext === "reset") {
      setKeyBindings("reset", v.playbackRate);
    }
    setSpeed(v, target, false, true); // isInitial=false, isUserKeyPress=true
  }
}

function muted(v) {
  /* ... Same as your original ... */ v.muted = !v.muted;
  log(`Mute: ${v.muted}`, 5);
}
function setMark(v) {
  /* ... Same as your original ... */ if (!v.vsc) v.vsc = {};
  v.vsc.mark = v.currentTime;
  log(`Mark: ${v.vsc.mark.toFixed(2)}`, 5);
}
function jumpToMark(v) {
  /* ... Same as your original ... */ if (
    v.vsc &&
    typeof v.vsc.mark === "number"
  )
    v.currentTime = v.vsc.mark;
  else log("No mark.", 4);
}
function handleDrag(video, e) {
  /* ... Same as your original ... */
  if (!video || !video.vsc || !video.vsc.div || !video.vsc.div.shadowRoot)
    return;
  const ctl = video.vsc.div;
  const sCtl = ctl.shadowRoot.querySelector("#controller");
  if (!sCtl) return;
  var pE = ctl.parentElement;
  while (
    pE &&
    pE.parentNode &&
    pE.parentNode !== document &&
    pE.parentNode.offsetHeight === pE.offsetHeight &&
    pE.parentNode.offsetWidth === pE.offsetWidth
  )
    pE = pE.parentNode;
  const dB = pE || video.ownerDocument.body;
  video.classList.add("vcs-dragging");
  sCtl.classList.add("dragging");
  const iXY = [e.clientX, e.clientY],
    iCtlXY = [
      parseInt(sCtl.style.left, 10) || 0,
      parseInt(sCtl.style.top, 10) || 0
    ];
  const sD = (mE) => {
    let s = sCtl.style;
    s.left = iCtlXY[0] + mE.clientX - iXY[0] + "px";
    s.top = iCtlXY[1] + mE.clientY - iXY[1] + "px";
    mE.preventDefault();
  };
  const eD = () => {
    dB.removeEventListener("mousemove", sD);
    dB.removeEventListener("mouseup", eD);
    dB.removeEventListener("mouseleave", eD);
    sCtl.classList.remove("dragging");
    video.classList.remove("vcs-dragging");
  };
  dB.addEventListener("mousemove", sD);
  dB.addEventListener("mouseup", eD);
  dB.addEventListener("mouseleave", eD);
}
var timer = null;
function showController(controller) {
  /* ... Same as your original ... */
  if (!controller || typeof controller.classList === "undefined") return;
  controller.classList.add("vcs-show");
  if (timer) clearTimeout(timer);
  timer = setTimeout(function () {
    if (controller && controller.classList)
      controller.classList.remove("vsc-show");
    timer = false;
  }, 2000);
}
