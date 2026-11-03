/*
 * Frame-by-frame seeking for Speeder.
 * Adapted from youtube-shorts-frame-stepper by pbarney.
 * No playback-rate changes or persistent video-frame callbacks.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SpeederShared = root.SpeederShared || {};
  root.SpeederShared.frameStepper = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SETTINGS = Object.freeze({
    fallbackFPS: 30,
    targetSamples: 10,
    minimumSamples: 4,
    maximumMeasurementTime: 1200,
    snapTolerance: 0.02
  });
  var STANDARD_FRAME_RATES = [
    12, 15, 20, 23.976, 24, 25, 29.97, 30,
    48, 50, 59.94, 60, 100, 119.88, 120
  ];
  var states = new WeakMap();

  function median(numbers) {
    var sorted = numbers.slice().sort(function (a, b) { return a - b; });
    var middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function snapToStandardFrameRate(fps) {
    var closest = STANDARD_FRAME_RATES.reduce(function (best, candidate) {
      return Math.abs(candidate - fps) < Math.abs(best - fps) ? candidate : best;
    });
    return Math.abs(closest - fps) / fps <= SETTINGS.snapTolerance
      ? closest : fps;
  }

  function isVideo(media) {
    return Boolean(media && media.nodeName === "VIDEO");
  }

  function getIdentity(media, identity) {
    if (typeof identity === "function") {
      try {
        return String(identity(media) || "unknown");
      } catch (_error) {
        return "unknown";
      }
    }
    return String(identity || media.currentSrc || media.src || "unknown");
  }

  function stopHandles(state) {
    if (state.callbackId !== null &&
        typeof state.video.cancelVideoFrameCallback === "function") {
      try { state.video.cancelVideoFrameCallback(state.callbackId); }
      catch (_error) {}
    }
    if (state.timerId !== null) clearTimeout(state.timerId);
    state.callbackId = null;
    state.timerId = null;
  }

  function newState(video, key) {
    return {
      video: video,
      identity: key,
      fps: SETTINGS.fallbackFPS,
      rawFPS: null,
      status: "unmeasured",
      sampleCount: 0,
      intervals: [],
      callbackId: null,
      timerId: null,
      previousFrame: null
    };
  }

  function ensureState(video, identity) {
    var key = getIdentity(video, identity);
    var state = states.get(video);
    if (!state || state.identity !== key) {
      if (state) stopHandles(state);
      state = newState(video, key);
      states.set(video, state);
    }
    return state;
  }

  function finish(state) {
    if (states.get(state.video) !== state) return;
    stopHandles(state);
    var intervals = state.intervals;
    state.sampleCount = intervals.length;
    if (intervals.length >= SETTINGS.minimumSamples) {
      var rawFPS = 1 / median(intervals);
      state.rawFPS = rawFPS;
      state.fps = snapToStandardFrameRate(rawFPS);
      state.status = "measured";
    } else {
      // A later play/playing event may retry after an early pause or timeout.
      state.status = "waiting";
    }
  }

  function start(video, identity) {
    if (!isVideo(video)) return false;
    var state = ensureState(video, identity);
    if (state.status === "measured" || state.status === "measuring" ||
        state.status === "unsupported") return false;

    if (typeof video.requestVideoFrameCallback !== "function") {
      state.status = "unsupported";
      return false;
    }
    if (video.paused || video.readyState < 2) {
      state.status = "waiting";
      return false;
    }
    state.status = "measuring";
    state.previousFrame = null;
    state.intervals = [];
    state.sampleCount = 0;

    function handleFrame(_now, meta) {
      if (states.get(video) !== state || state.status !== "measuring") return;
      if (getIdentity(video, identity) !== state.identity) {
        // The same element now represents new media (common on SPA sites).
        reset(video);
        // The video may continue playing without another play/playing event.
        start(video, identity);
        return;
      }
      if (video.paused) {
        finish(state);
        return;
      }
      var previous = state.previousFrame;
      if (previous && meta &&
          Number.isFinite(meta.mediaTime) &&
          Number.isFinite(meta.presentedFrames)) {
        var frames = meta.presentedFrames - previous.presentedFrames;
        var mediaSeconds = meta.mediaTime - previous.mediaTime;
        if (frames > 0 && mediaSeconds > 0) {
          var secondsPerFrame = mediaSeconds / frames;
          if (secondsPerFrame >= 1 / 240 && secondsPerFrame <= 1 / 5) {
            state.intervals.push(secondsPerFrame);
            state.sampleCount = state.intervals.length;
          }
        }
      }
      if (meta && Number.isFinite(meta.mediaTime) &&
          Number.isFinite(meta.presentedFrames)) {
        state.previousFrame = {
          mediaTime: meta.mediaTime,
          presentedFrames: meta.presentedFrames
        };
      }
      if (state.intervals.length >= SETTINGS.targetSamples) {
        finish(state);
      } else {
        state.callbackId = video.requestVideoFrameCallback(handleFrame);
      }
    }
    try {
      state.callbackId = video.requestVideoFrameCallback(handleFrame);
      state.timerId = setTimeout(function () { finish(state); },
        SETTINGS.maximumMeasurementTime);
    } catch (_error) {
      stopHandles(state);
      state.status = "unsupported";
      return false;
    }
    return true;
  }

  function stop(video) {
    var state = states.get(video);
    if (state && state.status === "measuring") finish(state);
  }

  function seekTarget(video, target) {
    var duration = Number(video.duration);
    var seekable = video.seekable;
    // Live or nonseekable media are not reliably frame-seekable.
    if (!Number.isFinite(duration) && (!seekable || seekable.length === 0)) {
      return null;
    }
    if (seekable && seekable.length > 0) {
      var nearest = null;
      var nearestDistance = Infinity;
      for (var i = 0; i < seekable.length; i++) {
        var start = seekable.start(i);
        var end = seekable.end(i);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
          continue;
        }
        var bounded = Math.max(start, Math.min(end, target));
        var distance = Math.abs(bounded - target);
        if (distance < nearestDistance) {
          nearest = bounded;
          nearestDistance = distance;
        }
      }
      if (nearest === null) return null;
      return nearest;
    }
    if (!Number.isFinite(duration) || duration <= 0) return null;
    return Math.max(0, Math.min(duration, target));
  }

  function step(video, direction, identity) {
    if (!isVideo(video) || (direction !== 1 && direction !== -1) ||
        !Number.isFinite(video.currentTime)) return false;
    var state = ensureState(video, identity);
    if (state.status === "measuring") finish(state);
    var target = seekTarget(video, video.currentTime + direction / state.fps);
    if (target === null) return false;
    try {
      video.pause();
      video.currentTime = target;
      return true;
    } catch (_error) {
      return false;
    }
  }

  function reset(video) {
    if (!isVideo(video)) return;
    var state = states.get(video);
    if (state) stopHandles(state);
    states.delete(video);
  }

  function getStatus(video) {
    var state = states.get(video);
    return state ? {
      fps: state.fps,
      rawFPS: state.rawFPS,
      status: state.status,
      sampleCount: state.sampleCount
    } : {
      fps: SETTINGS.fallbackFPS,
      rawFPS: null,
      status: "unmeasured",
      sampleCount: 0
    };
  }

  return {
    start: start,
    stop: stop,
    step: step,
    reset: reset,
    dispose: reset,
    getStatus: getStatus,
    median: median,
    snapToStandardFrameRate: snapToStandardFrameRate
  };
});
