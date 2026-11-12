import { afterEach, expect, test } from "vitest";
import "../extension/shared/frame-stepper.js";

const stepper = globalThis.SpeederShared.frameStepper;
const createdVideos = [];

afterEach(() => {
  createdVideos.forEach((media) => stepper.dispose(media));
  createdVideos.length = 0;
});

function video(fps = 30, options = {}) {
  const pending = new Map();
  let id = 0;
  const media = {
    nodeName: "VIDEO",
    src: options.src || "video-a.mp4",
    currentSrc: options.src || "video-a.mp4",
    readyState: 4,
    paused: false,
    currentTime: 10,
    duration: options.duration === undefined ? 120 : options.duration,
    playbackRate: options.playbackRate || 1,
    pause() { this.paused = true; },
    requestVideoFrameCallback(callback) {
      pending.set(++id, callback);
      return id;
    },
    cancelVideoFrameCallback(callbackId) { pending.delete(callbackId); },
    emitFrame(frameNumber) {
      const [callbackId, callback] = pending.entries().next().value || [];
      if (!callback) throw Error("No pending video-frame callback");
      pending.delete(callbackId);
      callback(0, { mediaTime: frameNumber / fps, presentedFrames: frameNumber });
    },
    pendingCount() { return pending.size; }
  };
  createdVideos.push(media);
  return media;
}

function measure(media, count = 11, identity = (v) => v.currentSrc) {
  expect(stepper.start(media, identity)).toBe(true);
  for (let index = 1; index <= count; index++) media.emitFrame(index);
}

test("standard and fractional FPS estimates", () => {
  for (const fps of [12, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 119.88]) {
    const media = video(fps);
    measure(media);
    const info = stepper.getStatus(media);
    expect(info.status).toBe("measured");
    expect(Math.abs(info.fps - fps) < 0.005).toBe(true);
    expect(media.pendingCount()).toBe(0);
    stepper.dispose(media);
  }
});

test("two videos maintain independent estimates", () => {
  const a = video(24);
  const b = video(60);
  measure(a);
  measure(b);
  expect(stepper.getStatus(a).fps).toBe(24);
  expect(stepper.getStatus(b).fps).toBe(60);
  expect(stepper.step(a, 1, (v) => v.currentSrc)).toBe(true);
  expect(stepper.step(b, -1, (v) => v.currentSrc)).toBe(true);
  expect(Math.abs(a.currentTime - (10 + 1 / 24)) < 1e-9).toBe(true);
  expect(Math.abs(b.currentTime - (10 - 1 / 60)) < 1e-9).toBe(true);
  expect(a.paused).toBe(true);
  expect(b.paused).toBe(true);
});

test("playbackRate does not change frame length", () => {
  for (const speed of [0.5, 1, 2, 4]) {
    const media = video(60, { playbackRate: speed });
    measure(media);
    expect(stepper.step(media, 1, (v) => v.currentSrc)).toBe(true);
    expect(Math.abs(media.currentTime - (10 + 1 / 60)) < 1e-9).toBe(true);
    expect(media.playbackRate).toBe(speed);
  }
});

test("a paused/unmeasured video uses the 30 FPS fallback", () => {
  const media = video(60);
  media.paused = true;
  expect(stepper.start(media, (v) => v.currentSrc)).toBe(false);
  expect(stepper.step(media, 1, (v) => v.currentSrc)).toBe(true);
  expect(Math.abs(media.currentTime - (10 + 1 / 30)) < 1e-9).toBe(true);
});

test("partial measurements are used when the user pauses", () => {
  const media = video(24);
  expect(stepper.start(media, (v) => v.currentSrc)).toBe(true);
  for (let i = 1; i <= 6; i++) media.emitFrame(i);
  stepper.stop(media);
  expect(stepper.getStatus(media).fps).toBe(24);
  expect(media.pendingCount()).toBe(0);
});

test("source changes invalidate the previous estimate", () => {
  const media = video(24);
  measure(media);
  media.currentSrc = "video-b.mp4";
  media.paused = true;
  expect(stepper.step(media, 1, (v) => v.currentSrc)).toBe(true);
  expect(stepper.getStatus(media).status).toBe("unmeasured");
  expect(Math.abs(media.currentTime - (10 + 1 / 30)) < 1e-9).toBe(true);
});

test("a changed SPA identity immediately begins measuring the new video", () => {
  const media = video(30);
  let key = "short:A";
  expect(stepper.start(media, () => key)).toBe(true);
  media.emitFrame(1);
  key = "short:B";
  media.emitFrame(2);
  expect(stepper.getStatus(media).status).toBe("measuring");
  expect(media.pendingCount()).toBe(1);
  for (let i = 3; i <= 13; i++) media.emitFrame(i);
  expect(stepper.getStatus(media).status).toBe("measured");
  expect(stepper.getStatus(media).fps).toBe(30);
});


test("seeks are clamped to duration or seekable ranges", () => {
  const media = video(30, { duration: 11 });
  media.currentTime = 10.999;
  expect(stepper.step(media, 1)).toBe(true);
  expect(media.currentTime).toBe(11);
  const live = video(30, { duration: Infinity });
  live.currentTime = 100;
  expect(stepper.step(live, 1)).toBe(false);
  live.seekable = { length: 1, start: () => 90, end: () => 110 };
  expect(stepper.step(live, 1)).toBe(true);
  expect(live.currentTime > 100).toBe(true);
});

test("missing frame callback keeps fallback; audio elements are ignored", () => {
  const media = video();
  delete media.requestVideoFrameCallback;
  expect(stepper.start(media)).toBe(false);
  expect(stepper.getStatus(media).status).toBe("unsupported");
  expect(stepper.step({ nodeName: "AUDIO", currentTime: 10 }, 1)).toBe(false);
});

test("dispose cancels a pending estimate and forgets its state", () => {
  const media = video(30);
  expect(stepper.start(media, (v) => v.currentSrc)).toBe(true);
  expect(media.pendingCount()).toBe(1);
  stepper.dispose(media);
  expect(media.pendingCount()).toBe(0);
  expect(stepper.getStatus(media).status).toBe("unmeasured");
});
