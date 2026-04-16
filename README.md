# Available for Firefox

[![Add to Firefox](https://img.shields.io/badge/Add%20to-Firefox-orange?logo=firefox&logoColor=white)](https://addons.mozilla.org/firefox/addon/speeder/)

## The science of accelerated playback

**TL;DR: faster playback translates to better engagement and retention.**

Average adult reads prose text at
[250 to 300 words per minute](https://web.archive.org/web/20220325065025/https://www.domtar.com/en/resources/paper-advocacy/paperbecause)
(wpm). By contrast, the average rate of speech for English speakers is ~150 wpm,
with slide presentations often closer to 100 wpm. As a result, when given the
choice, many viewers
[speed up video playback to ~1.3\~1.5 its recorded rate](https://research.microsoft.com/en-us/um/redmond/groups/coet/compression/chi99/paper.pdf)
to compensate for the difference.

Many viewers report that
[accelerated viewing keeps their attention longer](https://www.enounce.com/docs/BYUPaper020319.pdf):
faster delivery keeps the viewer more engaged with the content. In fact, with a
little training many end up watching videos at 2x+ the recorded speed. Some
studies report that after being exposed to accelerated playback,
[listeners become uncomfortable](https://web.archive.org/web/20230912173120/http://alumni.media.mit.edu/~barons/html/avios92.html)
if they are forced to return to normal rate of presentation.

## Faster HTML5 Video

HTML5 video provides a native API to accelerate playback of any video. The
problem is, many players either hide, or limit this functionality. For best
results playback speed adjustments should be easy and frequent to match the pace
and content being covered: we don't read at a fixed speed, and similarly, we
need an easy way to accelerate the video, slow it down, and quickly rewind the
last point to listen to it a few more times.

![Player](https://cloud.githubusercontent.com/assets/2400185/24076745/5723e6ae-0c41-11e7-820c-1d8e814a2888.png)

## Using the extension

[![Add to Firefox](https://img.shields.io/badge/Add%20to-Firefox-orange?logo=firefox&logoColor=white)](https://addons.mozilla.org/firefox/addon/speeder/)

Once the extension is installed simply navigate to any page that offers
HTML5 video ([example](https://www.youtube.com/watch?v=E9FxNzv1Tr8)), and you'll
see a speed indicator in top left corner. Hover over the indicator to reveal the
controls to accelerate, slowdown, and quickly rewind or advance the video. Or,
even better, simply use your keyboard:

- **S** - decrease playback speed.
- **D** - increase playback speed.
- **R** - reset playback speed to 1.0x.
- **Z** - rewind video by 10 seconds.
- **X** - advance video by 10 seconds.
- **G** - toggle between current and user configurable preferred speed.
- **V** - show/hide the controller.

You can customize and reassign the default shortcut keys in the extensions
settings page, as well as add additional shortcut keys to match your
preferences. For example, you can assign multiple different "preferred speed"
shortcuts with different values, which will allow you to quickly toggle between
your most commonly used speeds. To add a new shortcut, open extension settings
and click "Add New".

<img width="1760" height="1330" alt="image" src="https://github.com/user-attachments/assets/32e814dd-93ea-4943-8ec9-3eca735447ac" />

Some sites may assign other functionality to one of the assigned shortcut keys —
these collisions are inevitable, unfortunately. As a workaround, the extension
listens both for lower and upper case values (i.e. you can use
`Shift-<shortcut>`) if there is other functionality assigned to the lowercase
key. This is not a perfect solution, as some sites may listen to both, but works
most of the time.

## FAQ

### The video controls are not showing up?

This extension is only compatible
with HTML5 video. If you don't see the controls showing up, chances are you are
viewing a Flash video. If you want to confirm, try right-clicking on the video
and inspect the menu: if it mentions flash, then that's the issue. That said,
most sites will fallback to HTML5 if they detect that Flash is not available.
You can try manually disabling Flash from the browser.

### What is this fork all about?

This is a fork of
[CodeBicycle's Video Speed Controller extension for Firefox](https://github.com/codebicycle/videospeed)
which is a fork of [Igrigorik's Video Speed Controller extension for Chromium](https://github.com/igrigorik/videospeed).

The goal of this fork is fix bugs in the upstream code as well as add new features.

## License

(GPLv3) - Copyright (c) 2025 Josh Patra
