# Snap Vanish for Google Meet

Snap your fingers on camera and turn to dust like Thanos. Your mic mutes the moment you vanish. Snap again and you reassemble and unmute.

A Chrome extension (Manifest V3) for [Google Meet](https://meet.google.com). Everything runs locally in your browser.

## Features

- **Dust disintegration effect.** Your video breaks into grains that drift away, and reassembles when you snap again.
- **Snap detection.** Listens for the short, sharp sound of a finger snap. Speech and other longer sounds are ignored.
- **Auto mute and unmute.** The mic goes silent as soon as you vanish. Meet's own mute button is clicked too, so its icon matches.
- **LIVE / MUTED indicator.** A small purple box at the bottom-left of the call shows your mic state.
- **Empty-room capture.** Save a shot of your room without you in it so only you turns to dust. Without it, the whole frame dissolves to black.
- **Adjustable sensitivity** and a **manual trigger** (`Alt + Shift + S`) for testing.

## Install

The extension is not on the Chrome Web Store, so load it as an unpacked extension.

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the folder that contains `manifest.json`.
5. Open or reload a Google Meet tab and allow camera and microphone access.

Requires Chrome 111 or newer.

> If you get "Manifest file is missing or unreadable", you selected a folder one level too high or too low. Pick the folder that directly contains `manifest.json`.

## Usage

1. Join a call, or open the Meet preview screen.
2. Click the extension icon, then **Capture empty room** (see below).
3. Snap your fingers in front of the camera. You turn to dust and your mic mutes.
4. Snap again to come back and unmute.

### Capture empty room (recommended)

1. Click **Capture empty room** in the popup.
2. A 5-second countdown appears on the Meet page. Step out of frame.
3. The shot is saved. Step back in.

The saved shot is reused in later calls. Recapture it if your lighting or camera position changes, or use **Forget saved room** to remove it.

### Settings

| Setting | What it does |
| --- | --- |
| Enabled | Turns the extension on or off. Reload Meet after changing it. |
| Snap sensitivity | Higher catches quieter snaps. Lower avoids false triggers from talking or noise. |
| Test snap | Triggers the effect without snapping. |
| `Alt + Shift + S` | Same as Test snap, from the keyboard. |

## How it works

Meet never receives your raw camera or microphone.

- **Video:** `inject.js` wraps `navigator.mediaDevices.getUserMedia`. The camera feed is drawn onto a canvas, and the canvas stream is passed to Meet. During the effect, the canvas is split into small blocks that fly off as dust. Blocks that differ from the saved empty-room shot are treated as "you".
- **Audio:** the mic goes through a Web Audio gain node. Vanishing sets the gain to 0, and returning sets it back to 1.
- **Snap detection:** a second, unprocessed copy of the mic (no echo cancellation, noise suppression or auto gain) is analyzed but never sent to Meet. A snap is a sudden burst of high-frequency energy that fades within about 90 ms.
- **Messaging:** `content.js` bridges the extension popup and storage to the page script.

## Project structure

```
snap-vanish/
├── manifest.json   # Manifest V3 config
├── inject.js       # Page-world script: video effect, audio gain, snap detection, HUD
├── content.js      # Bridge between the popup/storage and inject.js
├── popup.html      # Popup UI
├── popup.js        # Popup logic
└── icons/          # 16, 48 and 128 px icons
```

## Permissions and privacy

- `storage`: saves your settings and the empty-room image.
- Host access to `https://meet.google.com/*` only.

No audio, video or images are uploaded anywhere. Settings are stored in Chrome's sync storage, and the empty-room shot in local storage.

## Known limitations

- Only works on Google Meet. If Meet changes how it handles camera and mic streams, the extension may need updating.
- Snap detection works best with a quiet room and a mic close to you. Loud background noise or music can cause missed or false snaps.
- Snap detection can be less reliable while the Meet tab is in the background.
- The effect uses a plain background difference, not AI segmentation. A busy background, moving objects or changing light can make parts of the room turn to dust as well.
- The frame size follows the camera stream Meet requests, so very high resolutions use more CPU.

## Troubleshooting

| Problem | Try this |
| --- | --- |
| Nothing happens when I snap | Reload the Meet tab, raise sensitivity, or use **Test snap** to check the effect works. |
| Talking triggers it | Lower the sensitivity. |
| The whole frame goes black | Capture an empty-room shot from the popup. |
| Popup says to open a Meet tab | Open `meet.google.com` and reload it once after installing. |
| Still broken | Press `F12` in the Meet tab and look for console errors starting with `[Snap Vanish]`. |

## Notes

This is a fun side project and is not affiliated with or endorsed by Google, Meet, or Marvel. Be mindful of where you use it: vanishing from a meeting mid-sentence may surprise people.
