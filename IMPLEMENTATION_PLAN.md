# Implementation Plan

Constraints: local commits only; no push; no browser testing; one commit per feature.

## Controller and targeting

- [x] Keep the controller visible for its own video in element and ancestor fullscreen.
- [x] Target popup actions at the frame represented by the displayed speed; keep “all videos” intentional.
- [x] Ignore shortcuts originating from editable controls, including shadow-DOM inputs.

## Accessibility and usability

- [x] Give in-player controls accessible names, keyboard behavior, and visible focus.
- [ ] Make control-bar customization operable by keyboard as well as drag and drop.
- [ ] Label generated shortcut and site-rule form controls.
- [ ] Improve popup status announcements, focus indicators, and icon-search semantics.

## Settings safety and validation

- [ ] Confirm before Restore Defaults removes preferences and remembered data.
- [ ] Report partial imports accurately when custom icons cannot be restored.
- [ ] Reject malformed slash-prefixed regular expressions before saving site rules.

## Extension lifecycle and copy

- [ ] Initialize and synchronize the disabled toolbar icon from background state.
- [ ] Correct shortcut, subtitle-nudge, live-update, and obsolete troubleshooting copy.
- [ ] Run automated tests in the release workflow before packaging.

## Verification

- [ ] Run focused automated checks after each non-trivial change.
- [ ] Run the complete non-browser test suite and review the final local commit series.
- [ ] Leave cross-site fullscreen visual verification for reporter/user validation.
